import * as yup from "yup";
import { validate } from "./userValidate.js";

export const recoveryRequestSchema = yup.object({
  noteKey: yup
    .string()
    .trim()
    .min(3, "noteKey is invalid")
    .max(250, "noteKey is invalid")
    .required("noteKey is required"),

  description: yup
    .string()
    .trim()
    .min(10, "Please describe the problem in at least 10 characters")
    .max(2000, "Description must be 2000 characters or fewer")
    .required("Please describe the problem you are facing"),
});

export const recoveryRejectSchema = yup.object({
  reason: yup
    .string()
    .trim()
    .min(5, "A rejection reason is required")
    .max(1000, "Rejection reason must be 1000 characters or fewer")
    .required("A rejection reason is required"),
});

export { validate };
