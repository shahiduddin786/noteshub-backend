import express from "express";
import {
  registerUser,
  verifySignupOtp,
  resendSignupOtp,
  loginUser,
  logoutUser,
  forgotPassword,
  verifyOTP,
  changePassword,
  sendContactMail,
} from "../controllers/userController.js";

import { isAuthenticated } from "../middleware/isAuthenticated.js";
import {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  resetPasswordWithTokenSchema,
  emailSchema,
  signupOtpSchema,
  validate,
} from "../validators/userValidate.js";
import {
  getMe,
  refreshAccessToken,
  updateProfile,
} from "../controllers/sessionController.js";

const router = express.Router();

router.post("/register", validate(registerSchema), registerUser);
router.post("/verify-signup-otp", validate(signupOtpSchema), verifySignupOtp);
router.post("/resend-signup-otp", validate(emailSchema), resendSignupOtp);
router.post("/login", validate(loginSchema), loginUser);
router.post("/logout", isAuthenticated, logoutUser);
router.post("/refresh", refreshAccessToken);
router.get("/me", isAuthenticated, getMe);
router.put("/profile", isAuthenticated, updateProfile);
router.post("/forgot-password", validate(emailSchema), forgotPassword);
router.post("/verify-otp/:email", verifyOTP);
router.post("/change-password/:email", validate(resetPasswordWithTokenSchema), changePassword);

router.post("/contact", sendContactMail);

export default router;