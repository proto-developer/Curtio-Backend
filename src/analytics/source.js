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

module.exports = {
  ANDROID_PACKAGE_SOURCE_MAP,
  getSourceFromRequestedWith,
  getSource,
  UTM_SOURCE_MAP,
  getPlatformFromUtm,
  isWebBrowser,
};
