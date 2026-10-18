import express from "express";
import { getGoogleAuthUrl, googleWebCallback } from "../controllers/googleAuthController.js";


const router = express.Router();

router.get("/url", getGoogleAuthUrl);
router.post("/callback", googleWebCallback);


export default router;