const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "").trim().replace(/\/$/, "");

const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function getWebSocketUrl() {
  if (SERVER_URL) {
    return SERVER_URL.replace(/^http/, "ws") + "/ws";
  }
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
}

export async function createMeeting() {
  const response = await fetch(`${SERVER_URL}/api/meetings`, { method: "POST" });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Request failed");
  }
  return result;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${SERVER_URL}/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Request failed");
  }
  return result;
}

export async function getHostToken(code, hostKey, name) {
  return requestJson(`/meetings/${code}/host-token`, {
    method: "POST",
    headers: { "x-host-key": hostKey },
    body: JSON.stringify({ name }),
  });
}

export async function createJoinRequest(code, name) {
  return requestJson(`/meetings/${code}/join-requests`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function getJoinRequest(code, requestId) {
  return requestJson(`/meetings/${code}/join-requests/${requestId}`);
}

export async function getWaitingRoomRequests(code, hostKey) {
  return requestJson(`/meetings/${code}/join-requests`, {
    headers: { "x-host-key": hostKey },
  });
}

export async function decideJoinRequest(code, requestId, hostKey, admit) {
  return requestJson(`/meetings/${code}/join-requests/${requestId}/decision`, {
    method: "POST",
    headers: { "x-host-key": hostKey },
    body: JSON.stringify({ admit }),
  });
}

export async function transferMeetingHost(code, hostKey, identity) {
  return requestJson(`/meetings/${code}/host-transfer`, {
    method: "POST",
    headers: { "x-host-key": hostKey },
    body: JSON.stringify({ identity }),
  });
}

export async function startReportCall(report) {
  return requestJson("/reports/calls", {
    method: "POST",
    body: JSON.stringify({ report }),
  });
}

export async function getReportCallStatus(callId) {
  return requestJson(`/reports/calls/${encodeURIComponent(callId)}`);
}

export async function endReportCall(callId) {
  return requestJson(`/reports/calls/${encodeURIComponent(callId)}`, {
    method: "DELETE",
  });
}

export async function getIceServers() {
  const response = await fetch(`${SERVER_URL}/api/config`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Couldn’t load call network settings.");
  }
  const result = await response.json();
  return Array.isArray(result.iceServers) && result.iceServers.length
    ? result.iceServers
    : FALLBACK_ICE_SERVERS;
}

export { FALLBACK_ICE_SERVERS };
