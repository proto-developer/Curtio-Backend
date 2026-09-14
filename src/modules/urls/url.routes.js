const express = require("express");
const router = express.Router();
const urlController = require("./url.controller");

// All routes here are already prefixed with /api/urls and protected by authMiddleware
router.post("/", urlController.createShortUrl);
router.get("/", urlController.getMyUrls);
router.delete("/campaign/:campaignName", urlController.deleteCampaign);
router.patch("/campaign/:campaignName", urlController.renameCampaign);
router.delete("/:shortCode", urlController.deleteUrl);
router.patch("/:shortCode/toggle", urlController.toggleUrlActive);
router.patch("/:shortCode/labels", urlController.updateUrlLabels);
router.patch("/:shortCode/campaigns", urlController.updateUrlCampaigns);

module.exports = router;
