const nodemailer = require("nodemailer");
const env = require("../../config/env");

/** Create the shared Nodemailer transporter */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.AppEmail,
    pass: env.AppPassward,
  },
});

/**
 * Generate a random 6-digit OTP string.
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP email to the user.
 * @param {string} toEmail - Recipient email address
 * @param {string} otp     - The 6-digit OTP code
 * @param {string} name    - Recipient's first name for personalisation
 */
const sendOTPEmail = async (toEmail, otp, name = "User") => {
  const mailOptions = {
    from: `"Curtio" <${env.AppEmail}>`,
    to: toEmail,
    subject: "Your Curtio Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #4F46E5; font-size: 28px; margin: 0;">⚡ Curtio</h1>
        </div>
        <h2 style="color: #1e293b; font-size: 20px;">Hi ${name},</h2>
        <p style="color: #475569; font-size: 15px; line-height: 1.6;">
          Use the verification code below to complete your registration. 
          This code expires in <strong>10 minutes</strong>.
        </p>
        <div style="background: #4F46E5; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="color: white; font-size: 36px; font-weight: 800; letter-spacing: 10px;">${otp}</span>
        </div>
        <p style="color: #94a3b8; font-size: 13px;">
          If you didn't create a Curtio account, you can safely ignore this email.
        </p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { generateOTP, sendOTPEmail, transporter };
