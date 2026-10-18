import express from "express";
import { acceptTerms } from "../controllers/termsController.js";
import { isAuthenticated } from "../middleware/isAuthenticated.js";

const router = express.Router();

router.post("/accept-terms", isAuthenticated, acceptTerms);

export default router;
