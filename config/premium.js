const Subscription = require("../models/Subscription");
const { isOwner } = require("./owners");

/**
 * Paid-plan check, the same shape as config/owners.js.
 *
 * Reads the "subscriptions" MongoDB collection. A document created by hand in
 * Compass (or later by the FastPay webhook) grants the user paid access until
 * its period ends. Nothing is hardcoded in the source — add or remove access by
 * adding or removing the document.
 *
 * Access is ALWAYS derived, never stored as a boolean: a record only counts
 * while its status is active/trialing AND its expiry is still in the future.
 * That means the flag flips to false by itself the moment the period ends, even
 * if the record is still sitting in the database.
 */

const ACTIVE_STATUSES = ["active", "trialing"];

/**
 * How many links a Free account may hold. Paid plans are unlimited.
 *
 * This link quota is the ONLY thing a subscription controls. Pre-click
 * analytics stay owner-only (config/owners.js) — paying does not grant them.
 */
const FREE_LINK_LIMIT = 1;

/** Campaigns a Free account may hold — matches the published Pricing page. */
const FREE_CAMPAIGN_LIMIT = 1;

/** Case-insensitive exact-match filter, mirroring isOwner(). */
const emailFilter = (email) => ({
  email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") },
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fetch the raw subscription document for an email, or null.
 * Returns the record whether or not it is still valid — callers decide.
 */
const getSubscription = async (email) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return null;

  try {
    return await Subscription.findOne(emailFilter(cleanEmail));
  } catch (err) {
    console.error("getSubscription DB error:", err);
    return null;
  }
};

/**
 * Is this email on a paid plan right now?
 * Fails closed — any error resolves to false, so a DB hiccup never hands out
 * paid access.
 */
const isPremium = async (email) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return false;

  try {
    const sub = await Subscription.findOne(emailFilter(cleanEmail));
    if (!sub) return false;
    if (!ACTIVE_STATUSES.includes(sub.status)) return false;
    if (sub.expiresAt && sub.expiresAt.getTime() <= Date.now()) return false;
    return true;
  } catch (err) {
    console.error("isPremium DB check error:", err);
    return false;
  }
};

/**
 * Effective link quota: is this email allowed unlimited links?
 *
 * True for paying subscribers AND for owners. Owners run the tool, so they are
 * never asked to buy a subscription to use it — being in the `owners`
 * collection is enough.
 *
 * This is only about the link quota. It does NOT work the other way round: a
 * subscriber does not become an owner and never gains pre-click analytics.
 */
const hasUnlimitedLinks = async (email) => {
  const [owner, premium] = await Promise.all([isOwner(email), isPremium(email)]);
  return owner || premium;
};

/**
 * Normalized view for future endpoints / the account UI.
 * Always safe to send to the owning user — carries no gateway secrets.
 */
const getPremiumStatus = async (email) => {
  const sub = await getSubscription(email);

  if (!sub) {
    return {
      isPremium: false,
      plan: "free",
      billingInterval: null,
      status: "none",
      startedAt: null,
      expiresAt: null,
      cancelAtPeriodEnd: false,
      daysRemaining: null,
    };
  }

  const active = sub.grantsAccess();
  const daysRemaining = sub.expiresAt
    ? Math.max(0, Math.ceil((sub.expiresAt.getTime() - Date.now()) / 86400000))
    : null;

  return {
    isPremium: active,
    plan: active ? sub.plan : "free",
    billingInterval: sub.billingInterval,
    // Report the real state even when the stored status was never updated.
    status: active ? sub.status : sub.status === "active" ? "expired" : sub.status,
    startedAt: sub.startedAt,
    expiresAt: sub.expiresAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    daysRemaining,
  };
};

/** Period end for a new or renewed subscription, counted from `from`. */
const periodEndFor = (billingInterval, from = new Date()) => {
  const end = new Date(from);
  if (billingInterval === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
};

/**
 * Create or renew a subscription — one call for both, so a returning customer
 * never collides with the unique email index.
 *
 * Not wired to any route yet. This is what the FastPay webhook will call once
 * the gateway is added; until then you can create the document by hand.
 */
const activateSubscription = async (
  email,
  { billingInterval, userId = null, amount = null, provider = "manual", providerCustomerId = null, providerSubscriptionId = null, lastPaymentId = null, status = "active", expiresAt = null } = {}
) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) throw new Error("Email is required.");
  if (!["monthly", "yearly"].includes(billingInterval)) {
    throw new Error('billingInterval must be "monthly" or "yearly".');
  }

  const now = new Date();
  const periodEnd = expiresAt || periodEndFor(billingInterval, now);

  return Subscription.findOneAndUpdate(
    { email: cleanEmail },
    {
      $set: {
        email: cleanEmail,
        userId,
        plan: "plus",
        billingInterval,
        amount: amount ?? (billingInterval === "yearly" ? 96 : 10),
        status,
        currentPeriodStart: now,
        expiresAt: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        provider,
        providerCustomerId,
        providerSubscriptionId,
        lastPaymentId,
        lastPaymentAt: now,
      },
      $setOnInsert: { startedAt: now },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = {
  isPremium,
  hasUnlimitedLinks,
  getSubscription,
  getPremiumStatus,
  activateSubscription,
  periodEndFor,
  ACTIVE_STATUSES,
  FREE_LINK_LIMIT,
  FREE_CAMPAIGN_LIMIT,
};
