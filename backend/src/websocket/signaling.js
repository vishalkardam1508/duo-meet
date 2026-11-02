"use strict";

const { WebSocketServer } = require("ws");
const {
  ALLOWED_ORIGINS,
  CODE_RE,
  MAX_MSG_BYTES,
  MSG_MAX_PER_WINDOW,
  MSG_WINDOW_MS,
} = require("../config");
const admission = require("../meetings/admissionManager");
const { verifyParticipantToken } = require("../livekit");
const { CHAT_ROOM_MAX, CHAT_CODE_RE, chatRooms, getOrCreateRoom, deleteRoomIfEmpty } = require("../meetings/chatStore");

function attachSignaling(server, rooms) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: MAX_MSG_BYTES,
    verifyClient: (info) => !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(info.origin),
  });

  function sendTo(socket, message) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  // ── Meeting signaling ──────────────────────────────────────────────────────

  function leaveRoom(socket) {
    const code = socket.room;
    if (!code) return;
    socket.room = null;
    admission.leaveDirectParticipant(code, socket.identity);
    const room = rooms.get(code);
    if (!room) return;
    room.delete(socket);
    for (const peer of room) sendTo(peer, { type: "peer-left" });
    if (room.size === 0) rooms.delete(code);
  }

  async function joinRoom(socket, code, token) {
    if (typeof code !== "string" || !CODE_RE.test(code)) {
      sendTo(socket, { type: "error", message: "That meeting code isn't valid." });
      return;
    }
    const participant = await verifyParticipantToken(token, code);
    if (!participant) {
      sendTo(socket, { type: "error", message: "Meeting access could not be verified. Rejoin from the meeting link." });
      return;
    }
    if (!admission.getMeeting(code)) {
      sendTo(socket, { type: "error", message: "This meeting has expired. Ask the host for a new link." });
      return;
    }
    if (socket.room === code) return;
    if (socket.room) leaveRoom(socket);

    socket.identity = participant.identity;
    socket.name = participant.name.slice(0, 40);
    if (admission.isGroupMode(code)) {
      sendTo(socket, { type: "group" });
      return;
    }

    let room = rooms.get(code);
    if (room && room.size >= 2) {
      admission.promoteToGroup(code);
      for (const peer of room) sendTo(peer, { type: "promote" });
      sendTo(socket, { type: "group" });
      return;
    }
    if (!room) {
      room = new Set();
      rooms.set(code, room);
    }
    room.add(socket);
    socket.room = code;
    admission.joinDirectParticipant(code, socket.identity);

    const peers = [...room].filter((peer) => peer !== socket);
    sendTo(socket, {
      type: "joined",
      peers: peers.length,
      peerIdentity: peers[0]?.identity || "",
      peerName: peers[0]?.name || "",
    });
    for (const peer of room) {
      if (peer !== socket) {
        sendTo(peer, { type: "peer-joined", identity: socket.identity, name: socket.name });
      }
    }
  }

  function relay(socket, data) {
    if (!socket.room || !data || typeof data !== "object") return;
    const room = rooms.get(socket.room);
    if (!room) return;
    let clean = null;
    const description = data.description;
    const candidate = data.candidate;
    if (description && (description.type === "offer" || description.type === "answer") && typeof description.sdp === "string") {
      clean = { description: { type: description.type, sdp: description.sdp } };
    } else if (candidate && typeof candidate === "object" && typeof candidate.candidate === "string") {
      clean = {
        candidate: {
          candidate: candidate.candidate,
          sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
          sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : null,
          usernameFragment: typeof candidate.usernameFragment === "string" ? candidate.usernameFragment : null,
        },
      };
    }
    if (!clean) return;
    for (const peer of room) {
      if (peer !== socket) sendTo(peer, { type: "signal", data: clean });
    }
  }

  // ── Chat room handlers ─────────────────────────────────────────────────────

  function broadcastMembers(roomId) {
    const room = getOrCreateRoom(roomId);
    const members = [...room.members.values()].map(({ id, name }) => ({ id, name, isAdmin: id === room.adminId }));
    for (const [sock] of room.members) {
      sendTo(sock, { type: "chat-members", members });
    }
  }

  function chatJoin(socket, roomId, name) {
    if (typeof roomId !== "string" || !CHAT_CODE_RE.test(roomId)) {
      sendTo(socket, { type: "chat-error", message: "Invalid room ID." });
      return;
    }
    const cleanName = (typeof name === "string" ? name : "").trim().slice(0, 40) || "Guest";
    const room = getOrCreateRoom(roomId);
    if (room.members.size >= CHAT_ROOM_MAX) {
      sendTo(socket, { type: "chat-error", message: "This room is full (15 members max)." });
      return;
    }
    if (socket.chatRoom) chatLeave(socket);
    const id = Math.random().toString(36).slice(2, 10);
    socket.chatRoom = roomId;
    socket.chatId = id;
    socket.chatName = cleanName;
    room.members.set(socket, { id, name: cleanName });
    if (!room.adminId) room.adminId = id;

    const members = [...room.members.values()].map(({ id, name }) => ({ id, name, isAdmin: id === room.adminId }));
    sendTo(socket, { type: "chat-welcome", id, members, adminId: room.adminId });

    // notify others
    for (const [sock] of room.members) {
      if (sock !== socket) {
        sendTo(sock, { type: "chat-message", system: true, text: `${cleanName} joined`, senderId: null, senderName: null });
      }
    }
    broadcastMembers(roomId);
  }

  function chatMessage(socket, text) {
    if (!socket.chatRoom || typeof text !== "string") return;
    const clean = text.trim().slice(0, 2000);
    if (!clean) return;
    const room = getOrCreateRoom(socket.chatRoom);
    const msg = { type: "chat-message", senderId: socket.chatId, senderName: socket.chatName, text: clean, system: false };
    for (const [sock] of room.members) sendTo(sock, msg);
  }

  function chatKick(socket, targetId) {
    const roomId = socket.chatRoom;
    if (!roomId) return;
    const room = getOrCreateRoom(roomId);
    if (room.adminId !== socket.chatId) return;
    if (targetId === socket.chatId) return;
    for (const [sock, info] of room.members) {
      if (info.id === targetId) {
        sendTo(sock, { type: "chat-kicked", message: "You were removed by the admin." });
        room.members.delete(sock);
        sock.chatRoom = null;
        const name = info.name;
        for (const [s] of room.members) {
          sendTo(s, { type: "chat-message", system: true, text: `${name} was removed by the admin`, senderId: null, senderName: null });
        }
        broadcastMembers(roomId);
        deleteRoomIfEmpty(roomId);
        return;
      }
    }
  }

  function chatTransferAdmin(socket, targetId) {
    const roomId = socket.chatRoom;
    if (!roomId) return;
    const room = getOrCreateRoom(roomId);
    if (room.adminId !== socket.chatId) return;
    for (const [, info] of room.members) {
      if (info.id === targetId) {
        room.adminId = targetId;
        for (const [sock] of room.members) {
          sendTo(sock, { type: "chat-message", system: true, text: `${info.name} is now the admin.`, senderId: null, senderName: null });
        }
        broadcastMembers(roomId);
        return;
      }
    }
  }

  function chatLeave(socket) {
    const roomId = socket.chatRoom;
    if (!roomId) return;
    socket.chatRoom = null;
    const room = chatRooms.get(roomId);
    if (!room) return;
    const name = socket.chatName || "Someone";
    const wasAdmin = room.adminId === socket.chatId;
    room.members.delete(socket);
    if (room.members.size === 0) {
      chatRooms.delete(roomId);
      return;
    }
    // auto-promote next member if admin left
    if (wasAdmin) {
      const [, nextInfo] = room.members.entries().next().value;
      room.adminId = nextInfo.id;
      for (const [sock] of room.members) {
        sendTo(sock, { type: "chat-message", system: true, text: `${name} left. ${nextInfo.name} is now the admin.`, senderId: null, senderName: null });
      }
    } else {
      for (const [sock] of room.members) {
        sendTo(sock, { type: "chat-message", system: true, text: `${name} left`, senderId: null, senderName: null });
      }
    }
    broadcastMembers(roomId);
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  wss.on("connection", (socket) => {
    socket.isAlive = true;
    socket.room = null;
    socket.chatRoom = null;
    socket.msgCount = 0;
    socket.windowStart = Date.now();

    socket.on("pong", () => { socket.isAlive = true; });

    socket.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - socket.windowStart > MSG_WINDOW_MS) {
        socket.windowStart = now;
        socket.msgCount = 0;
      }
      if (++socket.msgCount > MSG_MAX_PER_WINDOW) return;

      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message.type !== "string") return;

      if (message.type === "join") {
        joinRoom(socket, message.code, message.token).catch((error) => {
          console.error("Couldn't verify meeting signaling access", error);
          sendTo(socket, { type: "error", message: "Couldn't verify meeting access. Try rejoining." });
        });
      } else if (message.type === "signal") {
        relay(socket, message.data);
      } else if (message.type === "leave") {
        leaveRoom(socket);
      } else if (message.type === "chat-join") {
        chatJoin(socket, message.roomId, message.name);
      } else if (message.type === "chat-message") {
        chatMessage(socket, message.text);
      } else if (message.type === "chat-kick") {
        chatKick(socket, message.targetId);
      } else if (message.type === "chat-transfer-admin") {
        chatTransferAdmin(socket, message.targetId);
      } else if (message.type === "chat-leave") {
        chatLeave(socket);
      }
    });

    socket.on("close", () => {
      leaveRoom(socket);
      chatLeave(socket);
    });
    socket.on("error", () => {});
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 25_000);

  return { heartbeat, wss };
}

module.exports = { attachSignaling };
