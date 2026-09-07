const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const { isOwner } = require("../owners/owners.service");
const { generateOTP, sendOTPEmail } = require("../../lib/mail/otp");
const { generateToken } = require("../../lib/jwt");

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function buildAuthPayload(user, { includeOwner = true } = {}) {
  const token = await generateToken(user);
  const LoginUser = { id: user._id, name: user.name, email: user.email };
  if (includeOwner) {
    LoginUser.isOwner = await isOwner(user.email);
  }
  return { apiToken: token, LoginUser };
}

const register = async ({ name, email, password }) => {
  if (!name || !email || !password) {
    throw new AuthError(400, "All fields are required.");
  }

  if (password.length < 8) {
    throw new AuthError(400, "Password must be at least 8 characters long.");
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing && existing.isVerified) {
    throw new AuthError(409, "Email already registered. Please login.");
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  if (existing && !existing.isVerified) {
    existing.name = name;
    existing.password = hashedPassword;
    existing.otp = otp;
    existing.otpExpiry = otpExpiry;
    await existing.save();
  } else {
    await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      otp,
      otpExpiry,
    });
  }

  console.log(`🔑 [DEV ONLY] Registration OTP for ${email} is: ${otp}`);
  try {
    await sendOTPEmail(email, otp, name.split(" ")[0]);
  } catch (mailErr) {
    console.warn("⚠️ Failed to send OTP email (SMTP missing/misconfigured):", mailErr.message);
  }

  return {
    success: true,
    message: "OTP sent to your email. Please verify to complete registration.",
  };
};

const verifyOtp = async ({ email, otp }) => {
  if (!email || !otp) {
    throw new AuthError(400, "Email and OTP are required.");
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new AuthError(404, "User not found.");
  }

  if (user.isVerified) {
    throw new AuthError(400, "User already verified. Please login.");
  }

  if (user.otp !== otp) {
    throw new AuthError(400, "Invalid OTP. Please try again.");
  }

  if (new Date() > user.otpExpiry) {
    throw new AuthError(400, "OTP has expired. Please register again.");
  }

  user.isVerified = true;
  user.otp = null;
  user.otpExpiry = null;
  await user.save();

  const payload = await buildAuthPayload(user);
  return {
    success: true,
    message: "Email verified successfully!",
    ...payload,
  };
};

const login = async ({ email, password }) => {
  if (!email || !password) {
    throw new AuthError(400, "Email and password are required.");
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new AuthError(404, "No account found with this email.");
  }

  if (!user.isVerified) {
    throw new AuthError(403, "Email not verified. Please complete registration.");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AuthError(401, "Incorrect password.");
  }

  const payload = await buildAuthPayload(user);
  return {
    success: true,
    message: "Login successful!",
    ...payload,
  };
};

const loginWithGoogle = async ({ token }) => {
  if (!token) {
    throw new AuthError(400, "Token is required.");
  }

  let fetchFn = global.fetch;
  if (!fetchFn) {
    fetchFn = (await import("node-fetch")).default;
  }
  const response = await fetchFn("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new AuthError(400, "Invalid Google token.");
  }

  const userData = await response.json();
  const email = userData.email.toLowerCase();
  const name = userData.name;

  let user = await User.findOne({ email });
  if (!user) {
    const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
    const hashedPassword = await bcrypt.hash(randomPassword, 12);

    user = await User.create({
      name,
      email,
      password: hashedPassword,
      isVerified: true,
    });
  } else if (!user.isVerified) {
    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();
  }

  const payload = await buildAuthPayload(user, { includeOwner: false });
  return {
    success: true,
    message: "Google login successful!",
    ...payload,
  };
};

const sendResetOtp = async ({ email }) => {
  if (!email) {
    throw new AuthError(400, "Email is required.");
  }
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new AuthError(404, "User not found.");
  }

  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  user.otp = otp;
  user.otpExpiry = otpExpiry;
  await user.save();

  console.log(`🔑 [DEV ONLY] Reset OTP for ${email} is: ${otp}`);
  await sendOTPEmail(email, otp, user.name.split(" ")[0]);
  return { success: true, message: "OTP sent to email." };
};

const resetPassword = async ({ email, otp, password }) => {
  if (!email || !otp || !password) {
    throw new AuthError(400, "Email, OTP and new password are required.");
  }
  if (password.length < 8) {
    throw new AuthError(400, "Password must be at least 8 characters long.");
  }
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new AuthError(404, "User not found.");
  }
  if (user.otp !== otp) {
    throw new AuthError(400, "Invalid OTP.");
  }
  if (new Date() > user.otpExpiry) {
    throw new AuthError(400, "OTP expired.");
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  user.password = hashedPassword;
  user.isVerified = true;
  user.otp = null;
  user.otpExpiry = null;
  await user.save();
  return { success: true, message: "Password reset successfully." };
};

const updateProfile = async (userId, { name, password }) => {
  if (!name && !password) {
    throw new AuthError(400, "No fields to update");
  }

  const update = {};
  if (name) update.name = name;
  if (password) {
    const hashed = await bcrypt.hash(password, 12);
    update.password = hashed;
  }

  const updatedUser = await User.findByIdAndUpdate(userId, update, { new: true });
  if (!updatedUser) {
    throw new AuthError(404, "User not found");
  }
  const { _id, email, name: updatedName } = updatedUser;
  return { success: true, message: "Profile updated", user: { id: _id, name: updatedName, email } };
};

const updateLabels = async (userId, labels) => {
  if (!labels) {
    throw new AuthError(400, "Labels object is required.");
  }
  const user = await User.findById(userId);
  if (!user) {
    throw new AuthError(404, "User not found.");
  }

  user.labels = labels;
  await user.save();

  return { success: true, message: "Labels updated successfully", labels: user.labels };
};

const sendTestEmail = async () => {
  await sendOTPEmail("mrabdullahamjid33@gmail.com", "123456", "Abdullah");
};

module.exports = {
  AuthError,
  register,
  verifyOtp,
  login,
  loginWithGoogle,
  sendResetOtp,
  resetPassword,
  updateProfile,
  updateLabels,
  sendTestEmail,
};
