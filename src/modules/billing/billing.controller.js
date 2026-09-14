const User = require("../../models/User");
const {
  getPremiumStatus,
  hasUnlimitedLinks,
  FREE_LINK_LIMIT,
  FREE_CAMPAIGN_LIMIT,
} = require("./billing.service");

const getPlanStatus = async (req, res) => {
  try {
    const [status, unlimitedLinks, user] = await Promise.all([
      getPremiumStatus(req.user.email),
      hasUnlimitedLinks(req.user.email),
      User.findById(req.user.id).select("urls.originalUrl urls.campaigns").lean(),
    ]);

    // A campaign is a name from utm_campaign in the destination URL OR from the
    // link's campaigns array — the same rule the Campaigns page groups by.
    const campaignNames = new Set();
    for (const url of user?.urls || []) {
      try {
        const tag = new URL(url.originalUrl).searchParams.get("utm_campaign");
        if (tag && tag.trim()) campaignNames.add(tag.trim());
      } catch (e) {
        /* not a parseable URL — no utm_campaign to read */
      }
      for (const c of url.campaigns || []) {
        const name = typeof c === "string" ? c : c?.name;
        if (name && name.trim()) campaignNames.add(name.trim());
      }
    }

    return res.status(200).json({
      success: true,
      isPremium: status.isPremium,
      unlimitedLinks,
      subscriptionStatus: status.status,
      subscriptionExpiresAt: status.expiresAt,
      linksCount: user?.urls?.length || 0,
      campaignsCount: campaignNames.size,
      freeLinkLimit: FREE_LINK_LIMIT,
      freeCampaignLimit: FREE_CAMPAIGN_LIMIT,
    });
  } catch (error) {
    console.error("Plan status error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getPlanStatus };
