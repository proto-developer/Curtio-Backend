const dns = require("dns");

// Simple utility to check if an IP is local/private
function isPrivateIp(ip) {
  if (!ip) return true;
  // Localhost / IPv6 Loopback
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") return true;
  // Clean IP
  const cleanIp = ip.split(",")[0].trim();
  // IPv4 Private Ranges
  if (
    cleanIp.startsWith("10.") ||
    cleanIp.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)
  ) {
    return true;
  }
  return false;
}

// ASN organization name substrings that indicate a cloud/hosting/datacenter
// origin rather than a residential or mobile ISP — used to catch automated
// scanners (e.g. Microsoft Defender Safe Links prefetching links shared via
// Teams/Outlook) that render the page with a normal-looking browser UA
// specifically to evade user-agent-based bot detection.
const DATACENTER_ASN_KEYWORDS = [
  "microsoft", "azure", "amazon", "aws", "google cloud", "google llc",
  "digitalocean", "digital ocean", "ovh", "hetzner", "linode", "akamai",
  "cloudflare", "fastly", "oracle cloud", "alibaba", "tencent",
  "vultr", "choopa", "contabo", "scaleway", "leaseweb", "psychz", "m247",
  "hosting", "datacenter", "data center", "cloud computing", "colocation", "vps",
];

function isDatacenterOrg(org) {
  if (!org) return false;
  const lower = org.toLowerCase();
  return DATACENTER_ASN_KEYWORDS.some((kw) => lower.includes(kw));
}

// Manually-confirmed ASN numbers (via WHOIS/BGP lookup) for hosting/
// datacenter networks whose org name doesn't contain any of the keywords
// above. Always merged into the fetched list below, so these survive even
// if the upstream list ever drops them.
// 209854 = Cyberzone S.A. ("Cyberzonehub") — hosting/VPS network, Panama.
const MANUAL_DATACENTER_ASN_NUMBERS = new Set(["209854"]);

// ── Worldwide datacenter ASN list (community-maintained, auto-updated) ──
// Source: X4BNet/lists_vpn, which classifies ASNs globally by registration
// type (hosting vs ISP) rather than relying on a hand-picked provider list —
// currently ~900 ASNs. Fetched once and cached in memory, refreshed every
// 24h so newly-added networks get picked up without a redeploy. Fails safe:
// if the fetch ever fails, whatever was last cached (or the manual set
// above, at minimum) keeps being used.
const DATACENTER_ASN_LIST_URL = "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/input/datacenter/ASN.txt";
const DATACENTER_ASN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let datacenterAsnCache = new Set(MANUAL_DATACENTER_ASN_NUMBERS);
let datacenterAsnCacheFetchedAt = 0;

async function refreshDatacenterAsnList() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(DATACENTER_ASN_LIST_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      const asns = text
        .split("\n")
        .map((line) => {
          const match = line.match(/^AS(\d+)/i);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      if (asns.length > 0) {
        const fresh = new Set(asns);
        for (const asn of MANUAL_DATACENTER_ASN_NUMBERS) fresh.add(asn);
        datacenterAsnCache = fresh;
      }
    }
    // Mark as freshly checked either way, so a transient failure doesn't
    // cause a retry on every single click until the next TTL window.
    datacenterAsnCacheFetchedAt = Date.now();
  } catch (error) {
    console.error("Failed to refresh datacenter ASN list:", error.message);
    datacenterAsnCacheFetchedAt = Date.now();
  }
}

async function ensureDatacenterAsnListFresh() {
  if (Date.now() - datacenterAsnCacheFetchedAt > DATACENTER_ASN_CACHE_TTL_MS) {
    await refreshDatacenterAsnList();
  }
}

function isDatacenterAsn(asn) {
  if (!asn) return false;
  return datacenterAsnCache.has(String(asn).trim());
}

// ── Primary classifier: ipapi.is ──
// Proprietary WHOIS-based algorithm covering thousands of hosting/cloud
// providers worldwide (is_datacenter), PLUS a separate named-crawler flag
// (is_crawler) that catches things no hosting list would — e.g. Meta's own
// link-preview/safety-scanning bots hitting from their own "business"-type
// ASN (not a rentable datacenter), which is_crawler identifies by name
// (e.g. "FacebookBot") regardless. Free for up to 1,000 requests/day with
// no signup or API key required.
async function lookupViaIpapiIs(clientIp) {
  const url = clientIp
    ? `https://api.ipapi.is/?q=${encodeURIComponent(clientIp)}`
    : "https://api.ipapi.is/";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    if (!data || !data.location || !data.location.country_code) return null;

    const asnOrganization = data.asn?.org || data.company?.name || null;

    const isExplicitIsp = data.asn?.type === "isp" || data.company?.type === "isp";
    const isAutomated = Boolean(data.is_crawler) || (!isExplicitIsp && Boolean(data.is_datacenter));

    return {
      countryCode: data.location.country_code.toUpperCase(),
      country: data.location.country || getCountryName(data.location.country_code),
      asnOrganization,
      isAutomated,
    };
  } catch (error) {
    console.error("ipapi.is lookup failed:", error.message);
    return null;
  }
}

async function lookupViaFreeIpApi(clientIp) {
  await ensureDatacenterAsnListFresh();

  const url = isPrivateIp(clientIp)
    ? "https://freeipapi.com/api/json/"
    : `https://freeipapi.com/api/json/${clientIp}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && data.countryCode && data.countryCode !== "-") {
        return {
          countryCode: data.countryCode.toUpperCase(),
          country: data.countryName || getCountryName(data.countryCode),
          asnOrganization: data.asnOrganization || null,
          isAutomated: isDatacenterOrg(data.asnOrganization) || isDatacenterAsn(data.asn),
        };
      }
    }
  } catch (error) {
    console.error("GeoIP fallback lookup failed:", error.message);
  }

  return null;
}

async function getGeoData(ip, headers = {}) {
  // 1. Try Vercel country headers first
  if (headers["x-vercel-ip-country"]) {
    const code = headers["x-vercel-ip-country"].toUpperCase();
    return {
      countryCode: code,
      country: getCountryName(code),
      asnOrganization: null,
      isAutomated: false,
    };
  }

  // 2. Try Cloudflare country headers
  if (headers["cf-ipcountry"]) {
    const code = headers["cf-ipcountry"].toUpperCase();
    return {
      countryCode: code,
      country: getCountryName(code),
      asnOrganization: null,
      isAutomated: false,
    };
  }

  // 3. Clean the client IP
  const clientIp = ip ? ip.split(",")[0].trim() : "";
  const lookupIp = isPrivateIp(clientIp) ? "" : clientIp;

  const primary = await lookupViaIpapiIs(lookupIp);
  if (primary) return primary;

  const fallback = await lookupViaFreeIpApi(clientIp);
  if (fallback) return fallback;

  // If network issues or API timeouts occur, strictly return null so unclassified requests are ignored and not tracked with a fake location
  return null;
}

// A helper dictionary to map codes to names if needed
function getCountryName(code) {
  const countries = {
    "US": "United States",
    "GB": "United Kingdom",
    "CA": "Canada",
    "IN": "India",
    "PK": "Pakistan",
    "AU": "Australia",
    "DE": "Germany",
    "FR": "France",
    "IT": "Italy",
    "ES": "Spain",
    "JP": "Japan",
    "CN": "China",
    "BR": "Brazil",
    "ZA": "South Africa",
    "RU": "Russia",
    "NL": "Netherlands",
    "SE": "Sweden",
    "NO": "Norway",
    "DK": "Denmark",
    "FI": "Finland",
    "PL": "Poland",
    "TR": "Turkey",
    "MX": "Mexico",
    "AR": "Argentina",
    "CL": "Chile",
    "CO": "Colombia",
    "NZ": "New Zealand",
    "SG": "Singapore",
    "MY": "Malaysia",
    "TH": "Thailand",
    "ID": "Indonesia",
    "PH": "Philippines",
    "VN": "Vietnam",
    "SA": "Saudi Arabia",
    "AE": "United Arab Emirates",
    "IL": "Israel",
    "EG": "Egypt",
    "NG": "Nigeria",
    "KE": "Kenya",
    "UA": "Ukraine",
    "CH": "Switzerland",
    "AT": "Austria",
    "BE": "Belgium",
    "IE": "Ireland",
    "PT": "Portugal",
    "GR": "Greece",
    "CZ": "Czech Republic",
    "HU": "Hungary",
    "RO": "Romania"
  };
  return countries[code.toUpperCase()] || code;
}

module.exports = {
  getGeoData
};
