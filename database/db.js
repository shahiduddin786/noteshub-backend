import prisma from "../lib/prisma.js";

const connectDB = async () => {
  await prisma.$connect();
  console.log("PostgreSQL connected successfully");
};

export default connectDB;