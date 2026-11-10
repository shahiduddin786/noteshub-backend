import express from "express";
import multer from "multer";
import { isAdmin } from "../middleware/isAdmin.js";
import prisma from "../lib/prisma.js";
import {
  adminUpload,
  adminListFolders,
  adminListCloudinaryFiles,
  adminDeleteCloudinaryFile,
  adminListSupabaseFiles,
  adminDeleteSupabaseFile,
  adminCreateCloudinaryFolder,
  adminRenameCloudinaryFolder,
  adminDeleteCloudinaryFolder,
  adminCreateSupabaseFolder,
  adminRenameSupabaseFolder,
  adminDeleteSupabaseFolder,
} from "../controllers/adminController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return res.status(200).json({ success: true });
  }
  return res.status(403).json({ success: false, message: "Invalid email or password" });
});

router.post("/upload", isAdmin, upload.single("file"), adminUpload);
router.get("/folders", isAdmin, adminListFolders);
router.get("/cloudinary/files", isAdmin, adminListCloudinaryFiles);
router.delete("/cloudinary/file", isAdmin, adminDeleteCloudinaryFile);
router.get("/supabase/files", isAdmin, adminListSupabaseFiles);
router.delete("/supabase/file", isAdmin, adminDeleteSupabaseFile);

router.post("/cloudinary/folder", isAdmin, adminCreateCloudinaryFolder);
router.put("/cloudinary/folder", isAdmin, adminRenameCloudinaryFolder);
router.delete("/cloudinary/folder", isAdmin, adminDeleteCloudinaryFolder);

router.post("/supabase/folder", isAdmin, adminCreateSupabaseFolder);
router.put("/supabase/folder", isAdmin, adminRenameSupabaseFolder);
router.delete("/supabase/folder", isAdmin, adminDeleteSupabaseFolder);

router.get("/users", isAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const search = req.query.search ? String(req.query.search).trim() : "";

    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { id: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          email: true,
          isVerified: true,
          isLoggedIn: true,
          authProvider: true,
          createdAt: true,
          lastActiveAt: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;