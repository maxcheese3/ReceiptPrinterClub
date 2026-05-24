/**
 * install-service.js
 *
 * Installs the PrintBridge client as a background service so it starts
 * automatically on boot. Run once with appropriate permissions:
 *
 *   Windows  — run as Administrator:
 *     node install-service.js [remove]
 *
 *   macOS    — run as your normal user:
 *     node install-service.js [remove]
 *
 *   Linux    — outputs a systemd unit file you can install manually.
 *     node install-service.js
 */

require("dotenv").config();
const path = require("path");
const fs   = require("fs");
const os   = require("os");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC     = process.platform === "darwin";
const action     = process.argv[2]; // "remove" or undefined

// ── Windows — node-windows service ───────────────────────────────────────────
if (IS_WINDOWS) {
  const { Service } = require("node-windows");

  const svc = new Service({
    name:        "PrintBridge Client",
    description: "Polls PrintBridge server and prints messages to the local printer.",
    script:      path.join(__dirname, "client.js"),
    env: [
      { name: "SERVER_URL",        value: process.env.SERVER_URL       || "http://localhost:3000" },
      { name: "API_KEY",           value: process.env.API_KEY          || "" },
      { name: "POLL_INTERVAL_MS",  value: process.env.POLL_INTERVAL_MS || "5000" },
      { name: "TEMP_DIR",          value: process.env.TEMP_DIR         || "" },
      { name: "LOG_LEVEL",         value: process.env.LOG_LEVEL        || "info" },
    ],
    maxRestarts: 3,
    wait: 3,
    grow: 0.5,
  });

  if (action === "remove") {
    svc.on("uninstall", () => console.log("Service removed successfully."));
    svc.uninstall();
  } else {
    svc.on("install", () => {
      svc.start();
      console.log("✓ PrintBridge Client service installed and started.");
      console.log("  It will start automatically on Windows boot.");
    });
    svc.on("error", (err) => console.error("Service error:", err));
    svc.install();
  }
}

// ── macOS — launchd LaunchAgent ──────────────────────────────────────────────
else if (IS_MAC) {
  const PLIST_ID   = "com.printbridge.client";
  const AGENTS_DIR = path.join(os.homedir(), "Library", "LaunchAgents");
  const PLIST_PATH = path.join(AGENTS_DIR, `${PLIST_ID}.plist`);
  const LOG_DIR    = path.join(os.homedir(), "Library", "Logs", "PrintBridge");

  if (action === "remove") {
    // Unload then delete the plist
    const { execFileSync } = require("child_process");
    try {
      execFileSync("launchctl", ["unload", PLIST_PATH]);
      console.log("  Stopped service.");
    } catch {}
    try {
      fs.unlinkSync(PLIST_PATH);
      console.log("✓ PrintBridge Client service removed.");
    } catch (err) {
      console.error("Could not remove plist:", err.message);
    }
  } else {
    // Build environment variables dict from .env
    const envEntries = [
      ["SERVER_URL",        process.env.SERVER_URL       || "http://localhost:3000"],
      ["API_KEY",           process.env.API_KEY          || ""],
      ["POLL_INTERVAL_MS",  process.env.POLL_INTERVAL_MS || "5000"],
      ["PRINTER_DEVICE",    process.env.PRINTER_DEVICE   || ""],
      ["PRINTER_NAME",      process.env.PRINTER_NAME     || ""],
      ["PRINT_FONT_SIZE",   process.env.PRINT_FONT_SIZE  || "9"],
      ["PRINT_COLUMNS",     process.env.PRINT_COLUMNS    || "24"],
      ["PRINT_WIDTH_MM",    process.env.PRINT_WIDTH_MM   || "58"],
      ["PRINT_DPI",         process.env.PRINT_DPI        || "203"],
      ["TEMP_DIR",          process.env.TEMP_DIR         || ""],
      ["LOG_LEVEL",         process.env.LOG_LEVEL        || "info"],
      ["ARCHIVE_ENABLED",   process.env.ARCHIVE_ENABLED  || "true"],
      ["ARCHIVE_DIR",       process.env.ARCHIVE_DIR      || ""],
    ].filter(([, v]) => v !== ""); // omit empty values

    const envXml = envEntries
      .map(([k, v]) => `\t\t<key>${k}</key>\n\t\t<string>${v}</string>`)
      .join("\n");

    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.mkdirSync(LOG_DIR,    { recursive: true });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${PLIST_ID}</string>

\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${process.execPath}</string>
\t\t<string>${path.join(__dirname, "client.js")}</string>
\t</array>

\t<key>WorkingDirectory</key>
\t<string>${__dirname}</string>

\t<key>EnvironmentVariables</key>
\t<dict>
${envXml}
\t</dict>

\t<!-- Start at login and keep alive if it crashes -->
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>

\t<key>StandardOutPath</key>
\t<string>${path.join(LOG_DIR, "client.log")}</string>
\t<key>StandardErrorPath</key>
\t<string>${path.join(LOG_DIR, "client.error.log")}</string>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
</dict>
</plist>
`;

    fs.writeFileSync(PLIST_PATH, plist, "utf8");
    console.log(`✓ Plist written: ${PLIST_PATH}`);

    // Load it
    const { execFileSync } = require("child_process");
    try {
      // Unload first in case an old version is running
      try { execFileSync("launchctl", ["unload", PLIST_PATH]); } catch {}
      execFileSync("launchctl", ["load", PLIST_PATH]);
      console.log("✓ PrintBridge Client service loaded and started.");
      console.log(`  Logs: ${LOG_DIR}`);
      console.log("  To stop:   launchctl unload " + PLIST_PATH);
      console.log("  To remove: node install-service.js remove");
    } catch (err) {
      console.error("launchctl load failed:", err.message);
      console.log("You can load it manually:");
      console.log("  launchctl load " + PLIST_PATH);
    }
  }
}

// ── Linux — systemd unit file ─────────────────────────────────────────────────
else {
  const UNIT_NAME = "printbridge-client";
  const unit = `[Unit]
Description=PrintBridge Client
After=network.target

[Service]
Type=simple
WorkingDirectory=${__dirname}
ExecStart=${process.execPath} ${path.join(__dirname, "client.js")}
Restart=on-failure
RestartSec=5
Environment="SERVER_URL=${process.env.SERVER_URL       || "http://localhost:3000"}"
Environment="API_KEY=${process.env.API_KEY             || ""}"
Environment="POLL_INTERVAL_MS=${process.env.POLL_INTERVAL_MS || "5000"}"
Environment="PRINTER_DEVICE=${process.env.PRINTER_DEVICE  || ""}"
Environment="PRINTER_NAME=${process.env.PRINTER_NAME    || ""}"
Environment="PRINT_FONT_SIZE=${process.env.PRINT_FONT_SIZE || "9"}"
Environment="PRINT_COLUMNS=${process.env.PRINT_COLUMNS   || "24"}"
Environment="PRINT_WIDTH_MM=${process.env.PRINT_WIDTH_MM  || "58"}"
Environment="PRINT_DPI=${process.env.PRINT_DPI       || "203"}"
Environment="LOG_LEVEL=${process.env.LOG_LEVEL       || "info"}"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  const outPath = path.join(__dirname, `${UNIT_NAME}.service`);
  fs.writeFileSync(outPath, unit, "utf8");
  console.log(`✓ systemd unit written: ${outPath}`);
  console.log("\nInstall it with:");
  console.log(`  sudo cp ${outPath} /etc/systemd/system/`);
  console.log(`  sudo systemctl daemon-reload`);
  console.log(`  sudo systemctl enable --now ${UNIT_NAME}`);
  console.log("\nView logs:");
  console.log(`  journalctl -u ${UNIT_NAME} -f`);
}
