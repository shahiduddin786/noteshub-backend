import prisma from "../lib/prisma.js";

export const acceptTerms = async (req, res) => {
  try {
    const userId = req.userId;

    await prisma.user.update({
      where: { id: userId },
      data: { termsAccepted: true },
    });

    return res.status(200).json({
      success: true,
      message: "Terms accepted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};