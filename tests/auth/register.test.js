const request = require("supertest");
const app = require("../../src/app");
const mongoose = require("mongoose");
const connectDB = require("../../src/config/db");
const User = require("../../src/models/User");

jest.setTimeout(30000);

describe("POST /api/auth/register", () => {
  const testEmail = "testregisteruser@example.com";

  beforeAll(async () => {
    await connectDB();
    await User.deleteMany({ email: testEmail });
  });

  afterAll(async () => {
    await User.deleteMany({ email: testEmail });
    await mongoose.connection.close();
  });

  test("should register a new user successfully", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test Register User",
        email: testEmail,
        password: "Pass123!",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("OTP sent");
  });

  test("should fail registration if email is already registered and verified (returns 409)", async () => {
    // Mark user as verified
    await User.updateOne({ email: testEmail }, { isVerified: true });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test Duplicate User",
        email: testEmail,
        password: "Pass123!",
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Email already registered");
  });

  test("should return 400 when missing required fields", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: testEmail,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
