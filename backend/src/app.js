"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { ALLOWED_ORIGINS, CODE_RE } = require("./config");
const { createApiRouter, createStatusHandler } = require("./routes/api");
const meetingStore = require("./meetings/meetingStore");

const projectRoot = path.resolve(__dirname, "..", "..");
const frontendBuildDir = path.join(projectRoot, "frontend", "dist");
const builtIndexFile = path.join(frontendBuildDir, "index.html");
const sourceIndexFile = path.join(projectRoot, "frontend", "index.html");

function createApp({ getOnlineUsers }) {
  const app = express();
  const indexFile = fs.existsSync(builtIndexFile) ? builtIndexFile : sourceIndexFile;

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
    next();
  });

  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS.length ? origin : "*");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "DELETE, GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Host-Key");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createApiRouter({
    ...meetingStore,
    getOnlineUsers,
  }));
  app.get("/health", createStatusHandler({
    ...meetingStore,
    getOnlineUsers,
  }));
  app.use(express.static(frontendBuildDir, { index: false, maxAge: "1h" }));

  app.get("/", (req, res) => res.sendFile(indexFile));
  app.get("/m/:code", (req, res) => (
    CODE_RE.test(req.params.code) ? res.sendFile(indexFile) : res.redirect("/")
  ));
  app.get("/chat", (req, res) => res.sendFile(indexFile));
  app.get("/chat/:roomId", (req, res) => res.sendFile(indexFile));
  app.get("/calls", (req, res) => res.sendFile(indexFile));
  app.use((req, res) => res.status(404).send("Not found"));
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
    if (status >= 500) {
      console.error("Request failed:", error);
    }
    res.status(status).json({
      error: status === 500 ? "The request could not be completed." : error.message,
    });
  });

  return app;
}

module.exports = { createApp };
