"use strict";

const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const MAX_MSG_BYTES = 64 * 1024;
const MSG_WINDOW_MS = 10_000;
const MSG_MAX_PER_WINDOW = 300;
const TURN_TTL_SEC = Number(process.env.TURN_TTL_SEC) || 4 * 60 * 60;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  ALLOWED_ORIGINS,
  CODE_RE,
  MAX_MSG_BYTES,
  MSG_MAX_PER_WINDOW,
  MSG_WINDOW_MS,
  TURN_TTL_SEC,
};
