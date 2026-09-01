const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { isOwner } = require("../config/owners");
const { isPremium } = require("../config/premium");

/**
 * Generate a JWT token for a user.
 * Expires in 7 days. A new token is issued on every login / OTP verification.
 *
 * `isOwner` and `isPremium` are independent: owner unlocks pre-click analytics,
 * premium only lifts the link quota. Neither implies the other.
 *
 * Note the claim is a snapshot taken at login. A subscription that lapses
 * mid-token does NOT revoke this claim — that is why the server re-checks
 * isPremium() when a link is created rather than trusting the token.
 */
const generateToken = async (user) => {
  const [ownerStatus, premiumStatus] = await Promise.all([
    isOwner(user.email),
    isPremium(user.email),
  ]);
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      name: user.name,
      isOwner: ownerStatus,
      isPremium: premiumStatus,
    },
    env.JWT_SECRET,
    { expiresIn: "10d" }
  );
};

/**
 * Verify a JWT token. Returns the decoded payload or throws an error.
 */
const verifyToken = (token) => {
  return jwt.verify(token, env.JWT_SECRET);
};

module.exports = { generateToken, verifyToken };
