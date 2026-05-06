// @ts-nocheck
const { createRuntime } = require("../src/runtime");
const { createApp } = require("../src/http/app");

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = createRuntime().then((runtime) => createApp(runtime));
  }
  return appPromise;
}

module.exports = async (req, res) => {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        error: err?.message || "Failed to initialize server",
      })
    );
  }
};
