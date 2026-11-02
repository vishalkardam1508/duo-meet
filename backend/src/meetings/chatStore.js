"use strict";

const CHAT_ROOM_MAX = 15;
const CHAT_CODE_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

const chatRooms = new Map(); // roomId -> { members: Map<socket, { name, id }> }

function randomId(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function newChatCode() {
  let code;
  do { code = `${randomId(4)}-${randomId(4)}`; } while (chatRooms.has(code));
  return code;
}

function getOrCreateRoom(roomId) {
  if (!chatRooms.has(roomId)) chatRooms.set(roomId, { members: new Map(), adminId: null });
  return chatRooms.get(roomId);
}

function deleteRoomIfEmpty(roomId) {
  const room = chatRooms.get(roomId);
  if (room && room.members.size === 0) chatRooms.delete(roomId);
}

module.exports = { CHAT_ROOM_MAX, CHAT_CODE_RE, chatRooms, newChatCode, getOrCreateRoom, deleteRoomIfEmpty };
