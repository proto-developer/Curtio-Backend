const urlService = require("../services/url.service");
const { isOwner } = require("../config/owners");
const { getPremiumStatus, hasUnlimitedLinks, FREE_LINK_LIMIT } = require("../config/premium");
const { REDIRECT_DELAY_MS } = require("../config/redirectTiming");

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

function buildRedirectPage(destinationUrl, shortCode, utmSource, apiBase, originalReferer) {
  const safeUrl = destinationUrl.replace(/"/g, "&quot;");
  const safeCode = (shortCode || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const safeUtm = (utmSource || "").replace(/"/g, "&quot;");
  const safeApi = (apiBase || "").replace(/"/g, "&quot;");
  const safeReferer = (originalReferer || "").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Redirecting…</title>
<style>
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #F9FAFB;
    font-family: 'Inter', sans-serif;
  }
  .loader-wrap {
    text-align: center;
  }
  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 16px;
    border: 4px solid #E5E7EB;
    border-top: 4px solid #2563EB;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .redirect-text {
    font-size: 15px;
    color: #374151;
    font-weight: 500;
  }
  .dots::after {
    content: '';
    animation: dots 1.2s steps(4, end) infinite;
  }
  @keyframes dots {
    0% { content: ''; }
    25% { content: '.'; }
    50% { content: '..'; }
    75% { content: '...'; }
    100% { content: ''; }
  }
</style>
</head>
<body>
  <div class="loader-wrap">
    <div class="spinner"></div>
  </div>

<script>
  (function () {
    var visitId = 'v_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    var apiHost = "${safeApi}" || window.location.origin;
    var preClickUrl = apiHost + "/api/preclick/${safeCode}";
    var preClickPayload = JSON.stringify({ visitId: visitId, utmSource: "${safeUtm}", originalReferer: "${safeReferer}" });

    if (navigator.sendBeacon) {
      var preClickBlob = new Blob([preClickPayload], { type: 'application/json' });
      navigator.sendBeacon(preClickUrl, preClickBlob);
    } else {
      var preClickXhr = new XMLHttpRequest();
      preClickXhr.open('POST', preClickUrl, true);
      preClickXhr.setRequestHeader('Content-Type', 'application/json');
      try { preClickXhr.send(preClickPayload); } catch(e) {}
    }

    // Track the click ONLY after the countdown fires.
    setTimeout(function () {
      var trackUrl = apiHost + "/api/track/${safeCode}";
      var payload = JSON.stringify({ visitId: visitId, utmSource: "${safeUtm}", originalReferer: "${safeReferer}" });

      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(trackUrl, blob);
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', trackUrl, false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        try { xhr.send(payload); } catch(e) {}
      }

      window.location.replace("${safeUrl}");
    }, ${REDIRECT_DELAY_MS});
  })();
</script>
</body>
</html>`;
}

function buildLinkDisabledPage({ title, badgeText, message, frontendUrl }) {
  const safeTitle = (title || "Link Unavailable").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeBadge = (badgeText || "Deactivated").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMsg = (message || "This link has been disabled by the owner.").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeHome = (frontendUrl || "/").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} - Curtio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    min-height: 100vh;
    background-color: #F8FAFC;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #0F172A;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
  .card {
    width: 100%;
    max-width: 440px;
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 24px;
    padding: 2.5rem 2rem;
    text-align: center;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
    animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .icon-box {
    width: 64px;
    height: 64px;
    margin: 0 auto 1.25rem;
    background: #FEF2F2;
    border: 1px solid #FEE2E2;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #EF4444;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.35rem 0.85rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #DC2626;
    background: #FEF2F2;
    border: 1px solid #FEE2E2;
    border-radius: 9999px;
    margin-bottom: 1.25rem;
  }
  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #EF4444;
  }
  h1 {
    font-size: 1.625rem;
    font-weight: 800;
    color: #0F172A;
    letter-spacing: -0.025em;
    margin-bottom: 0.625rem;
  }
  p {
    font-size: 0.925rem;
    line-height: 1.6;
    color: #64748B;
    margin-bottom: 2rem;
  }
  .btn-group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 12px;
    text-decoration: none;
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .btn-primary {
    background-color: #4F46E5;
    color: #FFFFFF;
    box-shadow: 0 1px 2px 0 rgba(79, 70, 229, 0.3);
  }
  .btn-primary:hover {
    background-color: #4338CA;
    box-shadow: 0 4px 12px 0 rgba(79, 70, 229, 0.35);
  }
  .footer-brand {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: #94A3B8;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
  }
  .footer-brand strong {
    color: #475569;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon-box">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    </div>

    <span class="badge">
      <span class="badge-dot"></span>
      ${safeBadge}
    </span>
    <h1>${safeTitle}</h1>
    <p>${safeMsg}</p>

    <div class="btn-group">
      <a href="${safeHome}" class="btn btn-primary">
        Go to Curtio Homepage
      </a>
    </div>

    <div class="footer-brand">
      Powered by <strong>Curtio Link Platform</strong>
    </div>
  </div>
</body>
</html>`;
}


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
