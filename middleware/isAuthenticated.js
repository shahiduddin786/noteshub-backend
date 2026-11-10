import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

const FIVE_MINUTES = 5 * 60 * 1000;

export const isAuthenticated = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access token is missing or invalid",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    req.user = user;
    req.userId = decoded.id;

    const now = new Date();
    const needsUpdate =
      !user.lastActiveAt ||
      now.getTime() - new Date(user.lastActiveAt).getTime() > FIVE_MINUTES;

    if (needsUpdate) {
      prisma.user
        .update({ where: { id: user.id }, data: { lastActiveAt: now } })
        .catch(() => {});
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Access token expired",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid access token",
    });
  }
};