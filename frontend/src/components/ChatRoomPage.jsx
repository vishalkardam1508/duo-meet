import { useEffect, useRef, useState } from "react";
import { getWebSocketUrl } from "../lib/api.js";

const EMOJIS = ["😀","😂","😍","🥰","😎","🤔","😅","🙏","👍","👎","❤️","🔥","🎉","😭","😤","🤣","😊","😇","🥳","😴","👀","💯","✅","🚀","💬","🎯","😬","🤯","😱","🤝"];

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

function avatarHue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

function Avatar({ name, size = 32 }) {
  return (
    <div
      className="cr-avatar"
      style={{ "--avatar-hue": avatarHue(name), width: size, height: size, fontSize: size * 0.34 }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}

export default function ChatRoomPage({ roomId, name }) {
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [showMembers, setShowMembers] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy invite");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const myId = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e) => {
      if (!e.target.closest(".cr-emoji-picker") && !e.target.closest(".cr-emoji-btn")) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmoji]);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "chat-join", roomId, name }));

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === "chat-welcome") {
        myId.current = msg.id;
        setIsAdmin(msg.adminId === msg.id);
        setStatus("Connected");
        setMembers(msg.members);
      } else if (msg.type === "chat-message") {
        setMessages((prev) => [...prev, msg]);
      } else if (msg.type === "chat-members") {
        setMembers(msg.members);
        setIsAdmin(msg.members.some((m) => m.id === myId.current && m.isAdmin));
      } else if (msg.type === "chat-kicked") {
        window.location.assign("/chat?kicked=1");
      } else if (msg.type === "chat-error") {
        setStatus(msg.message || "Error");
      }
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = () => setStatus("Connection error");

    return () => { ws.send(JSON.stringify({ type: "chat-leave" })); ws.close(); };
  }, [roomId, name]);

  // Block navigation if admin and others present
  useEffect(() => {
    const others = members.filter((m) => m.id !== myId.current);
    if (!isAdmin || others.length === 0) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isAdmin, members]);

  const tryLeave = () => {
    const others = members.filter((m) => m.id !== myId.current);
    if (isAdmin && others.length > 0) {
      setShowTransfer(true);
    } else {
      window.location.assign("/chat");
    }
  };

  const transferAdmin = (targetId) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "chat-transfer-admin", targetId }));
    }
    setShowTransfer(false);
    // leave after transfer
    setTimeout(() => window.location.assign("/chat"), 200);
  };

  const cancelTransfer = () => {
    setShowTransfer(false);
  };

  const kick = (targetId) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "chat-kick", targetId }));
    }
  };

  const send = (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "chat-message", text: clean.slice(0, 2000) }));
    setText("");
  };

  const insertEmoji = (emoji) => {
    setText((t) => t + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  };

  const copyInvite = async () => {
    const url = `${window.location.origin}/chat/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy invite"), 2000);
    } catch { window.prompt("Share this link:", url); }
  };

  const connected = status === "Connected";

  return (
    <div className="cr-page">
      <header className="cr-topbar">
        <div className="cr-topbar-left">
          <div className="cr-room-pill">
            <span className="cr-room-hash">#</span>
            <span className="cr-room-id">{roomId}</span>
          </div>
          <span className="cr-member-count">
            <span className={`cr-status-dot${connected ? " online" : ""}`} />
            {members.length}/15
          </span>
        </div>
        <div className="cr-topbar-right">
          <button className="cr-action-btn" onClick={copyInvite} title="Copy invite link">
            <LinkIcon />
            <span>{copyLabel}</span>
          </button>
          <button
            className={`cr-action-btn${showMembers ? " active" : ""}`}
            onClick={() => setShowMembers((s) => !s)}
            title="Toggle members"
          >
            <UsersIcon />
            <span>Members</span>
          </button>
          <button className="cr-action-btn cr-leave" onClick={tryLeave}>
            Leave
          </button>
        </div>
      </header>

      <div className="cr-body">
        <main className="cr-main">
          <div className="cr-messages">
            {!connected && (
              <div className="cr-empty">
                <div className="cr-empty-icon">⚡</div>
                <p>{status}</p>
              </div>
            )}
            {connected && messages.length === 0 && (
              <div className="cr-empty">
                <div className="cr-empty-icon">💬</div>
                <p>No messages yet</p>
                <span>Say hello to get the conversation started!</span>
              </div>
            )}
            {messages.map((msg, i) => {
              if (msg.system) return <div className="cr-sys" key={i}>{msg.text}</div>;
              const isMe = msg.senderId === myId.current;
              return (
                <div className={`cr-msg${isMe ? " cr-msg-me" : " cr-msg-them"}`} key={i}>
                  {!isMe && <Avatar name={msg.senderName || "?"} size={34} />}
                  <div className="cr-msg-body">
                    {!isMe && <span className="cr-msg-name">{msg.senderName}</span>}
                    <div className="cr-bubble">{msg.text}</div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="cr-input-bar">
            {showEmoji && (
              <div className="cr-emoji-picker">
                {EMOJIS.map((em) => (
                  <button key={em} className="cr-emoji-item" onClick={() => insertEmoji(em)} type="button">
                    {em}
                  </button>
                ))}
              </div>
            )}
            <form className="cr-form" onSubmit={send}>
              <button
                type="button"
                className={`cr-emoji-btn${showEmoji ? " active" : ""}`}
                onClick={() => setShowEmoji((s) => !s)}
                aria-label="Emoji"
              >
                😊
              </button>
              <input
                ref={inputRef}
                className="cr-input"
                placeholder={connected ? `Message #${roomId}…` : "Connecting…"}
                disabled={!connected}
                value={text}
                maxLength={2000}
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
              />
              <button className="cr-send" type="submit" disabled={!connected || !text.trim()} aria-label="Send">
                <SendIcon />
              </button>
            </form>
          </div>
        </main>

        {showMembers && (
          <aside className="cr-sidebar">
            <h3 className="cr-sidebar-title">Members — {members.length}</h3>
            <ul className="cr-members-list" role="list">
              {members.map((m) => (
                <li className="cr-member" key={m.id}>
                  <Avatar name={m.name} size={36} />
                  <div className="cr-member-info">
                    <span className="cr-member-name">
                      {m.name}{m.id === myId.current ? " (You)" : ""}
                      {m.isAdmin && <span className="cr-admin-badge">👑 Admin</span>}
                    </span>
                    <span className="cr-member-status">Online</span>
                  </div>
                  <span className="cr-online-dot" />
                  {isAdmin && m.id !== myId.current && (
                    <button className="cr-kick-btn" onClick={() => kick(m.id)} title={`Remove ${m.name}`}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      {showTransfer && (
        <div className="cr-modal-backdrop">
          <div className="cr-modal">
            <h3 className="cr-modal-title">Transfer Admin</h3>
            <p className="cr-modal-desc">You're the admin. Pick someone to hand over admin before you leave.</p>
            <ul className="cr-modal-list" role="list">
              {members.filter((m) => m.id !== myId.current).map((m) => (
                <li key={m.id}>
                  <button className="cr-modal-member" onClick={() => transferAdmin(m.id)}>
                    <Avatar name={m.name} size={32} />
                    <span>{m.name}</span>
                    <span className="cr-modal-promote">Make Admin →</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="cr-modal-cancel" onClick={cancelTransfer}>Stay in room</button>
          </div>
        </div>
      )}
    </div>
  );
}
