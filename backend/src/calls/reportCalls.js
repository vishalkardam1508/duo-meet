"use strict";

const crypto = require("crypto");
const {
  AgentDispatchClient,
  RoomServiceClient,
  SipClient,
} = require("livekit-server-sdk");

const MAX_REPORT_LENGTH = 5000;
const REPORT_CALL_TTL_MS = 60 * 60 * 1000;
const calls = new Map();

function getConfig() {
  if (process.env.REPORT_CALL_ENABLED !== "true") {
    const error = new Error(
      "Outbound report calls are disabled. Set REPORT_CALL_ENABLED=true only after verifying the SIP and voice-agent setup.",
    );
    error.status = 503;
    throw error;
  }
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const trunkId = process.env.LIVEKIT_SIP_TRUNK_ID;
  const destination = process.env.REPORT_CALL_TO;
  const callerId = process.env.REPORT_CALLER_ID;
  const agentName = process.env.LIVEKIT_REPORT_AGENT_NAME;

  if (!url || !apiKey || !apiSecret || !trunkId || !destination || !callerId || !agentName) {
    const error = new Error(
      "Outbound calls aren’t configured. Configure the LiveKit SIP trunk, destination, caller ID, and report-reading agent on the backend.",
    );
    error.status = 503;
    throw error;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(destination) || !/^\+[1-9]\d{7,14}$/.test(callerId)) {
    const error = new Error("Configure the phone destination and caller ID in international E.164 format.");
    error.status = 503;
    throw error;
  }
  const host = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return { host, apiKey, apiSecret, trunkId, destination, callerId, agentName };
}

function getCallStatus(id) {
  const call = calls.get(id);
  if (!call) {
    return null;
  }
  return {
    id: call.id,
    status: call.status,
    message: call.message,
    createdAt: call.createdAt,
  };
}

async function updateFromRoom(call) {
  const config = getConfig();
  const roomService = new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
  const participants = await roomService.listParticipants(call.roomName);
  const phoneParticipant = participants.find(
    (participant) => participant.identity === call.participantIdentity,
  );
  if (!phoneParticipant) {
    if (call.status === "connected") {
      call.status = "completed";
      call.message = "The call ended.";
    }
    return getCallStatus(call.id);
  }

  const sipStatus = phoneParticipant.attributes?.["sip.callStatus"] || "";
  if (sipStatus.includes("ACTIVE") || sipStatus === "2") {
    call.status = "connected";
    call.message = "Connected. The report is being read aloud.";
  } else if (sipStatus.includes("DISCONNECTED") || sipStatus === "3") {
    call.status = "completed";
    call.message = "The call ended.";
  } else if (sipStatus.includes("ERROR") || sipStatus === "4") {
    call.status = "failed";
    call.message = "The phone call could not be completed.";
  }
  return getCallStatus(call.id);
}

function startReportCall(report) {
  const config = getConfig();
  const cleanReport = typeof report === "string"
    ? report.trim().replace(/\r\n/g, "\n")
    : "";
  if (!cleanReport || cleanReport.length > MAX_REPORT_LENGTH) {
    const error = new Error(`Enter report text between 1 and ${MAX_REPORT_LENGTH} characters.`);
    error.status = 400;
    throw error;
  }
  const activeCall = [...calls.values()].find(
    (call) => !["completed", "failed"].includes(call.status),
  );
  if (activeCall) {
    const error = new Error("A phone call is already in progress.");
    error.status = 409;
    throw error;
  }

  const id = crypto.randomUUID();
  const call = {
    id,
    roomName: `report-${id}`,
    participantIdentity: `phone-${id}`,
    status: "preparing",
    message: "Preparing the secure call room.",
    createdAt: Date.now(),
    cancelRequested: false,
  };
  calls.set(id, call);

  void (async () => {
    const roomService = new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
    try {
      await roomService.createRoom({
        name: call.roomName,
        emptyTimeout: 300,
        departureTimeout: 30,
        maxParticipants: 3,
      });
      if (call.cancelRequested) {
        await roomService.deleteRoom(call.roomName);
        call.status = "completed";
        call.message = "The call was cancelled.";
        return;
      }

      const dispatchClient = new AgentDispatchClient(config.host, config.apiKey, config.apiSecret);
      await dispatchClient.createDispatch(call.roomName, config.agentName, {
        metadata: JSON.stringify({ type: "report-reading", callId: id, report: cleanReport }),
      });
      if (call.cancelRequested) {
        await roomService.deleteRoom(call.roomName);
        call.status = "completed";
        call.message = "The call was cancelled.";
        return;
      }
      call.status = "ringing";
      call.message = "Calling your configured phone number…";

      const sipClient = new SipClient(config.host, config.apiKey, config.apiSecret);
      const result = await sipClient.createSipParticipant(
        config.trunkId,
        config.destination,
        call.roomName,
        {
          fromNumber: config.callerId,
          participantIdentity: call.participantIdentity,
          participantName: "Report call",
          participantMetadata: JSON.stringify({ type: "report-reading-call", callId: id }),
          waitUntilAnswered: false,
          maxCallDuration: 600,
        },
      );
      if (call.cancelRequested) {
        await roomService.removeParticipant(call.roomName, call.participantIdentity)
          .catch((error) => console.error("Couldn’t end cancelled report call", error));
        call.status = "completed";
        call.message = "The call was cancelled.";
      } else if (result.callStatus === 2) {
        call.status = "connected";
        call.message = "Connected. The report is being read aloud.";
      }
    } catch (error) {
      console.error("Outbound report call failed", error);
      call.status = call.cancelRequested ? "completed" : "failed";
      call.message = call.cancelRequested
        ? "The call was cancelled."
        : "The call could not be started. Check the SIP trunk and voice-agent configuration.";
      await roomService.deleteRoom(call.roomName)
        .catch((cleanupError) => console.error("Couldn’t clean up report call room", cleanupError));
    }
  })();

  return getCallStatus(id);
}

async function getReportCallStatus(id) {
  const call = calls.get(id);
  if (!call) {
    return null;
  }
  if (call.status === "ringing" || call.status === "connected") {
    try {
      return await updateFromRoom(call);
    } catch (error) {
      console.error("Couldn’t refresh outbound call status", error);
    }
  }
  return getCallStatus(id);
}

async function endReportCall(id) {
  const call = calls.get(id);
  if (!call) {
    return null;
  }
  if (["completed", "failed"].includes(call.status)) {
    return getCallStatus(id);
  }
  const previousStatus = call.status;
  call.cancelRequested = true;
  call.status = "ending";
  call.message = "Ending the call…";
  const config = getConfig();
  const roomService = new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
  try {
    await roomService.removeParticipant(call.roomName, call.participantIdentity);
  } catch (error) {
    if (previousStatus !== "preparing") {
      throw error;
    }
    console.warn("Phone participant is not connected yet; cancellation will be applied when setup finishes.");
  }
  call.status = "completed";
  call.message = "The call was ended.";
  return getCallStatus(id);
}

function sweepCalls() {
  const cutoff = Date.now() - REPORT_CALL_TTL_MS;
  for (const [id, call] of calls) {
    if (call.createdAt < cutoff && ["completed", "failed"].includes(call.status)) {
      calls.delete(id);
    }
  }
}

const cleanupTimer = setInterval(sweepCalls, 60_000);
cleanupTimer.unref();

module.exports = {
  MAX_REPORT_LENGTH,
  endReportCall,
  getReportCallStatus,
  startReportCall,
};
