import Razorpay from "razorpay";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { v2 as cloudinary } from "cloudinary";
import prisma from "../lib/prisma.js";

const generateDeviceToken = () => crypto.randomBytes(32).toString("hex");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SIGNED_URL_EXPIRY_SECONDS = 900;

export const getPaidNoteFileList = async (req, res) => {
  try {
    const noteKey = req.params[0];
    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const config = await prisma.paidNoteConfig.findUnique({ where: { noteKey } });
    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const cloudinaryFolder = `noteshub/${noteKey}`;
    let cloudinaryNames = [];
    try {
      const result = await cloudinary.api.resources_by_asset_folder(cloudinaryFolder, {
        max_results: 50,
        resource_type: "image",
      });
      cloudinaryNames = (result.resources || []).map((r) => ({
        name: (r.display_name || r.public_id.split("/").pop()).replace(/\.pdf$/i, ""),
        provider: "cloudinary",
        publicId: r.public_id,
      }));
    } catch {}

    const supabasePath = noteKey;
    let supabaseNames = [];
    try {
      const { data: fileList, error } = await supabase.storage
        .from("notes")
        .list(supabasePath, { limit: 50 });
      if (!error && fileList) {
        supabaseNames = fileList
          .filter((f) => f.name.endsWith(".pdf"))
          .map((f) => ({
            name: f.name.replace(/\.pdf$/i, ""),
            provider: "supabase",
            publicId: null,
          }));
      }
    } catch {}

    const files = [...cloudinaryNames, ...supabaseNames];

    return res.status(200).json({
      success: true,
      noteKey: config.noteKey,
      title: config.title,
      price: config.price,
      files,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getPaidNoteConfig = async (req, res) => {
  try {
    const noteKey = req.params[0];
    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const config = await prisma.paidNoteConfig.findUnique({
      where: { noteKey },
    });

    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Paid note config not found" });
    }

    return res.status(200).json({
      success: true,
      noteKey: config.noteKey,
      title: config.title,
      price: config.price,
      isEnabled: config.isEnabled,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createPurchaseOrder = async (req, res) => {
  try {
    const { noteKey } = req.body;
    const userId = req.userId;

    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const config = await prisma.paidNoteConfig.findUnique({
      where: { noteKey },
    });

    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Paid note not found or disabled" });
    }

    const existingEntitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
    });

    if (existingEntitlement) {
      return res.status(400).json({ success: false, message: "You already own this note" });
    }

    const amountInPaise = config.price * 100;

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `pnote_${Date.now()}`,
    });

    await prisma.purchaseOrder.create({
      data: {
        userId,
        noteKey,
        razorpayOrderId: order.id,
        amount: amountInPaise,
        currency: "INR",
        status: "created",
      },
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: amountInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      noteTitle: config.title,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to create order" });
  }
};

export const verifyPurchase = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, deviceFingerprint } = req.body;
    const userId = req.userId;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !deviceFingerprint) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { razorpayOrderId: razorpay_order_id },
    });

    if (!order || order.userId !== userId) {
      return res.status(403).json({ success: false, message: "Order mismatch" });
    }

    if (order.status === "captured") {
      return res.status(200).json({ success: true, message: "Already verified" });
    }

    const existingEntitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey: order.noteKey } },
    });

    if (existingEntitlement) {
      await prisma.purchaseOrder.update({
        where: { razorpayOrderId: razorpay_order_id },
        data: { razorpayPaymentId: razorpay_payment_id, status: "captured" },
      });
      return res.status(200).json({ success: true, message: "Already owns this note" });
    }

    const newDeviceToken = generateDeviceToken();

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { razorpayOrderId: razorpay_order_id },
        data: { razorpayPaymentId: razorpay_payment_id, status: "captured" },
      });

      const entitlement = await tx.noteEntitlement.create({
        data: { userId, noteKey: order.noteKey },
      });

      await tx.registeredDevice.create({
        data: {
          entitlementId: entitlement.id,
          fingerprint: deviceFingerprint,
          deviceToken: newDeviceToken,
        },
      });
    });

    return res.status(200).json({ success: true, message: "Purchase verified. Access granted.", deviceToken: newDeviceToken });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Verification error" });
  }
};

export const checkEntitlement = async (req, res) => {
  try {
    const noteKey = req.params[0];
    const userId = req.userId;
    const deviceToken = req.headers["x-device-token"];
    const deviceFingerprint = req.headers["x-device-fingerprint"];

    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const entitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
      include: { registeredDevice: true },
    });

    if (!entitlement) {
      return res.status(403).json({ success: false, message: "No entitlement" });
    }

    if (!entitlement.registeredDevice) {
      return res.status(403).json({ success: false, message: "Device not authorized" });
    }

    if (!deviceToken) {
      if (!deviceFingerprint || entitlement.registeredDevice.fingerprint !== deviceFingerprint) {
        return res.status(403).json({ success: false, message: "Device not authorized" });
      }
      await prisma.registeredDevice.update({
        where: { entitlementId: entitlement.id },
        data: { lastSeenAt: new Date() },
      });
      return res.status(200).json({
        success: true,
        hasAccess: true,
        deviceToken: entitlement.registeredDevice.deviceToken,
      });
    }

    if (entitlement.registeredDevice.deviceToken !== deviceToken) {
      return res.status(403).json({ success: false, message: "Device not authorized" });
    }

    if (deviceFingerprint && entitlement.registeredDevice.fingerprint !== deviceFingerprint) {
      return res.status(403).json({ success: false, message: "Device not authorized" });
    }

    await prisma.registeredDevice.update({
      where: { entitlementId: entitlement.id },
      data: { lastSeenAt: new Date() },
    });

    return res.status(200).json({ success: true, hasAccess: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getSignedAccess = async (req, res) => {
  try {
    const noteKey = req.params[0];
    const userId = req.userId;
    const deviceFingerprint = req.headers["x-device-fingerprint"];

    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const config = await prisma.paidNoteConfig.findUnique({
      where: { noteKey },
    });

    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    const deviceToken = req.headers["x-device-token"];

    if (!deviceToken) {
      return res.status(403).json({ success: false, message: "Device token missing" });
    }

    const entitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
      include: { registeredDevice: true },
    });

    if (!entitlement) {
      return res.status(403).json({ success: false, message: "No entitlement" });
    }

    if (!entitlement.registeredDevice) {
      return res.status(403).json({ success: false, message: "Device not authorized" });
    }

    if (entitlement.registeredDevice.deviceToken !== deviceToken) {
      return res.status(403).json({ success: false, message: "Device not authorized" });
    }

    if (deviceFingerprint && entitlement.registeredDevice.fingerprint !== deviceFingerprint) {
      return res.status(403).json({ success: false, message: "Device not authorized" });
    }

    await prisma.registeredDevice.update({
      where: { entitlementId: entitlement.id },
      data: { lastSeenAt: new Date() },
    });

    const cloudinaryFolder = `noteshub/${noteKey}`;

    let cloudinaryResources = [];
    try {
      const result = await cloudinary.api.resources_by_asset_folder(cloudinaryFolder, {
        max_results: 50,
        resource_type: "image",
      });
      cloudinaryResources = result.resources || [];
    } catch (e) {
      cloudinaryResources = [];
    }

    const supabasePath = noteKey;
    let supabaseFiles = [];
    try {
      const { data: fileList, error } = await supabase.storage
        .from("notes")
        .list(supabasePath, { limit: 50 });
      if (!error && fileList) {
        supabaseFiles = fileList.filter((f) => f.name.endsWith(".pdf"));
      }
    } catch (e) {
      supabaseFiles = [];
    }

    if (cloudinaryResources.length === 0 && supabaseFiles.length === 0) {
      return res.status(404).json({ success: false, message: "No files found for this note" });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRY_SECONDS;

    const cloudinarySigned = cloudinaryResources.map((resource) => {
      const signedUrl = cloudinary.url(resource.public_id, {
        resource_type: "image",
        type: "upload",
        sign_url: true,
        expires_at: expiresAt,
        secure: true,
      });
      return {
        name: resource.display_name || resource.public_id.split("/").pop(),
        signedUrl,
        expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
        provider: "cloudinary",
      };
    });

    const supabaseSigned = await Promise.all(
      supabaseFiles.map(async (file) => {
        const filePath = `${supabasePath}/${file.name}`;
        const { data, error } = await supabase.storage
          .from("notes")
          .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS);
        if (error || !data?.signedUrl) return null;
        return {
          name: file.name,
          signedUrl: data.signedUrl,
          expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
          provider: "supabase",
        };
      })
    );

    const validFiles = [...cloudinarySigned, ...supabaseSigned.filter(Boolean)];

    if (validFiles.length === 0) {
      return res.status(500).json({ success: false, message: "Failed to generate signed URLs" });
    }

    return res.status(200).json({
      success: true,
      noteTitle: config.title,
      userEmail: req.user.email,
      files: validFiles,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};  
export const streamPaidFile = async (req, res) => {
  try {
    const noteKey = req.params[0];
    const fileName = req.params.fileName;
    const userId = req.userId;
    const deviceToken = req.headers["x-device-token"];
    const deviceFingerprint = req.headers["x-device-fingerprint"];

    if (!noteKey || !fileName || !deviceToken) {
      return res.status(400).json({ success: false, message: "Missing required params" });
    }

    const config = await prisma.paidNoteConfig.findUnique({ where: { noteKey } });
    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    const entitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
      include: { registeredDevice: true },
    });

    if (!entitlement) return res.status(403).json({ success: false, message: "No entitlement" });
    if (!entitlement.registeredDevice) return res.status(403).json({ success: false, message: "Device not authorized" });
    if (entitlement.registeredDevice.deviceToken !== deviceToken) return res.status(403).json({ success: false, message: "Device not authorized" });
    if (deviceFingerprint && entitlement.registeredDevice.fingerprint !== deviceFingerprint) return res.status(403).json({ success: false, message: "Device not authorized" });

    await prisma.registeredDevice.update({
      where: { entitlementId: entitlement.id },
      data: { lastSeenAt: new Date() },
    });

    const cloudinaryFolder = `noteshub/${noteKey}`;
    let targetResource = null;

    try {
      const result = await cloudinary.api.resources_by_asset_folder(cloudinaryFolder, {
        max_results: 50,
        resource_type: "image",
      });
      targetResource = (result.resources || []).find((r) => {
        const resName = (r.display_name || r.public_id.split("/").pop()).replace(/\.pdf$/i, "");
        return resName === fileName || r.public_id.split("/").pop() === fileName;
      });
    } catch {}

    if (targetResource) {
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      const signedUrl = cloudinary.url(targetResource.public_id, {
        resource_type: "image",
        type: "upload",
        sign_url: true,
        expires_at: expiresAt,
        secure: true,
      });

      const upstream = await fetch(signedUrl);
      if (!upstream.ok) return res.status(502).json({ success: false, message: "Failed to fetch file" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const buffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }

    const supabasePath = `${noteKey}/${fileName}.pdf`;
    const { data, error } = await supabase.storage.from("notes").createSignedUrl(supabasePath, 60);
    if (error || !data?.signedUrl) return res.status(404).json({ success: false, message: "File not found" });

    const upstream = await fetch(data.signedUrl);
    if (!upstream.ok) return res.status(502).json({ success: false, message: "Failed to fetch file" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const buffer = await upstream.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminCreatePaidNote = async (req, res) => {
  try {
    const { noteKey, title, price, isEnabled } = req.body;

    if (!noteKey || !title || price === undefined) {
      return res.status(400).json({ success: false, message: "noteKey, title, and price are required" });
    }

    const parsedPrice = Number(price);
    if (!Number.isInteger(parsedPrice) || parsedPrice < 1) {
      return res.status(400).json({ success: false, message: "Price must be a positive integer (INR)" });
    }

    const existing = await prisma.paidNoteConfig.findUnique({ where: { noteKey } });
    if (existing) {
      return res.status(400).json({ success: false, message: "Config for this noteKey already exists" });
    }

    const config = await prisma.paidNoteConfig.create({
      data: {
        noteKey,
        title,
        price: parsedPrice,
        isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : true,
      },
    });

    return res.status(201).json({ success: true, config });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminUpdatePaidNote = async (req, res) => {
  try {
    const { noteKey } = req.params;
    const { title, price, isEnabled } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (price !== undefined) {
      const parsedPrice = Number(price);
      if (!Number.isInteger(parsedPrice) || parsedPrice < 1) {
        return res.status(400).json({ success: false, message: "Price must be a positive integer (INR)" });
      }
      updateData.price = parsedPrice;
    }
    if (isEnabled !== undefined) updateData.isEnabled = Boolean(isEnabled);

    const config = await prisma.paidNoteConfig.update({
      where: { noteKey },
      data: updateData,
    });

    return res.status(200).json({ success: true, config });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Config not found" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminDeletePaidNote = async (req, res) => {
  try {
    const { noteKey } = req.params;
    await prisma.paidNoteConfig.delete({ where: { noteKey } });
    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Config not found" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminListPaidNotes = async (req, res) => {
  try {
    const configs = await prisma.paidNoteConfig.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { entitlements: true, purchaseOrders: true } },
      },
    });
    return res.status(200).json({ success: true, configs });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminListPurchases = async (req, res) => {
  try {
    const { noteKey } = req.query;
    const where = noteKey ? { noteKey } : {};

    const purchases = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
    });

    return res.status(200).json({ success: true, purchases });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminResetDevice = async (req, res) => {
  try {
    const { userId, noteKey } = req.body;

    if (!userId || !noteKey) {
      return res.status(400).json({ success: false, message: "userId and noteKey are required" });
    }

    const entitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
      include: { registeredDevice: true },
    });

    if (!entitlement) {
      return res.status(404).json({ success: false, message: "Entitlement not found" });
    }

    if (!entitlement.registeredDevice) {
      return res.status(404).json({ success: false, message: "No registered device found" });
    }

    await prisma.registeredDevice.delete({
      where: { entitlementId: entitlement.id },
    });

    return res.status(200).json({ success: true, message: "Device reset. User can re-register on next purchase view." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};