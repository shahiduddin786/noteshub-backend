import express from "express";
import { getNotes } from "../controllers/notesController.js";
import { mergePdfs } from "../controllers/mergeController.js";
import { isAuthenticated } from "../middleware/isAuthenticated.js";

const router = express.Router();

router.get("/merge/:university/:semester/:subject", mergePdfs);
router.get("/merge/:university/:semester/:subject/:subSubject", mergePdfs);
router.get("/:university/:semester/:subject", getNotes);
router.get("/:university/:semester/:subject/:subSubject", getNotes);

export default router;