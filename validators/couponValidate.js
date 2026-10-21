import * as yup from "yup";
import { validate } from "./userValidate.js";
import { COUPON_MAX_DISCOUNT_PERCENT } from "../utils/coupon.js";

export const couponCreateSchema = yup.object({
  name: yup
    .string()
    .trim()
    .min(2, "Recipient name must be at least 2 characters")
    .max(120, "Recipient name must be 120 characters or fewer")
    .required("Recipient name is required"),

  email: yup
    .string()
    .trim()
    .email("Recipient email is not valid")
    .max(254, "Recipient email must be 254 characters or fewer")
    .required("Recipient email is required"),

  phone: yup
    .string()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/, "Phone number is not valid")
    .nullable()
    .transform((value) => (value === "" ? null : value)),

  noteKey: yup
    .string()
    .trim()
    .min(3, "noteKey is invalid")
    .max(250, "noteKey is invalid")
    .required("A paid note must be selected"),

  discountPercent: yup
    .number()
    .typeError("Discount percentage must be a number")
    .integer("Discount percentage must be a whole number")
    .min(1, "Discount percentage must be greater than 0")
    .max(COUPON_MAX_DISCOUNT_PERCENT, `Discount percentage cannot exceed ${COUPON_MAX_DISCOUNT_PERCENT}%`)
    .required("Discount percentage is required"),

  expiresAt: yup
    .date()
    .typeError("Expiry date and time is not valid")
    .test(
      "is-future",
      "Expiry date and time must be in the future",
      (value) => value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() > Date.now()
    )
    .required("Expiry date and time is required"),
});

export const couponApplySchema = yup.object({
  code: yup
    .string()
    .trim()
    .min(4, "Coupon code is invalid")
    .max(64, "Coupon code is invalid")
    .required("Coupon code is required"),

  noteKey: yup
    .string()
    .trim()
    .min(3, "noteKey is invalid")
    .max(250, "noteKey is invalid")
    .required("noteKey is required"),
});

export { validate };
