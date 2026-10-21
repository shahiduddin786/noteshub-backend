import prisma from "../lib/prisma.js";
import {
  normalizeCouponCode,
  generateCouponCode,
  calculateCouponDiscount,
  COUPON_HOLD_MS,
} from "../utils/coupon.js";

const MAX_CODE_GENERATION_ATTEMPTS = 5;

const normalizeStatus = (coupon) => {
  if (coupon.status === "active" && coupon.expiresAt.getTime() <= Date.now()) {
    return "expired";
  }
  return coupon.status;
};

const publicCoupon = (coupon) => {
  const pricing = coupon.config
    ? calculateCouponDiscount(coupon.config.price, coupon.discountPercent)
    : null;
  return {
    id: coupon.id,
    code: coupon.code,
    recipientName: coupon.recipientName,
    recipientEmail: coupon.recipientEmail,
    recipientPhone: coupon.recipientPhone,
    noteKey: coupon.noteKey,
    noteTitle: coupon.config?.title ?? null,
    currentPricePaise: pricing?.originalPricePaise ?? null,
    discountPercent: coupon.discountPercent,
    discountAmountPaise: pricing?.discountAmountPaise ?? null,
    finalPricePaise: pricing?.finalPricePaise ?? null,
    status: normalizeStatus(coupon),
    boundToAccount: !!coupon.userId,
    redeemedAt: coupon.redeemedAt,
    revokedAt: coupon.revokedAt,
    expiresAt: coupon.expiresAt,
    createdAt: coupon.createdAt,
  };
};

export const checkCouponForPurchase = async ({ code, userId, noteKey }) => {
  const normalized = normalizeCouponCode(code);
  if (!normalized) {
    return { valid: false, message: "Invalid coupon code." };
  }

  const coupon = await prisma.coupon.findUnique({
    where: { code: normalized },
    include: { config: true },
  });

  if (!coupon) {
    return { valid: false, message: "Invalid coupon code." };
  }
  if (coupon.expiresAt.getTime() <= Date.now()) {
    return { valid: false, message: "This coupon has expired." };
  }
  if (coupon.status === "revoked") {
    return { valid: false, message: "This coupon has been revoked." };
  }
  if (coupon.status === "redeemed") {
    return { valid: false, message: "This coupon has already been used." };
  }
  if (coupon.noteKey !== noteKey) {
    return { valid: false, message: "This coupon is not valid for this note." };
  }
  if (coupon.userId && coupon.userId !== userId) {
    return { valid: false, message: "This coupon was issued to a different account." };
  }
  if (!coupon.config || !coupon.config.isEnabled) {
    return { valid: false, message: "This note is not available for purchase." };
  }

  const existingEntitlement = await prisma.noteEntitlement.findUnique({
    where: { userId_noteKey: { userId, noteKey } },
  });
  if (existingEntitlement) {
    return { valid: false, message: "You already own this note." };
  }

  const { originalPricePaise, discountAmountPaise, finalPricePaise } = calculateCouponDiscount(
    coupon.config.price,
    coupon.discountPercent
  );

  return {
    valid: true,
    coupon,
    code: normalized,
    originalPricePaise,
    discountPercent: coupon.discountPercent,
    discountAmountPaise,
    finalPricePaise,
  };
};

export const claimCouponHold = async (code) => {
  const now = new Date();
  const result = await prisma.coupon.updateMany({
    where: {
      code,
      status: "active",
      expiresAt: { gt: now },
      OR: [{ heldUntil: null }, { heldUntil: { lte: now } }],
    },
    data: { heldUntil: new Date(now.getTime() + COUPON_HOLD_MS), heldOrderId: "pending" },
  });
  return result.count === 1;
};

export const attachCouponHold = async (code, razorpayOrderId) => {
  await prisma.coupon.updateMany({
    where: { code, heldOrderId: "pending" },
    data: { heldOrderId: razorpayOrderId },
  });
};

export const releaseCouponHold = async (code, razorpayOrderId) => {
  if (!code) return;
  await prisma.coupon.updateMany({
    where: { code, heldOrderId: razorpayOrderId },
    data: { heldUntil: null, heldOrderId: null },
  });
};

export const redeemCouponForOrder = async (tx, code, razorpayOrderId) => {
  const result = await tx.coupon.updateMany({
    where: {
      code,
      status: "active",
      OR: [{ expiresAt: { gt: new Date() } }, { heldOrderId: razorpayOrderId }],
    },
    data: {
      status: "redeemed",
      redeemedAt: new Date(),
      heldUntil: null,
      heldOrderId: null,
    },
  });
  return result.count === 1;
};

export const validateCoupon = async (req, res) => {
  try {
    const { code, noteKey } = req.body;
    const userId = req.userId;

    const config = await prisma.paidNoteConfig.findUnique({ where: { noteKey } });
    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Paid note not found" });
    }

    const result = await checkCouponForPurchase({ code, userId, noteKey });
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }

    return res.status(200).json({
      success: true,
      code: result.coupon.code,
      noteKey: config.noteKey,
      originalPricePaise: result.originalPricePaise,
      discountPercent: result.discountPercent,
      discountAmountPaise: result.discountAmountPaise,
      finalPricePaise: result.finalPricePaise,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getEligibleCoupon = async (req, res) => {
  try {
    const noteKey = req.params[0];
    const userId = req.userId;

    if (!noteKey) {
      return res.status(400).json({ success: false, message: "noteKey is required" });
    }

    const config = await prisma.paidNoteConfig.findUnique({ where: { noteKey } });
    if (!config || !config.isEnabled) {
      return res.status(404).json({ success: false, message: "Paid note not found" });
    }

    const entitlement = await prisma.noteEntitlement.findUnique({
      where: { userId_noteKey: { userId, noteKey } },
    });
    if (entitlement) {
      return res.status(200).json({ success: true, eligible: false, discountPercent: null });
    }

    const coupon = await prisma.coupon.findFirst({
      where: {
        userId,
        noteKey,
        status: "active",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!coupon) {
      return res.status(200).json({ success: true, eligible: false, discountPercent: null });
    }

    return res.status(200).json({
      success: true,
      eligible: true,
      discountPercent: coupon.discountPercent,
      expiresAt: coupon.expiresAt,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminCreateCoupon = async (req, res) => {
  try {
    const { name, email, phone, noteKey, discountPercent, expiresAt } = req.body;

    const config = await prisma.paidNoteConfig.findUnique({ where: { noteKey } });
    if (!config || !config.isEnabled) {
      return res.status(400).json({ success: false, message: "Selected note is not a valid enabled paid note" });
    }

    const expiryDate = new Date(expiresAt);
    if (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: "Expiry date and time must be in the future" });
    }

    const percent = Number(discountPercent);
    const { originalPricePaise, discountAmountPaise, finalPricePaise } = calculateCouponDiscount(config.price, percent);

    const recipientEmail = email.trim().toLowerCase();
    const recipient = await prisma.user.findFirst({
      where: { email: { equals: recipientEmail, mode: "insensitive" } },
    });

    let coupon = null;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS && !coupon; attempt += 1) {
      const code = generateCouponCode();
      try {
        coupon = await prisma.coupon.create({
          data: {
            code,
            userId: recipient?.id ?? null,
            recipientName: name.trim(),
            recipientEmail,
            recipientPhone: phone ? phone.trim() : null,
            noteKey: config.noteKey,
            discountPercent: percent,
            expiresAt: expiryDate,
          },
          include: { config: true, user: { select: { id: true, username: true, email: true } } },
        });
      } catch (error) {
        if (error.code === "P2002") continue;
        throw error;
      }
    }

    if (!coupon) {
      return res.status(500).json({ success: false, message: "Failed to generate a unique coupon code. Please try again." });
    }

    return res.status(201).json({
      success: true,
      coupon: publicCoupon(coupon),
      boundToAccount: !!recipient,
      preview: {
        originalPricePaise,
        discountPercent: percent,
        discountAmountPaise,
        finalPricePaise,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminListCoupons = async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = {};

    if (search && String(search).trim()) {
      const term = String(search).trim();
      where.OR = [
        { code: { contains: term, mode: "insensitive" } },
        { recipientName: { contains: term, mode: "insensitive" } },
        { recipientEmail: { contains: term, mode: "insensitive" } },
        { noteKey: { contains: term, mode: "insensitive" } },
      ];
    }

    if (status === "expired") {
      where.status = "active";
      where.expiresAt = { lte: new Date() };
    } else if (["active", "redeemed", "revoked"].includes(status)) {
      where.status = status;
    }

    const coupons = await prisma.coupon.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        config: { select: { noteKey: true, title: true, price: true, isEnabled: true } },
        user: { select: { id: true, username: true, email: true } },
      },
    });

    return res.status(200).json({ success: true, coupons: coupons.map(publicCoupon) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminRevokeCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    if (coupon.status === "redeemed") {
      return res.status(400).json({ success: false, message: "A redeemed coupon cannot be revoked" });
    }
    if (coupon.status === "revoked") {
      return res.status(200).json({ success: true, message: "Coupon is already revoked" });
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: { status: "revoked", revokedAt: new Date(), heldUntil: null, heldOrderId: null },
      include: { config: true },
    });

    return res.status(200).json({ success: true, coupon: publicCoupon(updated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
