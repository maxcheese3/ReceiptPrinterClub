/**
 * install-service.js
 *
 * Installs the PrintBridge client as a Windows service so it starts
 * automatically on boot. Run this script once as Administrator.
 *
 * Usage:
 *   node install-service.js          (install)
 *   node install-service.js remove   (remove)
 */

require("dotenv").config();
const path    = require("path");
const { Service } = require("node-windows");

const svc = new Service({
  name:        "PrintBridge Client",
  description: "Polls PrintBridge server and prints messages to the local printer.",
  script:      path.join(__dirname, "client.js"),
  env: [
    { name: "SERVER_URL",        value: process.env.SERVER_URL       || "http://localhost:3000" },
    { name: "API_KEY",           value: process.env.API_KEY          || "" },
    { name: "POLL_INTERVAL_MS",  value: process.env.POLL_INTERVAL_MS || "5000" },
    { name: "SUMATRA_PATH",      value: process.env.SUMATRA_PATH     || "" },
    { name: "TEMP_DIR",          value: process.env.TEMP_DIR         || "" },
    { name: "LOG_LEVEL",         value: process.env.LOG_LEVEL        || "info" },
  ],
  // Restart policy: restart 3 times, then give up after 60 seconds
  maxRestarts: 3,
  wait: 3,
  grow: 0.5,
});

const action = process.argv[2];

if (action === "remove") {
  svc.on("uninstall", () => console.log("Service removed successfully."));
  svc.uninstall();
} else {
  svc.on("install", () => {
    svc.start();
    console.log("✓ PrintBridge Client service installed and started.");
    console.log("  It will now start automatically on Windows boot.");
  });
  svc.on("error", (err) => console.error("Service error:", err));
  svc.install();
}
