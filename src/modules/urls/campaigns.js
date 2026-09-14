const User = require("../../models/User");

/**
 * Rename an existing campaign across all links for a user.
 */
const renameUserCampaign = async (userId, oldCampaignName, newCampaignName) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const oldTarget = oldCampaignName.trim().toLowerCase();
  const newName = newCampaignName.trim();
  if (!newName) {
    throw new Error("New campaign name is required.");
  }

  let modifiedCount = 0;

  user.urls.forEach((urlObj) => {
    let wasModified = false;

    // 1. Update campaigns array
    if (Array.isArray(urlObj.campaigns)) {
      urlObj.campaigns.forEach((c) => {
        if ((c.name || c).toString().trim().toLowerCase() === oldTarget) {
          c.name = newName;
          wasModified = true;
        }
      });
    }

    // 2. Update originalUrl query param if matching
    try {
      const urlParsed = new URL(urlObj.originalUrl);
      const campaignParam = urlParsed.searchParams.get("utm_campaign");
      if (campaignParam && campaignParam.trim().toLowerCase() === oldTarget) {
        urlParsed.searchParams.set("utm_campaign", newName);
        urlObj.originalUrl = urlParsed.toString();
        wasModified = true;
      }
    } catch (e) {
      if (new RegExp(`[?&]utm_campaign=${oldCampaignName}`, "i").test(urlObj.originalUrl)) {
        urlObj.originalUrl = urlObj.originalUrl.replace(
          new RegExp(`([?&]utm_campaign=)${oldCampaignName}`, "gi"),
          `$1${encodeURIComponent(newName)}`
        );
        wasModified = true;
      }
    }

    if (wasModified) modifiedCount++;
  });

  if (modifiedCount > 0) {
    await user.save();
  }

  return { modifiedCount };
};

/**
 * Delete a campaign by removing campaignName from campaigns array
 * and removing utm_campaign from originalUrl of all matching links for a user.
 * The links themselves remain intact in the database.
 */
const deleteUserCampaign = async (userId, campaignName) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  let modifiedCount = 0;
  const targetCampaign = campaignName.trim().toLowerCase();

  user.urls.forEach((urlObj) => {
    let wasModified = false;

    // 1. Check campaigns array (now array of {name, source, medium} objects)
    if (Array.isArray(urlObj.campaigns) && urlObj.campaigns.length > 0) {
      const origLength = urlObj.campaigns.length;
      urlObj.campaigns = urlObj.campaigns.filter(
        (c) => (c.name || c).toString().trim().toLowerCase() !== targetCampaign
      );
      if (urlObj.campaigns.length !== origLength) {
        wasModified = true;
      }
    }

    // 2. Check originalUrl query param
    try {
      const urlParsed = new URL(urlObj.originalUrl);
      const campaignParam = urlParsed.searchParams.get("utm_campaign");
      if (campaignParam && campaignParam.trim().toLowerCase() === targetCampaign) {
        urlParsed.searchParams.delete("utm_campaign");
        urlParsed.searchParams.delete("utm_source");
        urlParsed.searchParams.delete("utm_medium");
        urlObj.originalUrl = urlParsed.toString();
        wasModified = true;
      }
    } catch (e) {
      if (new RegExp(`[?&]utm_campaign=${campaignName}`, "i").test(urlObj.originalUrl)) {
        urlObj.originalUrl = urlObj.originalUrl
          .replace(new RegExp(`[?&]utm_campaign=${campaignName}[^&#]*`, "gi"), "")
          .replace(/[?&]utm_source=[^&#]*/gi, "")
          .replace(/[?&]utm_medium=[^&#]*/gi, "")
          .replace(/\?$/, "");
        wasModified = true;
      }
    }

    if (wasModified) modifiedCount++;
  });

  if (modifiedCount > 0) {
    await user.save();
  }

  return { modifiedCount };
};

module.exports = {
  renameUserCampaign,
  deleteUserCampaign,
};
