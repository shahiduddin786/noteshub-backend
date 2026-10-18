import * as yup from "yup";

export const registerSchema = yup.object({
  name: yup
    .string()
    .trim()
    .min(3, "Name must be at least 3 characters")
    .required("Name is required"),

  email: yup
    .string()
    .email("Email is not valid")
    .required("Email is required"),

  password: yup
    .string()
    .min(6, "Password must be at least 6 characters")
    .required("Password is required"),
});

export const loginSchema = yup.object({
  email: yup
    .string()
    .email("Email is not valid")
    .required("Email is required"),

  password: yup
    .string()
    .required("Password is required"),
});

export const resetPasswordSchema = yup.object({
  newPassword: yup
    .string()
    .min(6, "Password must be at least 6 characters")
    .required("New password is required"),

  confirmPassword: yup
    .string()
    .oneOf([yup.ref("newPassword")], "Password doesn't match")
    .required("Confirm password is required"),
});

export const resetPasswordWithTokenSchema = resetPasswordSchema.shape({
  resetToken: yup
    .string()
    .required("Password reset verification is required"),
});

export const emailSchema = yup.object({
  email: yup
    .string()
    .email("Email is not valid")
    .required("Email is required"),
});

export const signupOtpSchema = yup.object({
  email: yup
    .string()
    .email("Email is not valid")
    .required("Email is required"),

  otp: yup
    .string()
    .matches(/^\d{6}$/, "OTP must be 6 digits")
    .required("OTP is required"),
});

export const validate = (schema) => async (req, res, next) => {
  try {
    await schema.validate(req.body, { abortEarly: false });
    next();
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.errors[0],
      errors: err.errors,
    });
  }
};
