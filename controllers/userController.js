import prisma from "../lib/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendVerificationOtpMail } from "../emailVerify/sendVerificationOtpMail.js";
import { sendOtpMail } from "../emailVerify/sendOtpMail.js";
import { BrevoClient } from "@getbrevo/brevo";
import {
  OTP_PURPOSE_RESET,
  OTP_PURPOSE_SIGNUP,
} from "../utils/otp.js";
import {
  consumeResetToken,
  issueOtp,
  resendCooldownRemaining,
  verifyOtpCode,
} from "../utils/otpService.js";

export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existingUser && existingUser.isVerified) {
      return res.status(400).json({
        success: false,
        message: "User already exists. Please login.",
      });
    }

    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.user.create({
        data: {
          username: name,
          email: normalizedEmail,
          password: hashedPassword,
          isVerified: false,
          isLoggedIn: false,
          termsAccepted: false,
          authProvider: "local",
        },
      });
    }

    let code;
    try {
      code = await issueOtp(normalizedEmail, OTP_PURPOSE_SIGNUP);
    } catch (err) {
      if (err.code === "OTP_COOLDOWN" || err.code === "OTP_RATE_LIMITED") {
        return res.status(429).json({
          success: false,
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      }
      throw err;
    }

    await sendVerificationOtpMail(normalizedEmail, code);

    return res.status(existingUser ? 200 : 201).json({
      success: true,
      message: existingUser
        ? "Verification code resent. Enter the 6-digit code sent to your email."
        : "Registered successfully. Enter the 6-digit code sent to your email.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const verifySignupOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "Email is already verified. Please login.",
      });
    }

    const result = await verifyOtpCode(normalizedEmail, OTP_PURPOSE_SIGNUP, otp);
    if (!result.ok) {
      if (result.reason === "expired") {
        return res.status(400).json({
          success: false,
          message: "OTP expired. Request a new code.",
        });
      }
      if (result.reason === "locked") {
        return res.status(400).json({
          success: false,
          message: "Too many incorrect attempts. Request a new code.",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
        ...(typeof result.attemptsLeft === "number" ? { attemptsLeft: result.attemptsLeft } : {}),
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true, token: null },
    });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully. Please login.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const resendSignupOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified. Please login.",
      });
    }

    let code;
    try {
      code = await issueOtp(normalizedEmail, OTP_PURPOSE_SIGNUP);
    } catch (err) {
      if (err.code === "OTP_COOLDOWN" || err.code === "OTP_RATE_LIMITED") {
        return res.status(429).json({
          success: false,
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      }
      throw err;
    }

    await sendVerificationOtpMail(normalizedEmail, code);

    return res.status(200).json({
      success: true,
      message: "Verification code resent.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (user.authProvider === "google" || !user.password) {
      return res.status(401).json({
        success: false,
        message: "This account uses Google sign-in. Please continue with Google.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email",
      });
    }

    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({ data: { userId: user.id } });

    const accessToken = jwt.sign(
      { id: user.id },
      process.env.SECRET_KEY,
      { expiresIn: "10d" }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.SECRET_KEY,
      { expiresIn: "30d" }
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { isLoggedIn: true },
    });

    return res.status(200).json({
      success: true,
      message: `Welcome ${user.username}`,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        termsAccepted: user.termsAccepted,
      },
    });
  } catch (error) {
      console.error("LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const logoutUser = async (req, res) => {
  try {
    const userId = req.userId;

    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { isLoggedIn: false },
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let code;
    try {
      code = await issueOtp(normalizedEmail, OTP_PURPOSE_RESET);
    } catch (err) {
      if (err.code === "OTP_COOLDOWN" || err.code === "OTP_RATE_LIMITED") {
        return res.status(429).json({
          success: false,
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      }
      throw err;
    }

    await sendOtpMail(normalizedEmail, code);

    const cooldown = await resendCooldownRemaining(normalizedEmail, OTP_PURPOSE_RESET);

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      resendAfterSeconds: cooldown,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    const { email } = req.params;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const result = await verifyOtpCode(normalizedEmail, OTP_PURPOSE_RESET, otp);
    if (!result.ok) {
      if (result.reason === "expired") {
        return res.status(400).json({
          success: false,
          message: "OTP expired",
        });
      }
      if (result.reason === "locked") {
        return res.status(400).json({
          success: false,
          message: "Too many incorrect attempts. Request a new code.",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
        ...(typeof result.attemptsLeft === "number" ? { attemptsLeft: result.attemptsLeft } : {}),
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified",
      resetToken: result.resetToken,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { email } = req.params;
    const { newPassword, confirmPassword, resetToken } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (!resetToken) {
      return res.status(400).json({
        success: false,
        message: "Password reset verification is required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const ticketValid = await consumeResetToken(normalizedEmail, resetToken);
    if (!ticketValid) {
      return res.status(400).json({
        success: false,
        message: "Reset session expired. Verify the OTP again.",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, isLoggedIn: false },
    });

    await prisma.session.deleteMany({ where: { userId: user.id } });

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


export const sendContactMail = async (req, res) => {
  try {
    const { fullName, email, message } = req.body;

    if (!fullName || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "All fields required",
      });
    }

    const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

    await brevo.transactionalEmails.sendTransacEmail({
      sender: {
        name: "NotesHub",
        email: process.env.NOTESHUB_SENDER_EMAIL,
      },
      to: [{ email: process.env.NOTESHUB_SENDER_EMAIL }],
      replyTo: { email, name: fullName },
      subject: `New Contact Message from ${fullName}`,
      htmlContent: `
        <h2>New Contact Message</h2>
        <p><b>Name:</b> ${fullName}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Message:</b> ${message}</p>
      `,
    });

    return res.status(200).json({
      success: true,
      message: "Mail sent successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Mail sending failed",
    });
  }
};