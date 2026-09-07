const http = require("http");
const env = require("./config/env");
const connectDB = require("./config/db");
const app = require("./app");
const { initSocket } = require("./socket");

const startServer = async () => {
  try {
    await connectDB();

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    httpServer.listen(env.PORT, () => {
      console.log(`✅ Server Started: http://localhost:${env.PORT}`);
    });
  } catch (error) {
    console.error("❌ DB Connection Failed:", error);
    process.exit(1);
  }
};

if (require.main === module && process.env.NODE_ENV !== "test") {
  startServer();
}

module.exports = { startServer, app };
