const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth.middleware");
const authController = require("./auth.controller");

router.post("/register", authController.register);
router.post("/verify-otp", authController.verifyOtp);
router.post("/login", authController.login);
router.get("/test-email", authController.testEmail);
router.post("/google", authController.google);
router.post("/send-reset-otp", authController.sendResetOtp);
router.post("/reset-password", authController.resetPassword);
router.patch("/update-profile", authMiddleware, authController.updateProfile);
router.put("/labels", authMiddleware, authController.updateLabels);

module.exports = router;
