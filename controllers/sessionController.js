import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    termsAccepted: user.termsAccepted,
    isVerified: user.isVerified,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/refresh { refreshToken } -> { accessToken }
// Stateless: verifies the 30d refresh JWT issued at login and mints a fresh
// 10d access token. No rotation (refresh tokens are not persisted); clients
// keep using the same refresh token until it expires, then must re-login.
export const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh token is required" });
    }
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.SECRET_KEY);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Refresh token expired" });
      }
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const accessToken = jwt.sign({ id: user.id }, process.env.SECRET_KEY, { expiresIn: "10d" });
    return res.status(200).json({ success: true, accessToken });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /api/auth/me (Bearer) -> current user
export const getMe = async (req, res) => {
  try {
    return res.status(200).json({ success: true, user: publicUser(req.user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// PUT /api/auth/profile { username } (Bearer) -> updated user
export const updateProfile = async (req, res) => {
  try {
    const { username } = req.body || {};
    const name = String(username || "").trim();
    if (name.length < 3) {
      return res
        .status(400)
        .json({ success: false, message: "Name must be at least 3 characters" });
    }
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { username: name },
    });
    return res.status(200).json({ success: true, user: publicUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
