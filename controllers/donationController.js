import Razorpay from "razorpay";
import crypto from "crypto";
import prisma from "../lib/prisma.js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MIN_AMOUNT_INR = 2;
const MAX_AMOUNT_INR = 500000;

function validateAmount(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_AMOUNT_INR) return null;
  if (parsed > MAX_AMOUNT_INR) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(String(amount).trim())) return null;
  return Math.round(parsed * 100);
}

export const createOrder = async (req, res) => {
  try {
    const { amount } = req.body;

    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      });
    }

    const amountInPaise = validateAmount(amount);

    if (!amountInPaise) {
      return res.status(400).json({
        success: false,
        message: `Minimum donation amount is ₹${MIN_AMOUNT_INR}`,
      });
    }

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });

    const userId = req.userId || null;

    await prisma.donation.create({
      data: {
        userId,
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
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create payment order",
    });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing payment verification fields",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    const existing = await prisma.donation.findUnique({
      where: { razorpayPaymentId: razorpay_payment_id },
    });

    if (existing && existing.status === "captured") {
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        amount: existing.amount,
      });
    }

    const donation = await prisma.donation.update({
      where: { razorpayOrderId: razorpay_order_id },
      data: {
        razorpayPaymentId: razorpay_payment_id,
        status: "captured",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      amount: donation.amount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Payment verification error",
    });
  }
};

export const handleWebhook = async (req, res) => {
  try {
    const razorpaySignature = req.headers["x-razorpay-signature"];

    if (!razorpaySignature) {
      return res.status(400).json({ success: false, message: "Missing webhook signature" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }

    const event = req.body;
    const eventId = event.id;
    const eventType = event.event;

    if (!eventId || !eventType) {
      return res.status(400).json({ success: false, message: "Invalid webhook payload" });
    }

    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { razorpayEventId: eventId },
    });

    if (existingEvent && existingEvent.processed) {
      return res.status(200).json({ success: true, message: "Event already processed" });
    }

    await prisma.webhookEvent.upsert({
      where: { razorpayEventId: eventId },
      create: {
        razorpayEventId: eventId,
        eventType,
        processed: false,
      },
      update: {},
    });

    const payload = event.payload;

    if (eventType === "payment.captured") {
      const payment = payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        await prisma.donation.updateMany({
          where: { razorpayOrderId: payment.order_id },
          data: {
            razorpayPaymentId: payment.id,
            status: "captured",
            paymentMethod: payment.method || null,
            webhookProcessedAt: new Date(),
          },
        });
      }
    } else if (eventType === "payment.failed") {
      const payment = payload?.payment?.entity;
      if (payment?.order_id) {
        await prisma.donation.updateMany({
          where: {
            razorpayOrderId: payment.order_id,
            status: { not: "captured" },
          },
          data: {
            status: "failed",
            webhookProcessedAt: new Date(),
          },
        });
      }
    } else if (eventType === "order.paid") {
      const order = payload?.order?.entity;
      if (order?.id) {
        await prisma.donation.updateMany({
          where: {
            razorpayOrderId: order.id,
            status: { not: "captured" },
          },
          data: {
            status: "captured",
            webhookProcessedAt: new Date(),
          },
        });
      }
    } else if (
      eventType === "refund.created" ||
      eventType === "refund.processed"
    ) {
      const refund = payload?.refund?.entity;
      if (refund?.payment_id) {
        await prisma.donation.updateMany({
          where: { razorpayPaymentId: refund.payment_id },
          data: {
            status: "refunded",
            webhookProcessedAt: new Date(),
          },
        });
      }
    } else if (eventType === "refund.failed") {
      const refund = payload?.refund?.entity;
      if (refund?.payment_id) {
        await prisma.donation.updateMany({
          where: { razorpayPaymentId: refund.payment_id },
          data: {
            status: "refund_failed",
            webhookProcessedAt: new Date(),
          },
        });
      }
    }

    await prisma.webhookEvent.update({
      where: { razorpayEventId: eventId },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Webhook processing error" });
  }
};