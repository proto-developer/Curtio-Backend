const request = require("supertest");
const app = require("../../src/app");
const mongoose = require("mongoose");
const connectDB = require("../../src/config/db");
const User = require("../../src/models/User");
const { generateToken } = require("../../src/lib/jwt");

jest.setTimeout(30000);

describe("URL Controller & Routes (/api/urls)", () => {
  let userToken;
  let testUser;
  let createdShortCode;

  beforeAll(async () => {
    await connectDB();
    await User.deleteMany({ email: "testurluser@example.com" });

    testUser = await User.create({
      name: "Test URL User",
      email: "testurluser@example.com",
      password: "hashedpassword123",
      isVerified: true,
    });

    userToken = await generateToken(testUser);
  }, 30000);

  afterAll(async () => {
    await User.deleteMany({ email: "testurluser@example.com" });
    await mongoose.connection.close();
  }, 30000);

  test("POST /api/urls - should return 401 if unauthenticated", async () => {
    const res = await request(app)
      .post("/api/urls")
      .send({ originalUrl: "https://example.com" });

    expect(res.statusCode).toBe(401);
  });

  test("POST /api/urls - should create a short URL when authenticated", async () => {
    const res = await request(app)
      .post("/api/urls")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ originalUrl: "https://example.com/test-page" });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.url).toBeDefined();
    expect(res.body.url.shortCode).toBeDefined();
    createdShortCode = res.body.url.shortCode;
  });

  test("POST /api/urls - should fail when destination URL is missing", async () => {
    const res = await request(app)
      .post("/api/urls")
      .set("Authorization", `Bearer ${userToken}`)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("GET /api/urls - should return user's URLs", async () => {
    const res = await request(app)
      .get("/api/urls")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.urls)).toBe(true);
    expect(res.body.urls.length).toBeGreaterThan(0);
  });

  test("PATCH /api/urls/:shortCode/toggle - should toggle URL active status", async () => {
    const res = await request(app)
      .patch(`/api/urls/${createdShortCode}/toggle`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("DELETE /api/urls/:shortCode - should delete a URL", async () => {
    const res = await request(app)
      .delete(`/api/urls/${createdShortCode}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("GET / - Health check endpoint", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
