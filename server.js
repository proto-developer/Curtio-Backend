const app = require("./src/app");
const { startServer } = require("./src/server");

if (process.env.NODE_ENV !== "test") {
  startServer();
}

module.exports = app;
