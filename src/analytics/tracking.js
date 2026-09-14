const User = require("../models/User");
const { isOwner } = require("../modules/owners/owners.service");
const { PRECLICK_WINDOW_MS } = require("../config/redirectTiming");
const { getSource, getPlatformFromUtm, isWebBrowser } = require("./source");

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

    const { getGeoData } = require("./geoip");
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

  const { getGeoData } = require("./geoip");
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

module.exports = {
  trackClick,
  trackPreClick,
};
