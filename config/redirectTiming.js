/**
 * Timing for the redirect interstitial.
 *
 * The loader page served by handleRedirect waits REDIRECT_DELAY_MS, then fires
 * POST /api/track/:shortCode and calls window.location.replace(). The service
 * holds the visit in memory for PRECLICK_WINDOW_MS; if the track call has not
 * arrived by then, the visitor left before the redirect completed and the visit
 * is committed as a pre-click instead of a click.
 *
 * PRECLICK_WINDOW_MS must stay strictly greater than REDIRECT_DELAY_MS —
 * otherwise every visit is finalized as a pre-click before its click can land.
 * Change REDIRECT_DELAY_MS here and both sides move together.
 */
const REDIRECT_DELAY_MS = 1000;

// Headroom for the track request to reach the server after the countdown fires.
const PRECLICK_GRACE_MS = 500;

const PRECLICK_WINDOW_MS = REDIRECT_DELAY_MS + PRECLICK_GRACE_MS;

module.exports = {
  REDIRECT_DELAY_MS,
  PRECLICK_GRACE_MS,
  PRECLICK_WINDOW_MS,
};
