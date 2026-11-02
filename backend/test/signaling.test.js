"use strict";
// Starts the server on a random port and checks the signaling flow with real WebSocket clients.
process.env.PORT = "0";
const assert = require("assert");
const WebSocket = require("ws");
process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
process.env.LIVEKIT_API_KEY = "test-api-key";
process.env.LIVEKIT_API_SECRET = "test-api-secret";
process.env.LIVEKIT_SIP_TRUNK_ID = "";
process.env.REPORT_CALL_TO = "";
process.env.REPORT_CALLER_ID = "";
process.env.LIVEKIT_REPORT_AGENT_NAME = "";

let mockParticipants = [];
const livekit = require("../src/livekit");
livekit.getRoomService = () => ({
  listParticipants: async () => mockParticipants,
});
const admission = require("../src/meetings/admissionManager");
const { server } = require("../server");

function client(base) {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  const inbox = [];
  const waiters = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  ws.next = (type, ms = 2000) => new Promise((resolve, reject) => {
    const i = inbox.findIndex((m) => m.type === type);
    if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
    const t = setTimeout(() => reject(new Error("timeout waiting for " + type)), ms);
    waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m); } });
  });
  ws.none = (type, ms = 300) => new Promise((resolve, reject) => {
    setTimeout(() => inbox.some((m) => m.type === type) ? reject(new Error("unexpected " + type)) : resolve(), ms);
  });
  ws.json = (m) => ws.send(JSON.stringify(m));
  return new Promise((r) => ws.on("open", () => r(ws)));
}

async function run() {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let pass = 0;
  const ok = (name) => { pass++; console.log("  ✓", name); };

  // Create meeting
  const res = await fetch(base + "/api/meetings", { method: "POST" });
  const { code, url, hostKey } = await res.json();
  assert.match(code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  assert.ok(url.endsWith("/m/" + code));
  assert.ok(hostKey.length >= 32);
  ok("creates a meeting code and URL");

  const invalidReport = await fetch(`${base}/api/reports/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: "   " }),
  });
  assert.strictEqual(invalidReport.status, 400);
  ok("rejects empty phone-call reports");

  const oversizedReport = await fetch(`${base}/api/reports/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: "x".repeat(5001) }),
  });
  assert.strictEqual(oversizedReport.status, 400);
  ok("rejects reports over the configured length limit");

  const disabledCall = await fetch(`${base}/api/reports/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: "Test report" }),
  });
  assert.strictEqual(disabledCall.status, 503);
  assert.match((await disabledCall.json()).error, /disabled/i);
  ok("keeps outbound phone calls disabled until explicitly enabled");

  process.env.REPORT_CALL_ENABLED = "true";
  const missingCallConfig = await fetch(`${base}/api/reports/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: "Test report" }),
  });
  assert.strictEqual(missingCallConfig.status, 503);
  assert.match((await missingCallConfig.json()).error, /SIP trunk/i);
  ok("returns setup guidance instead of starting an unconfigured phone call");

  const preflight = await fetch(`${base}/api/meetings/${code}/host-token`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://frontend.example",
      "Access-Control-Request-Method": "DELETE",
      "Access-Control-Request-Headers": "content-type,x-host-key",
    },
  });
  assert.strictEqual(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
  assert.match(preflight.headers.get("access-control-allow-headers"), /x-host-key/i);
  ok("allows host authorization headers in cross-origin preflight requests");

  const joinResponse = await fetch(`${base}/api/meetings/${code}/join-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Guest One" }),
  });
  const { requestId } = await joinResponse.json();
  assert.strictEqual(joinResponse.status, 202);
  assert.strictEqual((await fetch(`${base}/api/meetings/${code}/join-requests`, {
    headers: { "x-host-key": "not-the-host-key" },
  })).status, 403);
  const waiting = await (await fetch(`${base}/api/meetings/${code}/join-requests`, {
    headers: { "x-host-key": hostKey },
  })).json();
  assert.strictEqual(waiting.requests.length, 1);
  assert.strictEqual(waiting.requests[0].name, "Guest One");
  const decision = await fetch(`${base}/api/meetings/${code}/join-requests/${requestId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-key": hostKey },
    body: JSON.stringify({ admit: true }),
  });
  assert.strictEqual(decision.status, 200);
  const joinStatus = await (await fetch(`${base}/api/meetings/${code}/join-requests/${requestId}`)).json();
  assert.strictEqual(joinStatus.status, "admitted");
  assert.strictEqual(joinStatus.name, "Guest One");
  assert.ok(joinStatus.token);
  ok("host-only admission queue issues LiveKit participant tokens");

  const capacityRequest = await fetch(`${base}/api/meetings/${code}/join-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "One More Guest" }),
  });
  const { requestId: capacityRequestId } = await capacityRequest.json();
  mockParticipants = Array.from({ length: 25 }, (_, index) => ({ identity: `active-${index}` }));
  const atCapacity = await fetch(`${base}/api/meetings/${code}/join-requests/${capacityRequestId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-key": hostKey },
    body: JSON.stringify({ admit: true }),
  });
  assert.strictEqual(atCapacity.status, 409);
  mockParticipants = [];
  ok("rejects admissions when the LiveKit room reaches 25 participants");

  const admission = require("../src/meetings/admissionManager");
  admission.setHost(code, "host-identity", "Host");
  for (let index = 0; index < 23; index += 1) {
    const request = admission.createJoinRequest(code, `Guest ${index + 2}`);
    assert.ok(request.id);
    assert.ok(admission.decideJoinRequest(code, request.id, true, `guest-${index}`).request);
  }
  const reservations = admission.countAdmissionReservations(code, new Set(["host-identity"]));
  assert.strictEqual(1 + reservations, 25);
  ok("caps admitted participants at 25 including the host");

  // Meeting page and bad code
  assert.strictEqual((await fetch(base + "/m/" + code)).status, 200);
  const bad = await fetch(base + "/m/NOT-valid", { redirect: "manual" });
  assert.strictEqual(bad.status, 302);
  ok("serves meeting page, redirects invalid codes");

  // Config
  const cfg = await (await fetch(base + "/api/config")).json();
  assert.ok(Array.isArray(cfg.iceServers) && cfg.iceServers.length >= 1);
  ok("returns ICE server config");

  admission.setHost(code, "host-identity", "Host");
  const transferResponse = await fetch(`${base}/api/meetings/${code}/host-transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-host-key": hostKey,
    },
    body: JSON.stringify({ identity: joinStatus.identity }),
  });
  assert.strictEqual(transferResponse.status, 200);
  const transferredHostKey = (await transferResponse.json()).hostKey;
  const restoreHostResponse = await fetch(`${base}/api/meetings/${code}/host-transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-host-key": transferredHostKey,
    },
    body: JSON.stringify({ identity: "host-identity" }),
  });
  assert.strictEqual(restoreHostResponse.status, 200);
  ok("supports host transfer during direct calls without a LiveKit participant lookup");

  const hostToken = await livekit.createParticipantToken({
    code,
    identity: "host-identity",
    name: "Host",
    host: true,
  });
  const guestToken = await livekit.createParticipantToken({
    code,
    identity: joinStatus.identity,
    name: "Guest One",
  });
  const nextGuestToken = await livekit.createParticipantToken({
    code,
    identity: "guest-two",
    name: "Guest Two",
  });
  const thirdGuestToken = await livekit.createParticipantToken({
    code,
    identity: "guest-three",
    name: "Guest Three",
  });

  const unauthenticated = await client(base);
  unauthenticated.json({ type: "join", code });
  await unauthenticated.next("error");
  unauthenticated.close();
  ok("rejects signaling connections without a valid meeting token");

  // Two people join directly
  const a = await client(base);
  a.json({ type: "join", code, token: hostToken.token });
  assert.strictEqual((await a.next("joined")).peers, 0);
  const b = await client(base);
  b.json({ type: "join", code, token: guestToken.token });
  const secondJoin = await b.next("joined");
  assert.strictEqual(secondJoin.peers, 1);
  assert.strictEqual(secondJoin.peerIdentity, "host-identity");
  await a.next("peer-joined");
  ok("second joiner triggers peer-joined for the first (offerer)");

  // Relay offer / answer / candidate only to the other peer
  a.json({ type: "signal", data: { description: { type: "offer", sdp: "v=0 offer" } } });
  const off = await b.next("signal");
  assert.deepStrictEqual(off.data, { description: { type: "offer", sdp: "v=0 offer" } });
  b.json({ type: "signal", data: { description: { type: "answer", sdp: "v=0 answer" } } });
  assert.strictEqual((await a.next("signal")).data.description.type, "answer");
  b.json({ type: "signal", data: { candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, extra: "x" } } });
  const cand = await a.next("signal");
  assert.deepStrictEqual(cand.data.candidate, { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null });
  ok("relays offer, answer and sanitized ICE candidates");

  // Junk is dropped
  a.json({ type: "signal", data: { description: { type: "pranswer", sdp: 1 } } });
  a.send("not json");
  await b.none("signal");
  ok("drops invalid signaling payloads");

  // Leave
  b.close();
  await a.next("peer-left");
  ok("remaining peer is told when the other leaves");

  // Rejoin after leaving works
  const d = await client(base);
  d.json({ type: "join", code, token: nextGuestToken.token });
  assert.strictEqual((await d.next("joined")).peers, 1);
  await a.next("peer-joined");
  ok("someone new can join after a peer leaves");

  // Third participant promotes the room and later joiners are routed to LiveKit.
  const c = await client(base);
  c.json({ type: "join", code, token: thirdGuestToken.token });
  await Promise.all([a.next("promote"), d.next("promote")]);
  await c.next("group");
  assert.strictEqual(admission.isGroupMode(code), true);
  ok("third participant promotes both direct peers to group mode");

  const laterGuestToken = await livekit.createParticipantToken({
    code,
    identity: "guest-four",
    name: "Guest Four",
  });
  const e = await client(base);
  e.json({ type: "join", code, token: laterGuestToken.token });
  await e.next("group");
  await c.none("signal");
  e.json({ type: "signal", data: { description: { type: "offer", sdp: "not-relayed" } } });
  await c.none("signal");
  ok("later joiners stay in group mode and cannot signal into direct calls");

  // Status
  const st = await (await fetch(base + "/api/status")).json();
  assert.strictEqual(st.status, "ok");
  assert.ok(!JSON.stringify(st).includes(code));
  ok("status shows counts only");

  // Invalid code
  d.json({ type: "join", code: "../../etc", token: nextGuestToken.token });
  await d.next("error");
  ok("rejects invalid meeting codes");

  [a, c, d, e].forEach((w) => w.close());
  console.log(`\n${pass} passed`);
  server.close(); process.exit(0);
}

run().catch((e) => { console.error("FAILED:", e); process.exit(1); });
