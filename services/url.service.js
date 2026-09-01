const User = require("../models/User");
const { isOwner } = require("../config/owners");
const { hasUnlimitedLinks, FREE_LINK_LIMIT } = require("../config/premium");
const { PRECLICK_WINDOW_MS } = require("../config/redirectTiming");
const validator = require("validator");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/**
 * Password grants.
 *
 * A visitor who enters the correct password for a protected link gets a
 * short-lived signed grant instead of the password being replayed in the URL.
 * The grant is stateless (HMAC-signed) so it survives across serverless
 * instances — an in-memory store would break whenever the verify request and
 * the follow-up redirect land on different instances.
 */
const PASSWORD_GRANT_TTL_SECONDS = 120;
const PASSWORD_GRANT_SCOPE = "link_password";

function issuePasswordGrant(shortCode) {
  return jwt.sign(
    { shortCode, scope: PASSWORD_GRANT_SCOPE },
    process.env.JWT_SECRET,
    { expiresIn: PASSWORD_GRANT_TTL_SECONDS }
  );
}

function isValidPasswordGrant(shortCode, token) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.scope === PASSWORD_GRANT_SCOPE && payload.shortCode === shortCode;
  } catch (e) {
    return false;
  }
}

/** Constant-time string compare, so a wrong password cannot be timed out character by character. */
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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
 * Maps the X-Requested-With header (the launching app's Android package name,
 * set by many WebView-based in-app browsers) to a platform name.
 * This is a stronger signal than UA/Referer sniffing since it can't be spoofed
 * by privacy-stripped referrers, but only fires for WebView-based in-app
 * browsers — Custom Tabs (used by newer WhatsApp/Telegram builds) don't set it.
 */
const ANDROID_PACKAGE_SOURCE_MAP = {
  "com.whatsapp": "WhatsApp",
  "com.whatsapp.w4b": "WhatsApp",
  "com.facebook.katana": "Facebook",
  "com.facebook.lite": "Facebook",
  "com.facebook.orca": "Messenger",
  "com.instagram.android": "Instagram",
  "com.instagram.lite": "Instagram",
  "org.telegram.messenger": "Telegram",
  "org.telegram.messenger.web": "Telegram",
  "com.twitter.android": "Twitter",
  "com.linkedin.android": "LinkedIn",
  "com.zhiliaoapp.musically": "TikTok",
  "com.ss.android.ugc.trill": "TikTok",
  "com.snapchat.android": "Snapchat",
  "com.pinterest": "Pinterest",
  "com.discord": "Discord",
  "com.reddit.frontpage": "Reddit",
  "com.Slack": "Slack",
};

function getSourceFromRequestedWith(xRequestedWith) {
  if (!xRequestedWith) return null;
  return ANDROID_PACKAGE_SOURCE_MAP[xRequestedWith.trim()] || null;
}

/**
 * Detects if the request is from a standard web browser.
 * Also uses headers to filter out API tools and programmatic background fetches.
 */
function getSource(ua, referer, xRequestedWith) {
  const fromPackage = getSourceFromRequestedWith(xRequestedWith);
  if (fromPackage) return fromPackage;

  ua = (ua || "").toLowerCase();
  referer = (referer || "").toLowerCase();

  if (referer.includes("whatsapp.com") || ua.includes("whatsapp")) return "WhatsApp";
  if (ua.includes("messenger")) return "Messenger";
  if (referer.includes("facebook.com") || ua.includes("fbav") || ua.includes("fban") || ua.includes("fb_iab")) return "Facebook";
  if (referer.includes("instagram.com") || ua.includes("instagram")) return "Instagram";
  if (referer.includes("tiktok.com") || ua.includes("tiktok") || ua.includes("bytedance")) return "TikTok";
  if (referer.includes("youtube.com") || referer.includes("youtu.be") || ua.includes("youtube")) return "YouTube";
  if (referer.includes("linkedin.com") || ua.includes("linkedin")) return "LinkedIn";
  if (referer.includes("twitter.com") || referer.includes("t.co") || ua.includes("twitter")) return "Twitter";
  if (referer.includes("reddit.com") || ua.includes("reddit")) return "Reddit";
  if (referer.includes("pinterest.com") || ua.includes("pinterest")) return "Pinterest";
  if (referer.includes("snapchat.com") || ua.includes("snapchat")) return "Snapchat";
  if (referer.includes("discord.com") || ua.includes("discord")) return "Discord";
  if (referer.includes("telegram.org") || referer.includes("t.me") || ua.includes("telegram")) return "Telegram";
  if (referer.includes("teams.microsoft")) return "Teams";
  if (referer.includes("slack.com") || ua.includes("slack")) return "Slack";
  if (referer.includes("mail.google.com")) return "Gmail";
  if (referer.includes("outlook.live.com") || referer.includes("outlook")) return "Outlook";
  if (referer.includes("wechat.com") || ua.includes("wechat") || ua.includes("micromessenger")) return "WeChat";
  if (referer.includes("line.me") || ua.includes("line")) return "Line";
  if (referer.includes("viber.com") || ua.includes("viber")) return "Viber";

  if (ua.includes("hola")) return "Hola Browser";
  if (ua.includes("opr") || ua.includes("opera")) return "Opera";
  if (ua.includes("edg")) return "Edge";
  if (ua.includes("brave")) return "Brave";
  if (ua.includes("torbrowser")) return "Tor";
  if (ua.includes("fxios") || ua.includes("firefox")) return "Firefox";
  if (ua.includes("trident") || ua.includes("msie")) return "Internet Explorer";
  if (ua.includes("crios") || ua.includes("chrome")) return "Chrome";
  if (ua.includes("safari") && ua.includes("mobile")) return "iOS Safari";
  if (ua.includes("safari")) return "Safari";

  return "Direct";
}

const UTM_SOURCE_MAP = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  twitter: "Twitter",
  reddit: "Reddit",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  discord: "Discord",
  telegram: "Telegram",
  teams: "Teams",
  slack: "Slack",
  gmail: "Gmail",
  outlook: "Outlook",
  wechat: "WeChat",
  line: "Line",
  viber: "Viber",
  asana: "Asana",
  trello: "Trello",
  clickup: "ClickUp",
  confluence: "Confluence",
  upwork: "Upwork",
  zoom: "Zoom",
  googlemeet: "Google Meet",
  "google meet": "Google Meet",
  meet: "Google Meet",
  notion: "Notion",
  twitch: "Twitch",
  yahoo: "Yahoo",
  signal: "Signal",
};

function getPlatformFromUtm(utmSource) {
  if (!utmSource) return null;
  const clean = utmSource.trim().toLowerCase();
  if (UTM_SOURCE_MAP[clean]) {
    return UTM_SOURCE_MAP[clean];
  }
  // Fallback: capitalize words nicely (e.g. upwork -> Upwork, my_campaign -> My Campaign)
  return clean
    .split(/[-_ ]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isWebBrowser(userAgent, headers = {}) {
  const ua = (userAgent || "").toLowerCase();

  // 1. Exclude known bots, scanners, preview agents
  const botPattern = /bot|crawler|spider|slurp|fetch|headless|chrome-lighthouse|puppeteer|safelinks|microsoft|proofpoint|mimecast|barracuda|virus|scan|security|audit|analyze|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|skypeuripreview|googlebot|bingbot|yandexbot|pinterestbot|redditbot|vkshare|embedly|quora|showyoubot|outbrain|developers\.google\.com|google-read-aloud|mediapartners-google|adsbot-google|baiduspider|duckduckbot|ia_archiver|mj12bot|sogoubot|bitlybot|postman|curl|insomnia|axios|wget|libwww|httpclient|java|go-http-client|ruby|python-requests/i;

  if (botPattern.test(ua)) {
    return false;
  }

  // 2. Exclude browser address bar autocompletion & pre-rendering prefetch hits
  const purpose = headers["purpose"] || headers["sec-purpose"] || headers["x-purpose"] || headers["x-moz"] || "";
  if (/prefetch|preview/i.test(purpose)) {
    return false;
  }

  // Allow standard browsers and mobile in-app browsers
  return true;
}

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

// In-memory cache for temporary preCheck/postCheck session tracking
const pendingVisits = new Map();

/**
 * Helper to commit a non-redirected pre-click to DB if user left early (postCheck remains false).
 */
async function finalizePreClick(visitId) {
  const visit = pendingVisits.get(visitId);
  if (!visit) return;
  pendingVisits.delete(visitId);

  if (visit.postCheck) return; // User completed redirect, do not count in preClicks

  try {
    const user = await User.findOne({ "urls.shortCode": visit.shortCode });
    if (!user) return;

    // Pre-clicks are tracked in the user document ONLY for users registered in the owners collection
    const ownerStatus = await isOwner(user.email);
    if (!ownerStatus) return;

    const urlObj = user.urls.find((u) => u.shortCode === visit.shortCode);
    if (!urlObj || !urlObj.active) return;

    const { getGeoData } = require("../utils/geoip");
    const geoData = await getGeoData(visit.ip, visit.headers);
    if (!geoData || geoData.isAutomated) return;

    const referer = visit.originalReferer !== null && visit.originalReferer !== undefined
      ? visit.originalReferer
      : visit.headers?.referer || visit.headers?.referrer || null;
    const xRequestedWith = visit.headers?.["x-requested-with"] || null;

    const source = visit.utmSource
      ? getPlatformFromUtm(visit.utmSource)
      : getSource(visit.ua, referer, xRequestedWith);

    const preClickEntry = {
      ip: visit.ip || "unknown",
      userAgent: visit.ua || "unknown",
      referer,
      source,
      country: geoData.country,
      countryCode: geoData.countryCode,
      clickedAt: visit.clickedAt,
    };

    urlObj.preClicks += 1;
    urlObj.preClickLogs.push(preClickEntry);
    await user.save();

    // Emit real-time updates to the URL owner's private socket room
    try {
      const { getIO } = require("../socket");
      const io = getIO();
      const updatedData = urlObj.toObject();
      io.to(user._id.toString()).emit("preclick:updated", updatedData);
      io.to(user._id.toString()).emit("analytics:updated", updatedData);
    } catch (_) { /* Socket not initialized — skip silently */ }
  } catch (err) {
    console.error("Finalize pre-click error:", err);
  }
}

/**
 * Record a click for a short URL.
 * Called by the loader page JS once its redirect countdown completes.
 */
const trackClick = async (shortCode, { ip, userAgent, headers, utmSource, originalReferer, visitId }) => {
  const ua = userAgent || "";
  if (!isWebBrowser(ua, headers)) return;

  // Mark postCheck = true for this session if present in temporary cache
  if (visitId && pendingVisits.has(visitId)) {
    const visit = pendingVisits.get(visitId);
    visit.postCheck = true;
    visit.preCheck = false;
    if (visit.timer) clearTimeout(visit.timer);
    pendingVisits.delete(visitId);
  }

  const user = await User.findOne({ "urls.shortCode": shortCode });
  if (!user) return;

  const urlObj = user.urls.find((u) => u.shortCode === shortCode);
  if (!urlObj || !urlObj.active) return;

  // ── Deduplicate: skip if same visitor already tracked within last 10 s ──
  const now = new Date();
  const DEDUP_WINDOW_MS = 10 * 1000;
  const isDuplicate = urlObj.clickLogs.some((log) => {
    if (log.ip !== (ip || "unknown") || log.userAgent !== (ua || "unknown")) return false;
    return now - new Date(log.clickedAt) < DEDUP_WINDOW_MS;
  });

  if (isDuplicate) return;

  const { getGeoData } = require("../utils/geoip");
  const geoData = await getGeoData(ip, headers);

  // Reject click tracking if GeoIP lookup failed due to network/API timeout issues
  if (!geoData || geoData.isAutomated) return;

  const referer = originalReferer !== null && originalReferer !== undefined
    ? originalReferer
    : headers?.referer || headers?.referrer || null;
  const xRequestedWith = headers?.["x-requested-with"] || null;

  const source = utmSource
    ? getPlatformFromUtm(utmSource)
    : getSource(ua, referer, xRequestedWith);

  urlObj.clicks += 1;
  urlObj.clickLogs.push({
    ip: ip || "unknown",
    userAgent: ua || "unknown",
    referer,
    xRequestedWith,
    source,
    country: geoData.country,
    countryCode: geoData.countryCode,
    clickedAt: now,
  });

  await user.save();

  // Emit real-time analytics update to the URL owner only
  try {
    const { getIO } = require("../socket");
    const io = getIO();
    io.to(user._id.toString()).emit("analytics:updated", urlObj.toObject());
  } catch (_) { /* Socket not initialized — skip silently */ }
};

/**
 * Record a pre-click for a short URL into temporary session cache.
 * If user leaves before loader countdown completes, timer flushes log into preClicks DB.
 */
const trackPreClick = async (shortCode, { ip, userAgent, headers, utmSource, originalReferer, visitId }) => {
  const ua = userAgent || "";
  if (!isWebBrowser(ua, headers)) return;

  if (!visitId) {
    // Fallback if no visitId generated
    visitId = 'v_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  // If postCheck isn't set to true within PRECLICK_WINDOW_MS (the loader's
  // redirect delay plus a grace period), the visitor closed the tab early.
  const timer = setTimeout(() => {
    finalizePreClick(visitId);
  }, PRECLICK_WINDOW_MS);

  pendingVisits.set(visitId, {
    shortCode,
    ip,
    ua,
    headers,
    utmSource,
    originalReferer,
    preCheck: true,
    postCheck: false,
    clickedAt: new Date(),
    timer,
  });
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
