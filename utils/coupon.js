import crypto from "crypto";

export const COUPON_MAX_DISCOUNT_PERCENT = 50;
export const COUPON_CODE_LENGTH = 10;
export const COUPON_HOLD_MS = 20 * 60 * 1000;

const COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normalizeCouponCode = (code) =>
  typeof code === "string" ? code.trim().replace(/\s+/g, "").toUpperCase() : "";

export const generateCouponCode = (length = COUPON_CODE_LENGTH) => {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += COUPON_ALPHABET[crypto.randomInt(COUPON_ALPHABET.length)];
  }
  return code;
};

export const calculateCouponDiscount = (originalPrice, discountPercent) => {
  const price = Number(originalPrice);
  const percent = Number(discountPercent);

  if (!Number.isInteger(price) || price < 1) {
    throw new Error("Original price must be a positive integer");
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > COUPON_MAX_DISCOUNT_PERCENT) {
    throw new Error("Discount percentage must be between 1 and 50");
  }

  const originalPricePaise = price * 100;
  const discountAmountPaise = Math.round((originalPricePaise * percent) / 100);
  const finalPricePaise = Math.max(100, originalPricePaise - discountAmountPaise);

  return { originalPricePaise, discountAmountPaise, finalPricePaise };
};
