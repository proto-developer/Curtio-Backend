const authService = require("./auth.service");

const register = async (req, res) => {
  try {
    const body = await authService.register(req.body);
    res.status(200).json(body);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Register error:", error);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const body = await authService.verifyOtp(req.body);
    res.status(200).json(body);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Verify OTP error:", error);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

const login = async (req, res) => {
  try {
    const body = await authService.login(req.body);
    res.status(200).json(body);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: error.message, stack: error.stack });
  }
};

const testEmail = async (req, res) => {
  try {
    await authService.sendTestEmail();
    res.send("✅ Test email sent successfully!");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Email failed: " + err.message);
  }
};

const google = async (req, res) => {
  try {
    const body = await authService.loginWithGoogle(req.body);
    res.status(200).json(body);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Google auth error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

const sendResetOtp = async (req, res) => {
  try {
    const body = await authService.sendResetOtp(req.body);
    res.json(body);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("Send reset OTP error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

const resetPassword = async (req, res) => {
  try {
    const body = await authService.resetPassword(req.body);
    res.json(body);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("Reset password error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

const updateProfile = async (req, res) => {
  try {
    console.log("🛠️ update-profile request body:", req.body);
    console.log("🛠️ auth user (decoded JWT):", req.user);

    const body = await authService.updateProfile(req.user.id, req.body);
    res.json(body);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("❌ update-profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateLabels = async (req, res) => {
  try {
    const body = await authService.updateLabels(req.user.id, req.body.labels);
    res.json(body);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("Update labels error:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

module.exports = {
  register,
  verifyOtp,
  login,
  testEmail,
  google,
  sendResetOtp,
  resetPassword,
  updateProfile,
  updateLabels,
};
