import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCouponCode,
  normalizeCouponCode,
  calculateCouponDiscount,
  COUPON_CODE_LENGTH,
  COUPON_MAX_DISCOUNT_PERCENT,
} from "../utils/coupon.js";

test("generateCouponCode returns the configured length using only unambiguous characters", () => {
  const code = generateCouponCode();
  assert.equal(code.length, COUPON_CODE_LENGTH);
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
});

test("generateCouponCode produces unique codes across many draws", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    seen.add(generateCouponCode());
  }
  assert.equal(seen.size, 2000);
});

test("generateCouponCode honours a custom length", () => {
  assert.equal(generateCouponCode(6).length, 6);
});

test("normalizeCouponCode trims, uppercases, and strips inner spaces", () => {
  assert.equal(normalizeCouponCode("  abc def  "), "ABCDEF");
  assert.equal(normalizeCouponCode("XyZ123"), "XYZ123");
});

test("normalizeCouponCode returns empty string for non-string input", () => {
  assert.equal(normalizeCouponCode(null), "");
  assert.equal(normalizeCouponCode(undefined), "");
  assert.equal(normalizeCouponCode(12345), "");
});

test("calculateCouponDiscount computes the documented example: 200 at 25% => 5000 paise off, 15000 paise final", () => {
  const result = calculateCouponDiscount(200, 25);
  assert.equal(result.originalPricePaise, 20000);
  assert.equal(result.discountAmountPaise, 5000);
  assert.equal(result.finalPricePaise, 15000);
});

test("calculateCouponDiscount keeps paise precision: 99 at 50% => exactly 49.50", () => {
  const result = calculateCouponDiscount(99, 50);
  assert.equal(result.originalPricePaise, 9900);
  assert.equal(result.discountAmountPaise, 4950);
  assert.equal(result.finalPricePaise, 4950);
});

test("calculateCouponDiscount rounds fractional paise consistently: 99 at 10% => 9.90 off, 89.10 final", () => {
  const result = calculateCouponDiscount(99, 10);
  assert.equal(result.discountAmountPaise, 990);
  assert.equal(result.finalPricePaise, 8910);
});

test("calculateCouponDiscount supports the advertised maximum of 50%", () => {
  const result = calculateCouponDiscount(200, COUPON_MAX_DISCOUNT_PERCENT);
  assert.equal(result.discountAmountPaise, 10000);
  assert.equal(result.finalPricePaise, 10000);
});

test("calculateCouponDiscount never produces a payable amount below the Razorpay minimum of 1 rupee", () => {
  const result = calculateCouponDiscount(1, 50);
  assert.equal(result.finalPricePaise, 100);
});

test("calculateCouponDiscount rejects out-of-range discount percentages", () => {
  assert.throws(() => calculateCouponDiscount(200, 0));
  assert.throws(() => calculateCouponDiscount(200, -10));
  assert.throws(() => calculateCouponDiscount(200, 51));
  assert.throws(() => calculateCouponDiscount(200, NaN));
});

test("calculateCouponDiscount rejects invalid original prices", () => {
  assert.throws(() => calculateCouponDiscount(0, 25));
  assert.throws(() => calculateCouponDiscount(-100, 25));
  assert.throws(() => calculateCouponDiscount(199.99, 25));
});
