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

module.exports = {
  PASSWORD_GRANT_TTL_SECONDS,
  PASSWORD_GRANT_SCOPE,
  issuePasswordGrant,
  isValidPasswordGrant,
  safeEquals,
};
