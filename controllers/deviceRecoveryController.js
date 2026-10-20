import crypto from "crypto";
import prisma from "../lib/prisma.js";
import {
  parseClientHints,
  collectClientHints,
  resolveDeviceSignals,
  sanitizeStoredRequestSignals,
  evaluateRecoveryEligibility,
  sanitizeRegisteredDevice,
  validateDescription,
  INELIGIBLE_MESSAGES,
} from "../utils/recovery.js";
import { rateLimit } from "../utils/rateLimit.js";
import { sendRecoveryDecisionMail } from "../emailVerify/sendRecoveryDecisionMail.js";

const ACTIVE_MARKER = "active";
const RECOVERY_STATUSES = ["PENDING", "APPROVED", "REJECTED"];
const SORTABLE_FIELDS = { createdAt: "createdAt", updatedAt: "updatedAt", status: "status", resolvedAt: "resolvedAt" };

const generateDeviceToken = () => crypto.randomBytes(32).toString("hex");

const CLIENT_HINT_HEADERS = "Sec-CH-UA-Platform, Sec-CH-UA-Mobile, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model";

const offerClientHints = (res) => {
  res.setHeader("Accept-CH", CLIENT_HINT_HEADERS);
  res.setHeader("Vary", "Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model");
};

const serializeRequest = (request) => {
  if (!request) return null;
  const signals = sanitizeStoredRequestSignals(request);
  return {
    id: request.id,
    noteKey: request.noteKey,
    status: request.status,
    description: request.description,
    userAgent: request.userAgent,
    browserName: request.browserName,
    browserVersion: request.browserVersion,
    osName: request.osName,
    osVersion: signals.osVersion,
    osVersionSource: signals.osVersionSource,
    deviceModel: signals.deviceModel,
    deviceModelSource: signals.deviceModelSource,
    deviceFingerprint: request.deviceFingerprint,
    rejectionReason: request.rejectionReason,
    resolvedBy: request.resolvedBy,
    resolvedAt: request.resolvedAt,
    emailSentAt: request.emailSentAt,
    emailAttempts: request.emailAttempts,
    emailLastError: request.emailLastError,
    createdAt: request.createdAt,
  };
};

const serializePurchase = (purchase) => {
  if (!purchase) return null;
  return {
    id: purchase.id,
    razorpayOrderId: purchase.razorpayOrderId,
    razorpayPaymentId: purchase.razorpayPaymentId,
    amount: purchase.amount,
    currency: purchase.currency,
    status: purchase.status,
    createdAt: purchase.createdAt,
  };
};

const loadPurchaseContext = async (userId, noteKey) => {
  const [config, entitlement, purchases] = await Promise.all([
    prisma.paidNoteConfig.findUnique({ where: { noteKey } }),
    prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
      include: { registeredDevice: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { userId, noteKey },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    config,
    entitlement,
    purchases,
    eligibility: evaluateRecoveryEligibility({ config, entitlement, purchaseOrders: purchases }),
  };
};

const deliverDecisionEmail = async (request, user, config) => {
  const resolvedAtLabel = request.resolvedAt
    ? new Date(request.resolvedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "";

  try {
    await sendRecoveryDecisionMail({
      to: user.email,
      username: user.username,
      noteTitle: config?.title || request.noteKey,
      reference: request.id,
      status: request.status,
      reason: request.rejectionReason,
      resolvedAt: resolvedAtLabel,
    });

    await prisma.deviceRecoveryRequest
      .update({
        where: { id: request.id },
        data: { emailSentAt: new Date(), emailLastError: null },
      })
      .catch(() => {});

    return { emailSent: true };
  } catch (error) {
    console.error(`Recovery decision email failed for request ${request.id}:`, error.message);
    await prisma.deviceRecoveryRequest
      .update({
        where: { id: request.id },
        data: {
          emailAttempts: { increment: 1 },
          emailLastError: error.message || "Email delivery failed",
        },
      })
      .catch(() => {});
    return { emailSent: false, emailError: error.message || "Email delivery failed" };
  }
};

export const getRecoveryEligibility = async (req, res) => {
  try {
    const noteKey = req.params[0];
    const userId = req.userId;

    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const [config, entitlement, purchases, requests] = await Promise.all([
      prisma.paidNoteConfig.findUnique({ where: { noteKey } }),
      prisma.noteEntitlement.findUnique({
        where: { userId_noteKey: { userId, noteKey } },
        include: { registeredDevice: true },
      }),
      prisma.purchaseOrder.findMany({ where: { userId, noteKey }, orderBy: { createdAt: "desc" } }),
      prisma.deviceRecoveryRequest.findMany({
        where: { userId, noteKey },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const eligibility = evaluateRecoveryEligibility({ config, entitlement, purchaseOrders: purchases });
    const activeRequest = requests.find((request) => request.status === "PENDING") || null;

    offerClientHints(res);

    return res.status(200).json({
      success: true,
      noteKey,
      noteTitle: config ? config.title : null,
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      purchase: serializePurchase(eligibility.purchase),
      device: sanitizeRegisteredDevice(entitlement ? entitlement.registeredDevice : null),
      activeRequest: serializeRequest(activeRequest),
      requests: requests.map(serializeRequest),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createRecoveryRequest = async (req, res) => {
  try {
    const userId = req.userId;
    const { noteKey, description } = req.body;

    if (typeof noteKey !== "string" || !noteKey.trim()) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const validatedDescription = validateDescription(description);
    if (!validatedDescription.ok) {
      return res.status(400).json({ success: false, message: validatedDescription.message });
    }

    const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const userLimit = rateLimit({ key: `recovery-submit:user:${userId}`, limit: 5, windowMs: 60 * 60 * 1000 });
    const ipLimit = rateLimit({ key: `recovery-submit:ip:${clientIp}`, limit: 15, windowMs: 60 * 60 * 1000 });

    if (!userLimit.allowed || !ipLimit.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many recovery requests. Please try again later.",
      });
    }

    const presentedFingerprint =
      req.headers["x-device-fingerprint"] || req.headers["x-device-fingerprint-legacy"];

    if (typeof presentedFingerprint !== "string" || !presentedFingerprint.trim()) {
      return res.status(400).json({
        success: false,
        message: "Device fingerprint missing. Open this note page and try again.",
      });
    }

    const trimmedNoteKey = noteKey.trim();
    const { config, eligibility } = await loadPurchaseContext(userId, trimmedNoteKey);

    if (!eligibility.eligible) {
      return res.status(403).json({
        success: false,
        message: INELIGIBLE_MESSAGES[eligibility.reason] || "Recovery is not available for this note",
        reason: eligibility.reason,
      });
    }

    const existingRequest = await prisma.deviceRecoveryRequest.findFirst({
      where: { userId, noteKey: trimmedNoteKey, status: "PENDING" },
    });

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        message: "A recovery request for this purchase is already pending review",
        activeRequest: serializeRequest(existingRequest),
      });
    }

    const userAgent = req.headers["user-agent"] || null;
    const clientHints = collectClientHints(parseClientHints(req.headers), req.body ? req.body.deviceHints : null);
    const deviceSignals = resolveDeviceSignals({ userAgent, clientHints });

    let request;
    try {
      request = await prisma.deviceRecoveryRequest.create({
        data: {
          userId,
          noteKey: trimmedNoteKey,
          purchaseOrderId: eligibility.purchase.id,
          status: "PENDING",
          activeMarker: ACTIVE_MARKER,
          description: validatedDescription.value,
          userAgent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
          browserName: deviceSignals.browserName,
          browserVersion: deviceSignals.browserVersion,
          osName: deviceSignals.osName,
          osVersion: deviceSignals.osVersion,
          osVersionSource: deviceSignals.osVersionSource,
          deviceModel: deviceSignals.deviceModel,
          deviceModelSource: deviceSignals.deviceModelSource,
          deviceFingerprint: presentedFingerprint.slice(0, 250),
        },
      });
    } catch (error) {
      if (error.code === "P2002") {
        const active = await prisma.deviceRecoveryRequest.findFirst({
          where: { userId, noteKey: trimmedNoteKey, status: "PENDING" },
        });
        return res.status(409).json({
          success: false,
          message: "A recovery request for this purchase is already pending review",
          activeRequest: serializeRequest(active),
        });
      }
      throw error;
    }

    offerClientHints(res);

    return res.status(201).json({
      success: true,
      message: "Recovery request submitted",
      noteTitle: config ? config.title : null,
      purchase: serializePurchase(eligibility.purchase),
      request: serializeRequest(request),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminListRecoveryRequests = async (req, res) => {
  try {
    const { status, q, sort, order, page, limit } = req.query;

    const where = {};
    if (status && RECOVERY_STATUSES.includes(status)) where.status = status;

    const search = typeof q === "string" ? q.trim() : "";
    if (search) {
      where.OR = [
        { id: search },
        { user: { username: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { noteKey: { contains: search, mode: "insensitive" } },
        { config: { title: { contains: search, mode: "insensitive" } } },
      ];
    }

    const sortField = SORTABLE_FIELDS[sort] || "createdAt";
    const sortOrder = order === "asc" ? "asc" : "desc";
    const take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const currentPage = Math.max(parseInt(page, 10) || 1, 1);

    const [total, requests] = await Promise.all([
      prisma.deviceRecoveryRequest.count({ where }),
      prisma.deviceRecoveryRequest.findMany({
        where,
        orderBy: [{ [sortField]: sortOrder }, { createdAt: "desc" }],
        skip: (currentPage - 1) * take,
        take,
        include: {
          user: { select: { id: true, username: true, email: true } },
          config: { select: { noteKey: true, title: true, price: true, isEnabled: true } },
          purchaseOrder: {
            select: {
              id: true,
              razorpayOrderId: true,
              amount: true,
              currency: true,
              status: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: currentPage,
      limit: take,
      requests: requests.map((request) => ({
        ...serializeRequest(request),
        user: request.user,
        note: request.config
          ? { noteKey: request.config.noteKey, title: request.config.title, isEnabled: request.config.isEnabled }
          : { noteKey: request.noteKey, title: null, isEnabled: null },
        purchase: serializePurchase(request.purchaseOrder),
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminGetRecoveryRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await prisma.deviceRecoveryRequest.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true, createdAt: true } },
        config: { select: { noteKey: true, title: true, price: true, isEnabled: true } },
        purchaseOrder: true,
      },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Recovery request not found" });
    }

    const [entitlement, purchaseHistory, events] = await Promise.all([
      prisma.noteEntitlement.findUnique({
        where: { userId_noteKey: { userId: request.userId, noteKey: request.noteKey } },
        include: { registeredDevice: true },
      }),
      prisma.purchaseOrder.findMany({
        where: { userId: request.userId, noteKey: request.noteKey },
        orderBy: { createdAt: "desc" },
      }),
      prisma.deviceAuthEvent.findMany({
        where: { userId: request.userId, noteKey: request.noteKey },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    const registeredDevice = sanitizeRegisteredDevice(entitlement ? entitlement.registeredDevice : null);
    const purchaseRegistration = events.find((event) => event.eventType === "PURCHASE_DEVICE_REGISTERED") || null;
    const purchaseDeviceSignals = purchaseRegistration
      ? resolveDeviceSignals({ userAgent: purchaseRegistration.userAgent })
      : null;
    const currentSignals = sanitizeStoredRequestSignals(request);

    const boundPurchase =
      request.purchaseOrder ||
      purchaseHistory.find((purchase) => purchase.status === "captured") ||
      null;

    const entitlementRaw = entitlement ? entitlement.registeredDevice : null;
    const fingerprintMatch =
      request.deviceFingerprint && entitlementRaw && entitlementRaw.fingerprint
        ? request.deviceFingerprint === entitlementRaw.fingerprint
        : null;

    return res.status(200).json({
      success: true,
      request: serializeRequest(request),
      user: request.user,
      note: request.config
        ? { noteKey: request.config.noteKey, title: request.config.title, price: request.config.price, isEnabled: request.config.isEnabled }
        : { noteKey: request.noteKey, title: null, price: null, isEnabled: null },
      purchase: serializePurchase(boundPurchase),
      purchaseHistory: purchaseHistory.map(serializePurchase),
      entitlement: {
        exists: Boolean(entitlement),
        active: Boolean(entitlement),
        createdAt: entitlement ? entitlement.createdAt : null,
      },
      registeredDevice,
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actor: event.actor,
        detail: event.detail,
        userAgent: event.userAgent,
        fingerprint: event.fingerprint,
        createdAt: event.createdAt,
      })),
      comparison: {
        purchaseTime: {
          userAgent: purchaseRegistration ? purchaseRegistration.userAgent : null,
          browserName: purchaseDeviceSignals ? purchaseDeviceSignals.browserName : null,
          browserVersion: purchaseDeviceSignals ? purchaseDeviceSignals.browserVersion : null,
          osName: purchaseDeviceSignals ? purchaseDeviceSignals.osName : null,
          osVersion: purchaseDeviceSignals ? purchaseDeviceSignals.osVersion : null,
          osVersionSource: purchaseDeviceSignals ? purchaseDeviceSignals.osVersionSource : null,
          deviceModel: purchaseDeviceSignals ? purchaseDeviceSignals.deviceModel : null,
          deviceModelSource: purchaseDeviceSignals ? purchaseDeviceSignals.deviceModelSource : null,
          fingerprint: purchaseRegistration ? purchaseRegistration.fingerprint : null,
          recordedAt: purchaseRegistration ? purchaseRegistration.createdAt : registeredDevice.registeredAt,
        },
        currentTime: {
          userAgent: request.userAgent,
          browserName: request.browserName,
          browserVersion: request.browserVersion,
          osName: request.osName,
          osVersion: currentSignals.osVersion,
          osVersionSource: currentSignals.osVersionSource,
          deviceModel: currentSignals.deviceModel,
          deviceModelSource: currentSignals.deviceModelSource,
          fingerprint: request.deviceFingerprint,
          recordedAt: request.createdAt,
        },
        fingerprintMatch,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminApproveRecoveryRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminName = String(req.headers.username || "admin");

    const request = await prisma.deviceRecoveryRequest.findUnique({
      where: { id },
      include: { user: true, config: true },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Recovery request not found" });
    }

    if (request.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: `This request has already been ${request.status.toLowerCase()}`,
        status: request.status,
      });
    }

    if (!request.user) {
      return res.status(404).json({ success: false, message: "Requester account not found" });
    }

    if (adminName === request.user.username || adminName === request.user.email) {
      return res.status(403).json({
        success: false,
        message: "You cannot approve a recovery request submitted by your own account",
      });
    }

    const { entitlement, purchases, eligibility } = await loadPurchaseContext(
      request.userId,
      request.noteKey
    );

    if (!eligibility.eligible || !entitlement) {
      return res.status(409).json({
        success: false,
        message: INELIGIBLE_MESSAGES[eligibility.reason] || "Purchase is no longer eligible for recovery",
        reason: eligibility.reason,
      });
    }

    const hasStoredFingerprint = Boolean(request.deviceFingerprint);
    const existingDevice = entitlement.registeredDevice;
    if (!hasStoredFingerprint && !existingDevice) {
      return res.status(409).json({
        success: false,
        message: "No current device fingerprint was captured for this request, so the device cannot be reauthorized",
      });
    }

    const now = new Date();
    const newDeviceToken = generateDeviceToken();
    const fingerprintToBind = hasStoredFingerprint ? request.deviceFingerprint : existingDevice.fingerprint;

    const resolved = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deviceRecoveryRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: {
          status: "APPROVED",
          activeMarker: null,
          resolvedBy: adminName,
          resolvedAt: now,
          emailLastError: null,
        },
      });

      if (claimed.count === 0) return null;

      if (existingDevice) {
        await tx.registeredDevice.update({
          where: { entitlementId: entitlement.id },
          data: {
            deviceToken: newDeviceToken,
            fingerprint: fingerprintToBind,
            lastSeenAt: now,
            resetAt: now,
          },
        });
      } else {
        await tx.registeredDevice.create({
          data: {
            entitlementId: entitlement.id,
            fingerprint: fingerprintToBind,
            deviceToken: newDeviceToken,
          },
        });
      }

      await tx.deviceAuthEvent.create({
        data: {
          userId: request.userId,
          noteKey: request.noteKey,
          entitlementId: entitlement.id,
          eventType: "RECOVERY_APPROVED",
          actor: adminName,
          detail: JSON.stringify({
            requestId: request.id,
            action: "device_rebound",
            deviceTokenRotated: true,
            adminUserAgent: req.headers["user-agent"] || null,
          }),
          userAgent: request.userAgent,
          fingerprint: request.deviceFingerprint,
        },
      });

      return true;
    });

    if (!resolved) {
      return res.status(409).json({
        success: false,
        message: "This request was already resolved by another admin",
      });
    }

    const updated = await prisma.deviceRecoveryRequest.findUnique({ where: { id: request.id } });
    const emailResult = await deliverDecisionEmail(updated, request.user, request.config);

    return res.status(200).json({
      success: true,
      message: "Request approved and current device reauthorized",
      request: serializeRequest(updated),
      emailSent: emailResult.emailSent,
      ...(emailResult.emailError ? { emailError: emailResult.emailError } : {}),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminRejectRecoveryRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminName = String(req.headers.username || "admin");
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

    if (reason.length < 5) {
      return res.status(400).json({ success: false, message: "A rejection reason is required" });
    }
    if (reason.length > 1000) {
      return res.status(400).json({ success: false, message: "Rejection reason must be 1000 characters or fewer" });
    }

    const request = await prisma.deviceRecoveryRequest.findUnique({
      where: { id },
      include: { user: true, config: true },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Recovery request not found" });
    }

    if (request.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: `This request has already been ${request.status.toLowerCase()}`,
        status: request.status,
      });
    }

    if (!request.user) {
      return res.status(404).json({ success: false, message: "Requester account not found" });
    }

    const now = new Date();

    const resolved = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deviceRecoveryRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: {
          status: "REJECTED",
          activeMarker: null,
          rejectionReason: reason,
          resolvedBy: adminName,
          resolvedAt: now,
          emailLastError: null,
        },
      });

      if (claimed.count === 0) return null;

      await tx.deviceAuthEvent.create({
        data: {
          userId: request.userId,
          noteKey: request.noteKey,
          eventType: "RECOVERY_REJECTED",
          actor: adminName,
          detail: JSON.stringify({
            requestId: request.id,
            reason,
            adminUserAgent: req.headers["user-agent"] || null,
          }),
          userAgent: request.userAgent,
          fingerprint: request.deviceFingerprint,
        },
      });

      return true;
    });

    if (!resolved) {
      return res.status(409).json({
        success: false,
        message: "This request was already resolved by another admin",
      });
    }

    const updated = await prisma.deviceRecoveryRequest.findUnique({ where: { id: request.id } });
    const emailResult = await deliverDecisionEmail(updated, request.user, request.config);

    return res.status(200).json({
      success: true,
      message: "Request rejected",
      request: serializeRequest(updated),
      emailSent: emailResult.emailSent,
      ...(emailResult.emailError ? { emailError: emailResult.emailError } : {}),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminResendRecoveryNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await prisma.deviceRecoveryRequest.findUnique({
      where: { id },
      include: { user: true, config: true },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Recovery request not found" });
    }

    if (request.status === "PENDING") {
      return res.status(409).json({
        success: false,
        message: "Notifications can only be sent after a request has been resolved",
      });
    }

    if (!request.user) {
      return res.status(404).json({ success: false, message: "Requester account not found" });
    }

    const emailResult = await deliverDecisionEmail(request, request.user, request.config);

    return res.status(200).json({
      success: emailResult.emailSent,
      message: emailResult.emailSent ? "Notification sent" : "Email delivery failed",
      emailSent: emailResult.emailSent,
      ...(emailResult.emailError ? { emailError: emailResult.emailError } : {}),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
