"use strict";

const crypto = require("crypto");
const { TURN_TTL_SEC } = require("./config");

function parseUrls(value) {
  return (value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function buildIceServers() {
  const servers = [{
    urls: parseUrls(process.env.STUN_URLS || "stun:stun.l.google.com:19302"),
  }];
  const turnUrls = parseUrls(process.env.TURN_URLS);

  if (turnUrls.length && process.env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SEC}:duo`;
    const credential = crypto
      .createHmac("sha1", process.env.TURN_SECRET)
      .update(username)
      .digest("base64");
    servers.push({ urls: turnUrls, username, credential });
  } else if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  return servers;
}

module.exports = { buildIceServers };
