import prisma from "../lib/prisma.js";

export const Session = {
  deleteMany: (where) => prisma.session.deleteMany({ where }),
  create: (data) => prisma.session.create({ data }),
  findOne: (where) => prisma.session.findFirst({ where }),
};