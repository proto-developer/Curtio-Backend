const User = require("../../models/User");
const { hasUnlimitedLinks, FREE_LINK_LIMIT } = require("../billing/billing.service");
const validator = require("validator");
const { issuePasswordGrant, isValidPasswordGrant, safeEquals } = require("./password-grant");
const { renameUserCampaign, deleteUserCampaign } = require("./campaigns");
const { trackClick, trackPreClick } = require("../../analytics/tracking");

/**
 * Generate a random short code of a given length.
 */
function generateRandomCode(length = 7) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Check if the original URL has a valid format (including protocol).
 */
const validateUrl = (url) => {
  if (!url) return false;
  return validator.isURL(url, {
    require_protocol: true,
    require_valid_protocol: true,
    protocols: ["http", "https"],
  });
};

/**
 * Generate a unique short code that does not exist in any user's records.
 */
const generateUniqueCode = async (length = 7) => {
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    const code = generateRandomCode(length);
    const existing = await User.findOne({ "urls.shortCode": code });
    if (!existing) {
      return code;
    }
    attempts++;
  }

  throw new Error("Failed to generate a unique short code after multiple attempts.");
};

/**
 * Add a new shortened URL to a user's record.
 */
const addShortUrl = async (userId, { originalUrl, customAlias, password, expiresAt }) => {
  // 1. Validate original URL
  if (!validateUrl(originalUrl)) {
    throw new Error("Invalid destination URL. Please include a valid protocol (http:// or https://).");
  }

  // 2. Find User
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  // 2b. Plan quota — Free holds FREE_LINK_LIMIT link(s); subscribers AND owners
  //     are unlimited (owners run the tool, they don't buy their own product).
  //     This is the ONLY thing a subscription changes. Pre-click analytics stay
  //     owner-only (config/owners.js) — paying never grants them.
  //     Existing links keep working; only creating a new one is blocked.
  const unlimited = await hasUnlimitedLinks(user.email);
  if (!unlimited && user.urls.length >= FREE_LINK_LIMIT) {
    const err = new Error(
      `Free includes ${FREE_LINK_LIMIT} link per user. Upgrade to Plus for unlimited tracked links.`
    );
    err.planLimitReached = true;
    throw err;
  }

  // 3. Resolve short code (custom alias or unique generated)
  let shortCode;
  if (customAlias && customAlias.trim()) {
    const cleanAlias = customAlias.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!cleanAlias) {
      throw new Error("Invalid custom alias. Use only alphanumeric characters, dashes or underscores.");
    }

    // Check if the custom alias is already taken globally
    const existingAlias = await User.findOne({ "urls.shortCode": cleanAlias });
    if (existingAlias) {
      throw new Error("Custom alias already in use. Please choose another one.");
    }
    shortCode = cleanAlias;
  } else {
    shortCode = await generateUniqueCode();
  }

  // 4. Extract utm_campaign and utm_source if present in originalUrl
  let initialCampaigns = [];
  try {
    const urlParsed = new URL(originalUrl);
    const cParam = urlParsed.searchParams.get("utm_campaign");
    const sParam = urlParsed.searchParams.get("utm_source");
    if (cParam && cParam.trim()) {
      initialCampaigns.push({ name: cParam.trim(), source: (sParam || "").trim() });
    }
  } catch (e) {}

  // Create and push the URL object
  const urlObject = {
    originalUrl,
    shortCode,
    clicks: 0,
    active: true,
    password: password || null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    campaigns: initialCampaigns,
    clickLogs: [],
  };

  user.urls.push(urlObject);
  await user.save();

  // Return the newly created URL object (the last item in the array)
  return user.urls[user.urls.length - 1];
};

/**
 * Fetch and validate a short URL — does NOT record a click.
 * Call this when serving the loader page so that closing the tab early
 * does not inflate click counts.
 */
const resolveShortUrl = async (shortCode, { enteredPassword, passwordGrant } = {}) => {
  const user = await User.findOne({ "urls.shortCode": shortCode });
  if (!user) {
    throw new Error("Short URL not found.");
  }

  const urlObj = user.urls.find((u) => u.shortCode === shortCode);
  if (!urlObj) {
    throw new Error("Short URL not found.");
  }

  if (!urlObj.active) {
    throw new Error("This link has been disabled by the owner.");
  }

  if (urlObj.expiresAt && new Date() > new Date(urlObj.expiresAt)) {
    throw new Error("This link has expired.");
  }

  // Check password protection if enabled. The visitor is let through either by
  // supplying the password directly or by presenting a grant issued by
  // verifyLinkPassword after they entered it on the password page.
  if (urlObj.password) {
    const unlocked =
      (enteredPassword !== null &&
        enteredPassword !== undefined &&
        safeEquals(urlObj.password, enteredPassword)) ||
      isValidPasswordGrant(shortCode, passwordGrant);

    if (!unlocked) {
      const err = new Error("Password required.");
      err.passwordRequired = true;
      throw err;
    }
  }

  return urlObj;
};

/**
 * Verify the password a visitor typed on the password page.
 * Returns a short-lived grant that resolveShortUrl accepts, so the normal
 * loader → pre-click → track → redirect flow runs unchanged afterwards and
 * password-protected links keep producing analytics.
 */
const verifyLinkPassword = async (shortCode, enteredPassword) => {
  const user = await User.findOne({ "urls.shortCode": shortCode });
  if (!user) {
    throw new Error("Short URL not found.");
  }

  const urlObj = user.urls.find((u) => u.shortCode === shortCode);
  if (!urlObj) {
    throw new Error("Short URL not found.");
  }

  if (!urlObj.active) {
    throw new Error("This link has been disabled by the owner.");
  }

  if (urlObj.expiresAt && new Date() > new Date(urlObj.expiresAt)) {
    throw new Error("This link has expired.");
  }

  // Not protected — nothing to verify, the plain redirect already works.
  if (!urlObj.password) {
    return { grant: null, isProtected: false };
  }

  if (!safeEquals(urlObj.password, enteredPassword)) {
    const err = new Error("Incorrect password.");
    err.invalidPassword = true;
    throw err;
  }

  return { grant: issuePasswordGrant(shortCode), isProtected: true };
};

/**
 * Fetch all URLs belonging to a user.
 */
const getUserUrls = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  return { urls: user.urls, labels: user.labels || {} };
};

/**
 * Delete a shortened URL from a user's record.
 */
const deleteUserUrl = async (userId, shortCode) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const urlIndex = user.urls.findIndex((u) => u.shortCode === shortCode);
  if (urlIndex === -1) {
    throw new Error("Short URL not found under this account.");
  }

  user.urls.splice(urlIndex, 1);
  await user.save();
  return true;
};

/**
 * Toggle the active state of a shortened URL.
 */
const toggleUserUrlActive = async (userId, shortCode) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const urlObj = user.urls.find((u) => u.shortCode === shortCode);
  if (!urlObj) {
    throw new Error("Short URL not found under this account.");
  }

  urlObj.active = !urlObj.active;
  await user.save();
  return urlObj;
};

/**
 * Update the labels of a shortened URL.
 */
const updateUserUrlLabels = async (userId, shortCode, labels) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const urlObj = user.urls.find((u) => u.shortCode === shortCode);
  if (!urlObj) {
    throw new Error("Short URL not found under this account.");
  }

  urlObj.labels = labels;
  await user.save();
  return urlObj;
};

/**
 * Update the campaigns of a shortened URL.
 * Accepts an array of { name, source, medium } objects.
 */
const updateUserUrlCampaigns = async (userId, shortCode, campaigns) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const urlObj = user.urls.find((u) => u.shortCode === shortCode);
  if (!urlObj) {
    throw new Error("Short URL not found under this account.");
  }

  if (!Array.isArray(campaigns)) {
    throw new Error("Campaigns must be an array of { name, source, medium } objects.");
  }

  // Normalize: accept both plain strings (backward compat) and objects
  urlObj.campaigns = campaigns
    .map((c) => {
      if (typeof c === "string") {
        return { name: c.trim(), source: "", medium: "" };
      }
      return {
        name: String(c.name || "").trim(),
        source: String(c.source || "").trim(),
        medium: String(c.medium || "").trim(),
      };
    })
    .filter((c) => c.name);

  await user.save();
  return urlObj;
};

module.exports = {
  validateUrl,
  addShortUrl,
  resolveShortUrl,
  verifyLinkPassword,
  trackClick,
  trackPreClick,
  getUserUrls,
  deleteUserUrl,
  toggleUserUrlActive,
  updateUserUrlLabels,
  updateUserUrlCampaigns,
  renameUserCampaign,
  deleteUserCampaign,
};
