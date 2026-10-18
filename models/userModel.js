import prisma from "../lib/prisma.js";

export const User = {
  findOne: (where) => prisma.user.findFirst({ where }),
  findById: (id) => prisma.user.findUnique({ where: { id } }),
  findByIdAndUpdate: (id, data) =>
    prisma.user.update({ where: { id }, data }),
  create: (data) => prisma.user.create({ data }),
  updateById: (id, data) => prisma.user.update({ where: { id }, data }),
};