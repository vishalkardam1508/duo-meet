"use strict";

const crypto = require("crypto");

const MAX_PARTICIPANTS = 25;
const MAX_NAME_LENGTH = 40;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const ADMISSION_RESERVATION_MS = 2 * 60 * 1000;
const meetings = new Map();

function createMeeting(code) {
  const hostKey = crypto.randomBytes(32).toString("base64url");
  meetings.set(code, {
    hostKey,
    hostIdentity: null,
    hostName: null,
    knownIdentities: new Set(),
    directParticipants: new Set(),
    groupMode: false,
    roomCreated: false,
    roomCreating: null,
    requests: new Map(),
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
  return hostKey;
}

function getMeeting(code) {
  const meeting = meetings.get(code);
  if (meeting) {
    meeting.lastActivityAt = Date.now();
  }
  return meeting;
}

function verifyHost(code, hostKey) {
  const meeting = getMeeting(code);
  return Boolean(meeting && typeof hostKey === "string" && hostKey === meeting.hostKey);
}

function normalizeName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    return null;
  }
  return name;
}

function createJoinRequest(code, name) {
  const meeting = getMeeting(code);
  if (!meeting) {
    return { error: "Meeting not found.", status: 404 };
  }
  const pendingCount = [...meeting.requests.values()].filter((request) => request.status === "waiting").length;
  if (pendingCount >= MAX_PARTICIPANTS) {
    return { error: "The waiting room is full. Try again later.", status: 429 };
  }
  const id = crypto.randomUUID();
  meeting.requests.set(id, {
    id,
    name,
    status: "waiting",
    identity: null,
    createdAt: Date.now(),
  });
  return { id };
}

function getJoinRequest(code, requestId) {
  const meeting = getMeeting(code);
  if (!meeting) {
    return null;
  }
  const request = meeting.requests.get(requestId);
  if (!request || Date.now() - request.createdAt > REQUEST_TTL_MS) {
    meeting.requests.delete(requestId);
    return null;
  }
  return request;
}

function listWaitingRequests(code) {
  const meeting = getMeeting(code);
  if (!meeting) {
    return null;
  }
  return [...meeting.requests.values()]
    .filter((request) => request.status === "waiting")
    .map(({ id, name, createdAt }) => ({ id, name, createdAt }));
}

function decideJoinRequest(code, requestId, admitted, identity) {
  const meeting = getMeeting(code);
  const request = getJoinRequest(code, requestId);
  if (!meeting || !request) {
    return { error: "Join request not found.", status: 404 };
  }
  if (request.status !== "waiting") {
    return { error: "This request has already been handled.", status: 409 };
  }
  request.status = admitted ? "admitted" : "denied";
  request.identity = admitted ? identity : null;
  if (admitted) {
    request.admittedAt = Date.now();
    meeting.knownIdentities.add(identity);
  }
  return { request };
}

function countAdmissionReservations(code, activeIdentities) {
  const meeting = getMeeting(code);
  if (!meeting) {
    return 0;
  }
  const now = Date.now();
  const reservedIdentities = new Set();
  for (const request of meeting.requests.values()) {
    if (
      request.status === "admitted" &&
      request.admittedAt &&
      now - request.admittedAt < ADMISSION_RESERVATION_MS &&
      request.identity &&
      !activeIdentities.has(request.identity)
    ) {
      reservedIdentities.add(request.identity);
    }
  }
  for (const identity of meeting.directParticipants) {
    if (!activeIdentities.has(identity)) {
      reservedIdentities.add(identity);
    }
  }
  if (meeting.hostIdentity && !activeIdentities.has(meeting.hostIdentity)) {
    reservedIdentities.add(meeting.hostIdentity);
  }
  return reservedIdentities.size;
}

function findAdmittedRequest(code, requestId) {
  const request = getJoinRequest(code, requestId);
  return request?.status === "admitted" ? request : null;
}

function setHost(code, identity, name) {
  const meeting = getMeeting(code);
  if (!meeting) {
    return null;
  }
  meeting.hostIdentity = identity;
  meeting.hostName = name;
  if (identity) {
    meeting.knownIdentities.add(identity);
  }
  return meeting;
}

function promoteToGroup(code) {
  const meeting = getMeeting(code);
  if (!meeting) {
    return false;
  }
  meeting.groupMode = true;
  return true;
}

function joinDirectParticipant(code, identity) {
  const meeting = getMeeting(code);
  if (!meeting || !identity || meeting.groupMode) {
    return false;
  }
  meeting.directParticipants.add(identity);
  return true;
}

function leaveDirectParticipant(code, identity) {
  const meeting = getMeeting(code);
  if (!meeting || !identity) {
    return false;
  }
  return meeting.directParticipants.delete(identity);
}

function isGroupMode(code) {
  return Boolean(getMeeting(code)?.groupMode);
}

function isKnownIdentity(code, identity) {
  const meeting = getMeeting(code);
  return Boolean(meeting && meeting.knownIdentities.has(identity));
}

function transferHost(code, currentKey, identity) {
  const meeting = getMeeting(code);
  if (!meeting || meeting.hostKey !== currentKey || !meeting.knownIdentities.has(identity)) {
    return null;
  }
  const hostKey = crypto.randomBytes(32).toString("base64url");
  meeting.hostKey = hostKey;
  meeting.hostIdentity = identity;
  return { hostKey, meeting };
}

function sweepMeetings() {
  const cutoff = Date.now() - REQUEST_TTL_MS;
  for (const [code, meeting] of meetings) {
    for (const [id, request] of meeting.requests) {
      if (request.createdAt < cutoff && request.status !== "admitted") {
        meeting.requests.delete(id);
      }
    }
    if (meeting.lastActivityAt < cutoff) {
      meetings.delete(code);
    }
  }
}

const cleanupTimer = setInterval(sweepMeetings, 60_000);
cleanupTimer.unref();

module.exports = {
  MAX_NAME_LENGTH,
  MAX_PARTICIPANTS,
  createJoinRequest,
  createMeeting,
  countAdmissionReservations,
  decideJoinRequest,
  findAdmittedRequest,
  getJoinRequest,
  getMeeting,
  isGroupMode,
  isKnownIdentity,
  joinDirectParticipant,
  leaveDirectParticipant,
  listWaitingRequests,
  normalizeName,
  promoteToGroup,
  setHost,
  transferHost,
  verifyHost,
};
