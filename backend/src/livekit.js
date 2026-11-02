"use strict";

const crypto = require("crypto");
const { AccessToken, RoomServiceClient, TokenVerifier } = require("livekit-server-sdk");
const { MAX_PARTICIPANTS } = require("./meetings/admissionManager");

function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return null;
  }
  return { url, apiKey, apiSecret };
}

function getRoomService() {
  const config = getLiveKitConfig();
  if (!config) {
    const error = new Error("LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.");
    error.status = 503;
    throw error;
  }
  const apiUrl = config.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return new RoomServiceClient(apiUrl, config.apiKey, config.apiSecret);
}

async function ensureRoom(meeting, code) {
  if (meeting.roomCreated) {
    return;
  }
  if (meeting.roomCreating) {
    await meeting.roomCreating;
    return;
  }
  const roomService = getRoomService();
  meeting.roomCreating = (async () => {
    const existing = await roomService.listRooms([code]);
    if (!existing.length) {
      await roomService.createRoom({
        name: code,
        maxParticipants: MAX_PARTICIPANTS,
        emptyTimeout: 10 * 60,
        departureTimeout: 2 * 60,
      });
    }
    meeting.roomCreated = true;
  })();
  try {
    await meeting.roomCreating;
  } finally {
    meeting.roomCreating = null;
  }
}

async function createParticipantToken({ code, identity, name, host = false }) {
  const config = getLiveKitConfig();
  if (!config) {
    const error = new Error("LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.");
    error.status = 503;
    throw error;
  }
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name,
    ttl: "2h",
    attributes: { host: String(host) },
  });
  token.addGrant({
    roomJoin: true,
    room: code,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return { token: await token.toJwt(), url: config.url };
}

async function verifyParticipantToken(token, code) {
  const config = getLiveKitConfig();
  if (!config || typeof token !== "string" || token.length > 8192) {
    return null;
  }
  try {
    const verifier = new TokenVerifier(config.apiKey, config.apiSecret);
    const payload = await verifier.verify(token);
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.video?.roomJoin !== true ||
      payload.video.room !== code
    ) {
      return null;
    }
    return {
      identity: payload.sub,
      name: typeof payload.name === "string" ? payload.name : "Participant",
    };
  } catch {
    return null;
  }
}

function createIdentity() {
  return `participant-${crypto.randomUUID()}`;
}

module.exports = {
  createIdentity,
  createParticipantToken,
  ensureRoom,
  getLiveKitConfig,
  getRoomService,
  verifyParticipantToken,
};
