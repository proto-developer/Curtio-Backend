const mongoose = require("mongoose");

/**
 * Paid-plan records, one document per subscriber, keyed by email.
 *
 * Managed the same way as the `owners` collection: for now you create the
 * document by hand in MongoDB Compass. When the FastPay gateway is added, the
 * webhook writes the same document instead — nothing else has to change,
 * because access is always derived from `status` + `expiresAt`.
 *
 * Renewing or re-subscribing = upsert on `email` (see config/premium.js).
 */

/**
 * Records are kept forever — expired ones included.
 *
 * There is deliberately NO TTL index here. A lapsed subscriber stays in the
 * collection so we know they once paid: that drives the "your subscription
 * expired" prompts in the app, and later the win-back marketing emails.
 *
 * Access is unaffected by keeping the row: isPremium() checks status + expiry,
 * so the flag turns false the instant the period ends.
 */

const subscriptionSchema = new mongoose.Schema(
  {
    // ── Who ──────────────────────────────────────────────────────────────
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Optional. Handy for joins later; access is resolved by email.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ── What they bought ─────────────────────────────────────────────────
    plan: {
      type: String,
      enum: ["plus"],
      default: "plus",
    },

    // "monthly" = $10/month, "yearly" = $96/year (20% off).
    billingInterval: {
      type: String,
      enum: ["monthly", "yearly"],
      required: true,
    },

    amount: {
      type: Number,
      default: null, // 10 for monthly, 96 for yearly
    },

    currency: {
      type: String,
      default: "USD",
      uppercase: true,
      trim: true,
    },

    // ── State ────────────────────────────────────────────────────────────
    // active    → paid and inside the period
    // trialing  → on trial, treated as premium until expiresAt
    // past_due  → renewal failed; NOT premium
    // canceled  → ended immediately; NOT premium
    // expired   → period elapsed; NOT premium
    status: {
      type: String,
      enum: ["active", "trialing", "past_due", "canceled", "expired"],
      default: "active",
    },

    // ── Period ───────────────────────────────────────────────────────────
    startedAt: {
      type: Date,
      default: Date.now,
    },

    currentPeriodStart: {
      type: Date,
      default: Date.now,
    },

    // THE access authority. Past this instant the user is no longer premium.
    // null = no expiry (manual/comped access that never lapses).
    expiresAt: {
      type: Date,
      default: null,
    },

    // Set true to let a canceled subscription run to the end of the period
    // that was already paid for. Leave `status` as "active" when you do.
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },

    canceledAt: {
      type: Date,
      default: null,
    },

    // ── Payment gateway (unused until FastPay is wired up) ───────────────
    provider: {
      type: String,
      enum: ["manual", "fastpay"],
      default: "manual",
    },

    providerCustomerId: { type: String, default: null },
    providerSubscriptionId: { type: String, default: null },
    lastPaymentId: { type: String, default: null },
    lastPaymentAt: { type: Date, default: null },

    notes: { type: String, default: null },
  },
  { timestamps: true }
);

/**
 * Plain (non-TTL) index — lets us query lapsed subscribers for win-back mail
 * without ever deleting them.
 */
subscriptionSchema.index({ expiresAt: 1 });

/** True while this record grants paid access right now. */
subscriptionSchema.methods.grantsAccess = function grantsAccess(at = new Date()) {
  if (this.status !== "active" && this.status !== "trialing") return false;
  if (this.expiresAt && this.expiresAt.getTime() <= at.getTime()) return false;
  return true;
};

const Subscription = mongoose.model(
  "Subscription",
  subscriptionSchema,
  "subscriptions"
);

/**
 * Drop the old TTL index if it is still on the collection.
 *
 * Earlier versions indexed `expiresAt` with `expireAfterSeconds: 0`, which made
 * MongoDB delete a subscription the moment it lapsed. We now keep lapsed
 * records (for the "Plus plan expired" prompts and win-back email later), but
 * Mongoose only ever CREATES indexes — removing one from the schema does not
 * remove it from the database. So it has to be dropped explicitly, once.
 *
 * Safe to call on every boot: it does nothing when no TTL index is present.
 */
const dropExpiryTtlIndex = async () => {
  try {
    const indexes = await Subscription.collection.indexes();
    const ttl = indexes.find(
      (i) => i.expireAfterSeconds !== undefined && i.key && i.key.expiresAt === 1
    );

    if (!ttl) return false;

    await Subscription.collection.dropIndex(ttl.name);
    console.log(
      `Dropped TTL index "${ttl.name}" on subscriptions — expired records are now kept.`
    );
    // Recreate it as a plain index for querying lapsed subscribers.
    await Subscription.collection.createIndex({ expiresAt: 1 });
    return true;
  } catch (err) {
    // Never block startup over an index cleanup.
    console.error("Could not drop subscriptions TTL index:", err.message);
    return false;
  }
};

module.exports = Subscription;
module.exports.dropExpiryTtlIndex = dropExpiryTtlIndex;
