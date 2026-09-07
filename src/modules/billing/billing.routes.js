const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth.middleware");
const billingController = require("./billing.controller");

router.get("/plan", authMiddleware, billingController.getPlanStatus);

module.exports = router;
