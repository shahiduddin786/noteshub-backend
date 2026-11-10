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
import {
  getRecoveryEligibility,
  createRecoveryRequest,
  adminListRecoveryRequests,
  adminGetRecoveryRequest,
  adminApproveRecoveryRequest,
  adminRejectRecoveryRequest,
  adminResendRecoveryNotification,
} from "../controllers/deviceRecoveryController.js";
import {
  validateCoupon,
  getEligibleCoupon,
  adminCreateCoupon,
  adminListCoupons,
  adminRevokeCoupon,
} from "../controllers/couponController.js";
import {
  recoveryRequestSchema,
  recoveryRejectSchema,
  validate,
} from "../validators/recoveryValidate.js";
import {
  couponApplySchema,
  couponCreateSchema,
} from "../validators/couponValidate.js";

const router = express.Router();

router.get("/config/*", getPaidNoteConfig);
router.get("/files/*", getPaidNoteFileList);
router.post("/purchase/create-order", isAuthenticated, createPurchaseOrder);
router.post("/purchase/verify", isAuthenticated, verifyPurchase);
router.post("/coupons/validate", isAuthenticated, validate(couponApplySchema), validateCoupon);
router.get("/coupons/eligible/*", isAuthenticated, getEligibleCoupon);
router.get("/entitlement/*", isAuthenticated, checkEntitlement);
router.get("/access/*", isAuthenticated, getSignedAccess);
router.get("/stream/*/file/:fileName", isAuthenticated, streamPaidFile);

router.get("/recovery/eligibility/*", isAuthenticated, getRecoveryEligibility);
router.post("/recovery/request", isAuthenticated, validate(recoveryRequestSchema), createRecoveryRequest);

router.get("/admin/recovery", isAdmin, adminListRecoveryRequests);
router.get("/admin/recovery/:id", isAdmin, adminGetRecoveryRequest);
router.post("/admin/recovery/:id/approve", isAdmin, adminApproveRecoveryRequest);
router.post("/admin/recovery/:id/reject", isAdmin, validate(recoveryRejectSchema), adminRejectRecoveryRequest);
router.post("/admin/recovery/:id/resend-notification", isAdmin, adminResendRecoveryNotification);

router.get("/admin/list", isAdmin, adminListPaidNotes);
router.post("/admin/create", isAdmin, adminCreatePaidNote);
router.put("/admin/update/:noteKey", isAdmin, adminUpdatePaidNote);
router.delete("/admin/delete/:noteKey", isAdmin, adminDeletePaidNote);
router.get("/admin/purchases", isAdmin, adminListPurchases);
router.post("/admin/reset-device", isAdmin, adminResetDevice);

router.get("/admin/coupons", isAdmin, adminListCoupons);
router.post("/admin/coupons", isAdmin, validate(couponCreateSchema), adminCreateCoupon);
router.post("/admin/coupons/:id/revoke", isAdmin, adminRevokeCoupon);

export default router;