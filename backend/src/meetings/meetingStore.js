"use strict";

const crypto = require("crypto");

const rooms = new Map();
const stats = { meetingsCreated: 0 };
const createHits = new Map();

function allowCreate(ip) {
  const now = Date.now();
  const entry = createHits.get(ip);
  if (!entry || entry.resetAt < now) {
    createHits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of createHits) {
    if (entry.resetAt < now) {
      createHits.delete(ip);
    }
  }
}, 60_000).unref();

function randomLetters(length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(97 + crypto.randomInt(26));
  }
  return result;
}

function newCode() {
  let code;
  do {
    code = `${randomLetters(3)}-${randomLetters(4)}-${randomLetters(3)}`;
  } while (rooms.has(code));
  return code;
}

module.exports = {
  allowCreate,
  newCode,
  rooms,
  stats,
};
