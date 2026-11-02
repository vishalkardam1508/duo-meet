"use strict";

const express = require("express");
const { CODE_RE } = require("../config");
const { buildIceServers } = require("../iceServers");
const admission = require("../meetings/admissionManager");
const reportCalls = require("../calls/reportCalls");
const {
  createIdentity,
  createParticipantToken,
  ensureRoom,
  getRoomService,
} = require("../livekit");

function createStatusHandler({ rooms, stats, getOnlineUsers }) {
  return (req, res) => {
    let activeCalls = 0;
    for (const room of rooms.values()) {
      if (room.size === 2) {
        activeCalls += 1;
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      status: "ok",
      onlineUsers: getOnlineUsers(),
      openMeetings: rooms.size,
      activeCalls,
      meetingsCreated: stats.meetingsCreated,
      uptimeSec: Math.round(process.uptime()),
    });
  };
}

function createApiRouter({ allowCreate, newCode, rooms, stats, getOnlineUsers }) {
  const router = express.Router();
  const reportCallRateLimits = new Map();
  let lastReportCallAt = 0;

  router.post("/meetings", (req, res) => {
    if (!allowCreate(req.ip)) {
      return res.status(429).json({
        error: "Too many meetings created. Wait a minute and try again.",
      });
    }

    stats.meetingsCreated += 1;
    const code = newCode();
    const hostKey = admission.createMeeting(code);
    const appUrl = (process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`)
      .replace(/\/$/, "");
    res.json({ code, url: `${appUrl}/m/${code}`, hostKey });
  });

  router.get("/config", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ iceServers: buildIceServers() });
  });

  router.get("/status", createStatusHandler({ rooms, stats, getOnlineUsers }));

  router.post("/reports/calls", (req, res, next) => {
    try {
      const report = typeof req.body?.report === "string" ? req.body.report : "";
      if (!report.trim() || report.length > reportCalls.MAX_REPORT_LENGTH) {
        return res.status(400).json({
          error: `Enter report text between 1 and ${reportCalls.MAX_REPORT_LENGTH} characters.`,
        });
      }
      const now = Date.now();
      for (const [ip, requestedAt] of reportCallRateLimits) {
        if (now - requestedAt >= 60_000) {
          reportCallRateLimits.delete(ip);
        }
      }
      const lastCallAt = reportCallRateLimits.get(req.ip) || 0;
      if (now - lastCallAt < 60_000 || now - lastReportCallAt < 60_000) {
        return res.status(429).json({ error: "Please wait a minute before starting another phone call." });
      }
      const call = reportCalls.startReportCall(report);
      reportCallRateLimits.set(req.ip, now);
      lastReportCallAt = now;
      res.status(202).json(call);
    } catch (error) {
      next(error);
    }
  });

  router.get("/reports/calls/:id", async (req, res, next) => {
    try {
      const call = await reportCalls.getReportCallStatus(req.params.id);
      if (!call) {
        return res.status(404).json({ error: "Phone call not found." });
      }
      res.json(call);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/reports/calls/:id", async (req, res, next) => {
    try {
      const call = await reportCalls.endReportCall(req.params.id);
      if (!call) {
        return res.status(404).json({ error: "Phone call not found." });
      }
      res.json(call);
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings/:code/host-token", async (req, res, next) => {
    try {
      const { code } = req.params;
      const name = admission.normalizeName(req.body?.name);
      const meeting = admission.getMeeting(code);
      if (!CODE_RE.test(code) || !meeting) {
        return res.status(404).json({ error: "Meeting not found." });
      }
      if (!admission.verifyHost(code, req.get("x-host-key"))) {
        return res.status(403).json({ error: "Host access is required." });
      }
      if (!name) {
        return res.status(400).json({ error: "Enter a name between 1 and 40 characters." });
      }
      await ensureRoom(meeting, code);
      const identity = meeting.hostIdentity || createIdentity();
      admission.setHost(code, identity, name);
      const credentials = await createParticipantToken({ code, identity, name, host: true });
      res.json({ ...credentials, identity, name, host: true, roomName: code });
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings/:code/join-requests", (req, res) => {
    const { code } = req.params;
    if (!CODE_RE.test(code)) {
      return res.status(404).json({ error: "Meeting not found." });
    }
    const name = admission.normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: "Enter a name between 1 and 40 characters." });
    }
    const result = admission.createJoinRequest(code, name);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(202).json({ requestId: result.id, status: "waiting" });
  });

  router.get("/meetings/:code/join-requests/:requestId", async (req, res, next) => {
    try {
      const { code, requestId } = req.params;
      const request = admission.getJoinRequest(code, requestId);
      if (!request) {
        return res.status(404).json({ error: "Join request expired or not found." });
      }
      if (request.status !== "admitted") {
        return res.json({ status: request.status });
      }
      const credentials = await createParticipantToken({
        code,
        identity: request.identity,
        name: request.name,
      });
      res.json({
        status: "admitted",
        ...credentials,
        identity: request.identity,
        name: request.name,
        host: false,
        roomName: code,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/meetings/:code/join-requests", (req, res) => {
    const { code } = req.params;
    if (!admission.verifyHost(code, req.get("x-host-key"))) {
      return res.status(403).json({ error: "Host access is required." });
    }
    const requests = admission.listWaitingRequests(code);
    if (!requests) {
      return res.status(404).json({ error: "Meeting not found." });
    }
    res.json({ requests, maxParticipants: admission.MAX_PARTICIPANTS });
  });

  router.post("/meetings/:code/join-requests/:requestId/decision", async (req, res, next) => {
    try {
      const { code, requestId } = req.params;
      if (!admission.verifyHost(code, req.get("x-host-key"))) {
        return res.status(403).json({ error: "Host access is required." });
      }
      if (typeof req.body?.admit !== "boolean") {
        return res.status(400).json({ error: "Choose whether to admit this participant." });
      }
      if (req.body.admit) {
        const participants = await getRoomService().listParticipants(code);
        const activeIdentities = new Set(participants.map((participant) => participant.identity));
        const reservations = admission.countAdmissionReservations(code, activeIdentities);
        if (participants.length + reservations >= admission.MAX_PARTICIPANTS) {
          return res.status(409).json({ error: "This meeting has reached its 25 participant limit." });
        }
      }
      const identity = req.body.admit ? createIdentity() : null;
      const result = admission.decideJoinRequest(code, requestId, req.body.admit, identity);
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json({ status: result.request.status });
    } catch (error) {
      next(error);
    }
  });

  router.post("/meetings/:code/host-transfer", async (req, res, next) => {
    try {
      const { code } = req.params;
      const currentKey = req.get("x-host-key");
      const targetIdentity = req.body?.identity;
      if (!admission.verifyHost(code, currentKey)) {
        return res.status(403).json({ error: "Host access is required." });
      }
      if (typeof targetIdentity !== "string" || !targetIdentity || targetIdentity.length > 128) {
        return res.status(400).json({ error: "Choose a meeting participant to become host." });
      }
      const meeting = admission.getMeeting(code);
      if (!meeting || targetIdentity === meeting.hostIdentity) {
        return res.status(400).json({ error: "Choose another participant." });
      }
      if (!admission.isKnownIdentity(code, targetIdentity)) {
        return res.status(404).json({ error: "That participant is no longer in the meeting." });
      }
      const roomService = admission.isGroupMode(code) ? getRoomService() : null;
      const participants = roomService ? await roomService.listParticipants(code) : [];
      const target = participants.find((participant) => participant.identity === targetIdentity);
      if (roomService && !target) {
        return res.status(404).json({ error: "That participant is no longer in the meeting." });
      }
      const previousIdentity = meeting.hostIdentity;
      if (roomService && previousIdentity && participants.some((participant) => participant.identity === previousIdentity)) {
        await roomService.updateParticipant(code, previousIdentity, {
          attributes: { host: "false" },
        });
      }
      try {
        if (roomService) {
          await roomService.updateParticipant(code, targetIdentity, {
            attributes: { host: "true" },
          });
        }
      } catch (error) {
        if (previousIdentity && participants.some((participant) => participant.identity === previousIdentity)) {
          await roomService.updateParticipant(code, previousIdentity, {
            attributes: { host: "true" },
          }).catch((rollbackError) => console.error("Couldn’t restore host role", rollbackError));
        }
        throw error;
      }
      const result = admission.transferHost(code, currentKey, targetIdentity);
      if (!result) {
        return res.status(409).json({ error: "Host access changed. Reload and try again." });
      }
      res.json({ hostKey: result.hostKey, targetIdentity });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createApiRouter, createStatusHandler };
