import { google } from "googleapis";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

const getOAuthClient = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

export const getGoogleAuthUrl = (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
    prompt: "consent",
  });
  return res.status(200).json({ success: true, url });
};

export const googleWebCallback = async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ success: false, error: "google_auth_failed" });
    }

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) {
      return res.status(401).json({ success: false, error: "google_auth_failed" });
    }

    const { email, name, verified_email } = profile;

    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          username: name || email.split("@")[0],
          email,
          isVerified: verified_email ?? true,
          isLoggedIn: false,
          termsAccepted: false,
          authProvider: "google",
        },
      });
    } else if (user.authProvider === "local") {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          authProvider: "google",
          isVerified: !user.isVerified && verified_email ? true : user.isVerified,
        },
      });
    }

    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({ data: { userId: user.id } });

    const token = jwt.sign({ id: user.id }, process.env.SECRET_KEY, { expiresIn: "10d" });

    await prisma.user.update({ where: { id: user.id }, data: { isLoggedIn: true } });

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        termsAccepted: user.termsAccepted,
        isVerified: user.isVerified,
        authProvider: user.authProvider,
      },
    });
  } catch (error) {
    return res.status(401).json({ success: false, error: "google_auth_failed" });
  }
};