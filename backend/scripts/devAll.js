"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const dotenv = require("dotenv");

const projectRoot = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(projectRoot, "backend", ".env") });

const processes = new Map();
let shuttingDown = false;
let shutdownTimer;
let exitCode = 0;

function hasReportCallConfig() {
  const required = [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_SIP_TRUNK_ID",
    "REPORT_CALL_TO",
    "REPORT_CALLER_ID",
    "LIVEKIT_REPORT_AGENT_NAME",
  ];
  return required.every((name) => Boolean(process.env[name]?.trim()))
    && process.env.REPORT_CALL_ENABLED === "true"
    && /^\+[1-9]\d{7,14}$/.test(process.env.REPORT_CALL_TO)
    && /^\+[1-9]\d{7,14}$/.test(process.env.REPORT_CALLER_ID);
}

function isPortInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timed out checking backend port ${port}.`));
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        resolve(false);
      } else {
        reject(error);
      }
    });
  });
}

async function isDuoBackendRunning(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return false;
    }
    const status = await response.json();
    return status.status === "ok";
  } catch {
    return false;
  }
}

function stopAll(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  exitCode = code;
  for (const child of processes.keys()) {
    child.kill("SIGTERM");
  }
  if (processes.size === 0) {
    process.exitCode = exitCode;
    return;
  }
  shutdownTimer = setTimeout(() => {
    for (const child of processes.keys()) {
      child.kill("SIGKILL");
    }
    process.exit(exitCode || 1);
  }, 5000);
  shutdownTimer.unref();
}

function start(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  processes.set(child, label);
  child.once("error", (error) => {
    console.error(`[${label}] Could not start: ${error.message}`);
    stopAll(1);
  });
  child.once("close", (code) => {
    processes.delete(child);
    if (!shuttingDown) {
      console.error(`[${label}] exited${code === null ? "" : ` with code ${code}`}; stopping the other services.`);
      stopAll(code || 1);
    }
    if (shuttingDown && processes.size === 0) {
      clearTimeout(shutdownTimer);
      process.exitCode = exitCode;
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

async function run() {
  const backendPort = Number(process.env.PORT || 3000);
  if (await isPortInUse(backendPort)) {
    if (!(await isDuoBackendRunning(backendPort))) {
      throw new Error(
        `Port ${backendPort} is already in use by another service. Stop it or set PORT in backend/.env before running Duo.`,
      );
    }
    console.log(`[backend] Reusing the existing Duo server on port ${backendPort}.`);
  } else {
    start("backend", ["--watch", "backend/server.js"]);
  }

  start("frontend", [
    path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
    "--config",
    "frontend/vite.config.js",
    "--host",
    "0.0.0.0",
  ]);

  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│                                             │");
  console.log("│   ✅  Open this in your browser:            │");
  console.log("│                                             │");
  console.log("│      http://localhost:5173                  │");
  console.log("│                                             │");
  console.log("│   ⚡  Hot reload is ON — save = instant     │");
  console.log("│   🔌  Backend API runs on :3000             │");
  console.log("│                                             │");
  console.log("└─────────────────────────────────────────────┘\n");

  if (hasReportCallConfig()) {
    start("report-agent", ["backend/src/agents/reportReader.mjs", "start"]);
  } else {
    console.log(
      "[report-agent] Not started: configure the SIP, phone, LiveKit agent settings and set REPORT_CALL_ENABLED=true to enable report calls.",
    );
  }
}

run().catch((error) => {
  console.error(`[dev:all] ${error.message}`);
  stopAll(1);
});
