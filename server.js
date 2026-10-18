import express from "express";
import "dotenv/config";
import cors from "cors";
import connectDB from "./database/db.js";
import prisma from "./lib/prisma.js";
import userRoute from "./routes/userRoute.js";
import notesRoute from "./routes/notesRoute.js";
import termsRoutes from "./routes/termsRoutes.js";
import adminRoute from "./routes/adminRoute.js";
import donationRoute from "./routes/donationRoute.js";
import googleAuthRoute from "./routes/googleAuthRoute.js";
import paidNotesRoute from "./routes/paidNotesRoute.js";
import academicRoutes from "./routes/academicRoutes.js";

const app = express();

const allowedOrigins = [
  "https://noteshub-admin.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  // Local Expo / Metro bundlers (web + devtools). Native apps don't send
  // Origin, so these entries only affect browser-based development.
  "http://localhost:8081",
  "http://localhost:19000",
  "http://localhost:19006",
  "https://noteshub-shaho.onrender.com",
  "https://noteshub-admin.onrender.com",

  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "username", "password", "x-device-fingerprint", "x-device-token"],
};

app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

app.use("/api/donations/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      success: true,
      message: "Server is running",
      database: "connected",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server is running but database is unreachable",
      database: "disconnected",
    });
  }
});

app.use("/api/auth", userRoute);
app.use("/api/auth/google", googleAuthRoute);
app.use("/api/notes", notesRoute);
app.use("/api/terms", termsRoutes);
app.use("/api/admin", adminRoute);
app.use("/api/donations", donationRoute);
app.use("/api/paid-notes", paidNotesRoute);
app.use("/api/academic", academicRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err, req, res, next) => {
  res.status(500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

connectDB().catch((error) => {
  console.error("DB connection failed:", error.message);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;