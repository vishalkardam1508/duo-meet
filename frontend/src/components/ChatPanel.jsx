import { useEffect, useRef, useState } from "react";

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function ChatPanel({ open, enabled, messages, onClose, onSend }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const messagesRef = useRef(null);

  useEffect(() => {
    if (open && enabled) inputRef.current?.focus();
  }, [enabled, open]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, open]);

  const submit = (event) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || !enabled) return;
    onSend(message);
    setText("");
  };

  return (
    <aside className={`chat${open ? " chat-open" : ""}`} aria-label="Chat" aria-hidden={!open}>
      <div className="chat-header">
        <span className="chat-title">In-call messages</span>
        <button className="chat-close" onClick={onClose} aria-label="Close chat">
          <CloseIcon />
        </button>
      </div>

      <div className="chat-messages" ref={messagesRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <p>No messages yet</p>
            <span>Messages can only be seen by people in the call</span>
          </div>
        ) : (
          messages.map((message) => (
            <div className={`msg msg-${message.kind}`} key={message.id}>
              {message.kind === "them" && message.name && (
                <span className="msg-sender">{message.name}</span>
              )}
              <div className="msg-bubble">{message.text}</div>
            </div>
          ))
        )}
      </div>

      <div className="chat-input-wrap">
        {!enabled && (
          <p className="chat-disabled-note">Chat available once someone joins</p>
        )}
        <form className="chat-form" onSubmit={submit}>
          <input
            ref={inputRef}
            className="chat-input"
            maxLength={2000}
            autoComplete="off"
            aria-label="Message"
            placeholder="Send a message…"
            disabled={!enabled}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="chat-send"
            type="submit"
            disabled={!enabled || !text.trim()}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </aside>
  );
}
