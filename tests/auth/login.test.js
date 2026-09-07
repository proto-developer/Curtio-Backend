const request = require("supertest");
const app = require("../../src/app");
const mongoose = require("mongoose");
const connectDB = require("../../src/config/db");
const User = require("../../src/models/User");

jest.setTimeout(30000);

describe("POST /api/auth/login", () => {
  const testUser = {
    name: "Test Flow User",
    email: "testflowuser@example.com",
    password: "Password123!",
  };

  const unverifiedEmail = "unverifiedflow@example.com";

  beforeAll(async () => {
    await connectDB();
    await User.deleteMany({ email: { $in: [testUser.email, unverifiedEmail] } });

    // Step 1: Register testUser via API endpoint
    await request(app)
      .post("/api/auth/register")
      .send(testUser);

    // Mark testUser verified in DB so login can succeed
    await User.updateOne({ email: testUser.email }, { isVerified: true });

    // Register unverified user via API endpoint (leave as unverified)
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Unverified User",
        email: unverifiedEmail,
        password: "Password123!",
      });
  }, 30000);

  afterAll(async () => {
    // Remove test users from DB after login test passes
    await User.deleteMany({ email: { $in: [testUser.email, unverifiedEmail] } });
    await mongoose.connection.close();
  }, 30000);

  test("should fail login when password is wrong (returns 401)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: "WrongPassword999",
      });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Incorrect password.");
  });

  test("should fail login when email is not verified (returns 403)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: unverifiedEmail,
        password: "Password123!",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Email not verified");
  });

  test("should fail login when required fields are missing (returns 400)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("should login successfully with correct registered credentials (returns 200)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: testUser.password,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.apiToken).toBeDefined();
    expect(res.body.LoginUser).toBeDefined();
    expect(res.body.LoginUser.email).toBe(testUser.email);
  });
});

