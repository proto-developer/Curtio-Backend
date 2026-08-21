const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");


const User = require("../models/User");
const { isOwner } = require("../config/owners");
const { generateOTP, sendOTPEmail } = require("../utils/otpGenrater");
const { generateToken } = require("../services/jwt");

/* ─────────────────────────────────────────
   POST /api/auth/register
   Saves user to DB (unverified), sends OTP
───────────────────────────────────────── */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters long." });
    }

    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing && existing.isVerified) {
      return res.status(409).json({ success: false, message: "Email already registered. Please login." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate OTP (10 min expiry)
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    if (existing && !existing.isVerified) {
      // Re-send OTP to existing unverified user
      existing.name = name;
      existing.password = hashedPassword;
      existing.otp = otp;
      existing.otpExpiry = otpExpiry;
      await existing.save();
    } else {
      // Create new user
      await User.create({
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        otp,
        otpExpiry,
      });
    }

    // Send OTP email
    console.log(`🔑 [DEV ONLY] Registration OTP for ${email} is: ${otp}`);
    try {
      await sendOTPEmail(email, otp, name.split(" ")[0]);
    } catch (mailErr) {
      console.warn("⚠️ Failed to send OTP email (SMTP missing/misconfigured):", mailErr.message);
    }

    res.status(200).json({
      success: true,
      message: "OTP sent to your email. Please verify to complete registration.",
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

/* ─────────────────────────────────────────
   POST /api/auth/verify-otp
   Verifies OTP → marks user verified → returns JWT
───────────────────────────────────────── */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "User already verified. Please login." });
    }

    // Check OTP match
    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP. Please try again." });
    }

    // Check OTP expiry
    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ success: false, message: "OTP has expired. Please register again." });
    }

    // Mark verified, clear OTP
    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    // Issue JWT
    const token = await generateToken(user);

    const ownerStatus = await isOwner(user.email);
    res.status(200).json({
      success: true,
      message: "Email verified successfully!",
      apiToken: token,
      LoginUser: { id: user._id, name: user.name, email: user.email, isOwner: ownerStatus },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

/* ─────────────────────────────────────────
   POST /api/auth/login
   Email + password → returns JWT
───────────────────────────────────────── */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ success: false, message: "No account found with this email." });
    }

    if (!user.isVerified) {
      return res.status(403).json({ success: false, message: "Email not verified. Please complete registration." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    // Issue a fresh JWT on every login
    const token = await generateToken(user);

    const ownerStatus = await isOwner(user.email);
    res.status(200).json({
      success: true,
      message: "Login successful!",
      apiToken: token,
      LoginUser: { id: user._id, name: user.name, email: user.email, isOwner: ownerStatus },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: error.message, stack: error.stack });
  }
});

/* ─────────────────────────────────────────
   GET /api/auth/test-email  (dev helper)
   Hit from browser to confirm email works
───────────────────────────────────────── */
router.get("/test-email", async (req, res) => {
  try {
    const { sendOTPEmail } = require("../utils/otpGenrater");
    await sendOTPEmail("mrabdullahamjid33@gmail.com", "123456", "Abdullah");
    res.send("✅ Test email sent successfully!");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Email failed: " + err.message);
  }
});

/* ─────────────────────────────────────────
   POST /api/auth/google
   Google OAuth token verification and login/signup
───────────────────────────────────────── */
router.post("/google", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required." });
    }

    // Verify token with google to get user info
    let fetchFn = global.fetch;
    if (!fetchFn) {
      fetchFn = (await import('node-fetch')).default;
    }
    const response = await fetchFn("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      return res.status(400).json({ success: false, message: "Invalid Google token." });
    }

    const userData = await response.json();
    const email = userData.email.toLowerCase();
    const name = userData.name;

    let user = await User.findOne({ email });
    if (!user) {
      // Generate a random password for Google-authenticated users
      const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
      const hashedPassword = await bcrypt.hash(randomPassword, 12);

      // Create user
      user = await User.create({
        name,
        email,
        password: hashedPassword,
        isVerified: true, // Google emails are verified
      });
    } else if (!user.isVerified) {
      // If user existed but wasn't verified, mark them verified since google verified the email
      user.isVerified = true;
      user.otp = null;
      user.otpExpiry = null;
      await user.save();
    }

    const jwtToken = await generateToken(user);
    res.status(200).json({
      success: true,
      message: "Google login successful!",
      apiToken: jwtToken,
      LoginUser: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/* ── Password Reset via OTP ── */
router.post("/send-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required." });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    console.log(`🔑 [DEV ONLY] Reset OTP for ${email} is: ${otp}`);
    await sendOTPEmail(email, otp, user.name.split(" ")[0]);
    res.json({ success: true, message: "OTP sent to email." });
  } catch (err) {
    console.error("Send reset OTP error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) {
      return res.status(400).json({ success: false, message: "Email, OTP and new password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters long." });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if (user.otp !== otp) return res.status(400).json({ success: false, message: "Invalid OTP." });
    if (new Date() > user.otpExpiry) return res.status(400).json({ success: false, message: "OTP expired." });

    const hashedPassword = await bcrypt.hash(password, 12);
    user.password = hashedPassword;
    user.isVerified = true; // ensure account is verified after reset
    user.otp = null;
    user.otpExpiry = null;
    await user.save();
    res.json({ success: true, message: "Password reset successfully." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/update-profile", authMiddleware, async (req, res) => {
  try {
    // Log incoming data for debugging
    console.log('🛠️ update-profile request body:', req.body);
    console.log('🛠️ auth user (decoded JWT):', req.user);

    const userId = req.user.id;
    const { name, password } = req.body;

    // If nothing to update, send a clear error
    if (!name && !password) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const update = {};
    if (name) update.name = name;
    if (password) {
      const hashed = await bcrypt.hash(password, 12);
      update.password = hashed;
    }

    const updatedUser = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    // Return updated info (omit password)
    const { _id, email, name: updatedName } = updatedUser;
    res.json({ success: true, message: "Profile updated", user: { id: _id, name: updatedName, email } });
  } catch (err) {
    console.error('❌ update-profile error:', err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ── Custom Labels (Protected) ── */
router.put("/labels", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { labels } = req.body;
    if (!labels) {
      return res.status(400).json({ success: false, message: "Labels object is required." });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    
    // Set labels
    user.labels = labels;
    await user.save();
    
    res.json({ success: true, message: "Labels updated successfully", labels: user.labels });
  } catch (err) {
    console.error("Update labels error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
