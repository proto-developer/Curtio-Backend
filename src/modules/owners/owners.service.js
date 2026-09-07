const Owner = require("../../models/Owner");

/**
 * Checks dynamically against the "owners" MongoDB collection.
 * Any document created in MongoDB Compass (e.g., { email: "example@gmail.com" })
 * will automatically be recognized as an owner.
 */
const isOwner = async (email) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return false;

  try {
    const ownerDoc = await Owner.findOne({
      email: { $regex: new RegExp(`^${cleanEmail}$`, "i") },
    });
    return !!ownerDoc;
  } catch (err) {
    console.error("isOwner DB check error:", err);
    return false;
  }
};

module.exports = { isOwner };
