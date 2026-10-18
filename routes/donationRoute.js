import express from "express";
import {
  createOrder,
  verifyPayment,
  handleWebhook,
} from "../controllers/donationController.js";

const router = express.Router();

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    req.body = JSON.parse(req.body.toString());
    next();
  },
  handleWebhook
);

router.post("/create-order", createOrder);
router.post("/verify", verifyPayment);

export default router;