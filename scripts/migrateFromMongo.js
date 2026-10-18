import mongoose from "mongoose";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

const userSchema = new mongoose.Schema(
  {
    username: String,
    email: String,
    password: String,
    authProvider: { type: String, default: "local" },
    isVerified: { type: Boolean, default: false },
    isLoggedIn: { type: Boolean, default: false },
    token: String,
    otp: String,
    otpExpiry: Date,
    termsAccepted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const MongoUser = mongoose.model("User", userSchema);
const MongoSession = mongoose.model("Session", sessionSchema);

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected.");

  const mongoUsers = await MongoUser.find({});
  const mongoSessions = await MongoSession.find({});

  console.log(`Found ${mongoUsers.length} users in MongoDB`);
  console.log(`Found ${mongoSessions.length} sessions in MongoDB`);

  const mongoIdToPgId = {};

  let usersCreated = 0;
  let usersSkipped = 0;

  for (const mu of mongoUsers) {
    const existing = await prisma.user.findUnique({
      where: { email: mu.email },
    });

    if (existing) {
      mongoIdToPgId[mu._id.toString()] = existing.id;
      usersSkipped++;
      continue;
    }

    const created = await prisma.user.create({
      data: {
        username: mu.username || mu.email.split("@")[0],
        email: mu.email,
        password: mu.password || null,
        authProvider: mu.authProvider || "local",
        isVerified: mu.isVerified ?? false,
        isLoggedIn: false,
        token: mu.token || null,
        otp: mu.otp || null,
        otpExpiry: mu.otpExpiry || null,
        termsAccepted: mu.termsAccepted ?? false,
        createdAt: mu.createdAt || new Date(),
        updatedAt: mu.updatedAt || new Date(),
      },
    });

    mongoIdToPgId[mu._id.toString()] = created.id;
    usersCreated++;
  }

  console.log(`Users created: ${usersCreated}, skipped (already exist): ${usersSkipped}`);

  let sessionsCreated = 0;
  let sessionsSkipped = 0;

  for (const ms of mongoSessions) {
    const pgUserId = mongoIdToPgId[ms.userId?.toString()];
    if (!pgUserId) {
      sessionsSkipped++;
      continue;
    }

    await prisma.session.create({
      data: { userId: pgUserId },
    });
    sessionsCreated++;
  }

  console.log(`Sessions created: ${sessionsCreated}, skipped: ${sessionsSkipped}`);

  const pgUserCount = await prisma.user.count();
  const pgSessionCount = await prisma.session.count();

  console.log("\n--- Migration Summary ---");
  console.log(`MongoDB  → Users: ${mongoUsers.length}, Sessions: ${mongoSessions.length}`);
  console.log(`PostgreSQL → Users: ${pgUserCount}, Sessions: ${pgSessionCount}`);
  console.log("Migration complete.");

  await mongoose.disconnect();
  await prisma.$disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});