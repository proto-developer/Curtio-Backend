const urlService = require("./url.service");
const { isOwner } = require("../owners/owners.service");
const { getPremiumStatus, hasUnlimitedLinks, FREE_LINK_LIMIT } = require("../billing/billing.service");
const { buildRedirectPage } = require("../../views/redirect-loader");
const { buildLinkDisabledPage } = require("../../views/link-unavailable");

const createShortUrl = async (req, res) => {
  try {
    const userId = req.user.id; // from authMiddleware
    const { originalUrl, customAlias, password, expiresAt } = req.body;

    if (!originalUrl) {
      return res.status(400).json({ success: false, message: "Destination URL is required." });
    }

    const newUrl = await urlService.addShortUrl(userId, {
      originalUrl,
      customAlias,
      password,
      expiresAt,
    });

    return res.status(201).json({
      success: true,
      message: "Short URL created successfully!",
      url: newUrl,
    });
  } catch (error) {
    console.error("Create short URL error:", error);
    // planLimitReached lets the client tell "you hit the Free quota" apart from
    // a validation failure. Status stays 400 so existing error handling works.
    return res.status(400).json({
      success: false,
      message: error.message,
      ...(error.planLimitReached ? { planLimitReached: true } : {}),
    });
  }
};

const getMyUrls = async (req, res) => {
  try {
    const userId = req.user.id;
    const { urls, labels } = await urlService.getUserUrls(userId);
    const ownerStatus = await isOwner(req.user.email);
    const responseUrls = ownerStatus
      ? urls
      : urls.map((url) => {
        const safeUrl = typeof url.toObject === "function" ? url.toObject() : { ...url };
        delete safeUrl.preClicks;
        delete safeUrl.preClickLogs;
        return safeUrl;
      });
    // Live plan flags, read on every load so adding or removing a subscription
    // takes effect without a re-login (the JWT claim is only a login snapshot).
    //   isPremium      → has a paid subscription
    //   unlimitedLinks → may hold unlimited links (subscriber OR owner)
    // Owners are unlimited without paying, so the two differ for them.
    const [planStatus, unlimitedLinks] = await Promise.all([
      getPremiumStatus(req.user.email),
      hasUnlimitedLinks(req.user.email),
    ]);

    return res.status(200).json({
      success: true,
      urls: responseUrls,
      labels,
      isPremium: planStatus.isPremium,
      unlimitedLinks,
      freeLinkLimit: FREE_LINK_LIMIT,
      // "none" = never subscribed. Anything else means a record exists, so the
      // UI can say "your subscription expired" instead of "free plan".
      subscriptionStatus: planStatus.status,
      subscriptionExpiresAt: planStatus.expiresAt,
    });
  } catch (error) {
    console.error("Get URLs error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shortCode } = req.params;
    await urlService.deleteUserUrl(userId, shortCode);
    return res.status(200).json({ success: true, message: "Link deleted successfully." });
  } catch (error) {
    console.error("Delete URL error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

const toggleUrlActive = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shortCode } = req.params;
    const url = await urlService.toggleUserUrlActive(userId, shortCode);
    return res.status(200).json({
      success: true,
      message: `Link ${url.active ? "enabled" : "disabled"} successfully.`,
      url,
    });
  } catch (error) {
    console.error("Toggle active state error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * The SPA origin visitors are sent to for the password page and error links.
 * Trailing slashes are stripped so FRONT_END_URL="https://host/" cannot produce
 * a "https://host//password/abc" style double slash.
 */
function getFrontendUrl() {
  return (process.env.FRONT_END_URL || "http://localhost:5173").replace(/\/+$/, "");
}

/**
 * Absolute origin of this redirect host, taken from the incoming request so it
 * works on redirect.curtio.io, localhost, and previews without extra config.
 */
function getSelfOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

/**
 * Direct redirect — resolves the short URL, records the click, and
 * immediately redirects the visitor to the original destination.
 * No captcha or intermediate page required.
 */
const handleRedirect = async (req, res) => {
  const { shortCode } = req.params;

  try {
    // Only validates the link — does NOT record a click
    const urlObj = await urlService.resolveShortUrl(shortCode, {
      enteredPassword: null,
      passwordGrant: req.query.grant || null,
    });

    // Forward query params to destination so UTM tracking works on the target
    // page. `grant` is ours — it must never be appended to the destination.
    let destinationUrl = urlObj.originalUrl;
    const { grant, ...queryParams } = req.query;
    if (queryParams && Object.keys(queryParams).length > 0) {
      try {
        const urlObjParsed = new URL(destinationUrl);
        Object.entries(queryParams).forEach(([key, val]) => {
          urlObjParsed.searchParams.set(key, val);
        });
        destinationUrl = urlObjParsed.toString();
      } catch (e) {
        const sep = destinationUrl.includes("?") ? "&" : "?";
        const qs = new URLSearchParams(queryParams).toString();
        destinationUrl = `${destinationUrl}${sep}${qs}`;
      }
    }

    // Pass the utm_source along so the track endpoint can use it
    const utmSource = req.query.utm_source || "";
    const apiBase = process.env.BACK_END_URL || "";

    // Capture the REAL referer here — this is the only request that carries
    // the actual originating page (Teams, LinkedIn, an email client, etc).
    // The later /api/track POST is fired by this loader page's own JS, so
    // its Referer is always self-referential and useless for attribution.
    const originalReferer = req.headers.referer || req.headers.referrer || "";

    return res.status(200).send(buildRedirectPage(destinationUrl, shortCode, utmSource, apiBase, originalReferer));
  } catch (error) {
    if (error.passwordRequired) {
      return res.redirect(302, `${getFrontendUrl()}/password/${shortCode}`);
    }

    const isDisabled = error.message && error.message.includes("disabled by the owner");
    const isExpired = error.message && error.message.includes("expired");

    const title = isDisabled
      ? "Link Disabled"
      : isExpired
        ? "Link Expired"
        : "Link Unavailable";

    const badgeText = isDisabled ? "Deactivated" : isExpired ? "Expired" : "404 Not Found";

    const frontendUrl = getFrontendUrl();

    return res.status(404).send(buildLinkDisabledPage({
      title,
      badgeText,
      message: error.message || "This link is currently unavailable.",
      frontendUrl
    }));
  }
};

/**
 * POST /api/public/verify/:shortCode
 * Public — called by the password page when a visitor submits a password for a
 * protected link. On success it returns the URL to continue to, carrying a
 * short-lived grant so the normal loader/track/redirect flow can run.
 */
const verifyLinkPassword = async (req, res) => {
  const { shortCode } = req.params;
  const password = req.body?.password ?? "";

  try {
    const { grant, isProtected } = await urlService.verifyLinkPassword(shortCode, password);

    const base = `${getSelfOrigin(req)}/${encodeURIComponent(shortCode)}`;
    const redirectUrl = isProtected
      ? `${base}?grant=${encodeURIComponent(grant)}`
      : base;

    return res.status(200).json({ success: true, redirectUrl });
  } catch (error) {
    if (error.invalidPassword) {
      return res.status(401).json({
        success: false,
        passwordRequired: true,
        message: "Incorrect password. Please try again.",
      });
    }

    const notFound = error.message && error.message.includes("not found");
    return res.status(notFound ? 404 : 410).json({
      success: false,
      message: error.message || "This link is currently unavailable.",
    });
  }
};

/**
 * POST /api/track/:shortCode
 * Called by the loader page JS once its countdown (REDIRECT_DELAY_MS) completes.
 * This is the ONLY place a click is recorded.
 */
const trackClick = async (req, res) => {
  const { shortCode } = req.params;
  const ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];
  const utmSource = req.body?.utmSource || req.query.utm_source || null;
  const visitId = req.body?.visitId || null;
  // Distinguish "not sent" (undefined — fall back to headers.referer) from
  // "sent as empty string" (explicitly no referer on the original hit).
  const originalReferer = req.body && Object.prototype.hasOwnProperty.call(req.body, "originalReferer")
    ? req.body.originalReferer
    : null;

  try {
    await urlService.trackClick(shortCode, {
      ip,
      userAgent,
      headers: req.headers,
      utmSource,
      originalReferer,
      visitId,
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    // Non-critical — don’t break the redirect experience
    console.error("Track click error:", error);
    return res.status(200).json({ success: true });
  }
};

/**
 * POST /api/preclick/:shortCode
 * Called as soon as the loader page is opened, before its redirect countdown.
 * Stores visit temporarily in memory with preCheck = true.
 */
const trackPreClick = async (req, res) => {
  const { shortCode } = req.params;
  const ip = req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];
  const utmSource = req.body?.utmSource || req.query.utm_source || null;
  const visitId = req.body?.visitId || null;
  const originalReferer = req.body && Object.prototype.hasOwnProperty.call(req.body, "originalReferer")
    ? req.body.originalReferer
    : null;

  try {
    await urlService.trackPreClick(shortCode, {
      ip,
      userAgent,
      headers: req.headers,
      utmSource,
      originalReferer,
      visitId,
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    // Analytics must never interrupt the redirect experience.
    console.error("Track pre-click error:", error);
    return res.status(200).json({ success: true });
  }
};

const updateUrlLabels = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shortCode } = req.params;
    const { labels } = req.body;

    if (!Array.isArray(labels)) {
      return res.status(400).json({ success: false, message: "Labels must be an array of string keys." });
    }

    const url = await urlService.updateUserUrlLabels(userId, shortCode, labels);
    return res.status(200).json({
      success: true,
      message: "Link labels updated successfully.",
      url,
    });
  } catch (error) {
    console.error("Update URL labels error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

const updateUrlCampaigns = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shortCode } = req.params;
    const { campaigns } = req.body;

    if (!Array.isArray(campaigns)) {
      return res.status(400).json({ success: false, message: "Campaigns must be an array of campaign names." });
    }

    const url = await urlService.updateUserUrlCampaigns(userId, shortCode, campaigns);
    return res.status(200).json({
      success: true,
      message: "Link campaigns updated successfully.",
      url,
    });
  } catch (error) {
    console.error("Update URL campaigns error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

const renameCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { campaignName } = req.params;
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ success: false, message: "New campaign name is required." });
    }
    await urlService.renameUserCampaign(userId, campaignName, newName);
    return res.status(200).json({
      success: true,
      message: "Campaign renamed successfully.",
    });
  } catch (error) {
    console.error("Rename campaign error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { campaignName } = req.params;
    await urlService.deleteUserCampaign(userId, campaignName);
    return res.status(200).json({
      success: true,
      message: "Campaign deleted successfully while preserving link URLs.",
    });
  } catch (error) {
    console.error("Delete campaign error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  createShortUrl,
  getMyUrls,
  deleteUrl,
  toggleUrlActive,
  handleRedirect,
  verifyLinkPassword,
  trackClick,
  trackPreClick,
  updateUrlLabels,
  updateUrlCampaigns,
  renameCampaign,
  deleteCampaign,
};
