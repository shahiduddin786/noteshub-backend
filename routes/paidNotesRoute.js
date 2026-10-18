import express from "express";
import { isAuthenticated } from "../middleware/isAuthenticated.js";
import { isAdmin } from "../middleware/isAdmin.js";
import {
  getPaidNoteConfig,
  getPaidNoteFileList,
  createPurchaseOrder,
  verifyPurchase,
  checkEntitlement,
  getSignedAccess,
  streamPaidFile,
  adminCreatePaidNote,
  adminUpdatePaidNote,
  adminDeletePaidNote,
  adminListPaidNotes,
  adminListPurchases,
  adminResetDevice,
} from "../controllers/paidNotesController.js";

const router = express.Router();

router.get("/config/*", getPaidNoteConfig);
router.get("/files/*", getPaidNoteFileList);
router.post("/purchase/create-order", isAuthenticated, createPurchaseOrder);
router.post("/purchase/verify", isAuthenticated, verifyPurchase);
router.get("/entitlement/*", isAuthenticated, checkEntitlement);
router.get("/access/*", isAuthenticated, getSignedAccess);
router.get("/stream/*/file/:fileName", isAuthenticated, streamPaidFile);

router.get("/admin/list", isAdmin, adminListPaidNotes);
router.post("/admin/create", isAdmin, adminCreatePaidNote);
router.put("/admin/update/:noteKey", isAdmin, adminUpdatePaidNote);
router.delete("/admin/delete/:noteKey", isAdmin, adminDeletePaidNote);
router.get("/admin/purchases", isAdmin, adminListPurchases);
router.post("/admin/reset-device", isAdmin, adminResetDevice);

export default router;