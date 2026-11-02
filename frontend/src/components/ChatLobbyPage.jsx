import { useState } from "react";

export default function ChatLobbyPage() {
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");
  const kicked = new URLSearchParams(window.location.search).get("kicked");

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError("Enter your name."); return; }
    const id = `${rand(4)}-${rand(4)}`;
    window.location.assign(`/chat/${id}?name=${encodeURIComponent(name.trim())}`);
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError("Enter your name."); return; }
    const clean = roomId.trim().toLowerCase();
    if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(clean)) {
      setError("Enter a valid Room ID like abcd-1234.");
      return;
    }
    window.location.assign(`/chat/${clean}?name=${encodeURIComponent(name.trim())}`);
  };

  return (
    <main className="cl-page">
      <div className="cl-inner">
        <div className="cl-left">
          <p className="brand">Duo<span aria-hidden="true" /></p>
          <h1>Group Chat,<br />instantly.</h1>
          <p className="lede">Create a room, share the link, and chat with up to 15 people — no account needed.</p>
          {kicked && (
            <div className="cl-kicked-notice">
              You were removed from the room by the admin.
            </div>
          )}
          <div className="cl-features">
            <div className="cl-feature">
              <span className="cl-feature-icon">⚡</span>
              <span>Instant rooms</span>
            </div>
            <div className="cl-feature">
              <span className="cl-feature-icon">🔒</span>
              <span>No sign-up</span>
            </div>
            <div className="cl-feature">
              <span className="cl-feature-icon">👥</span>
              <span>Up to 15 people</span>
            </div>
          </div>
        </div>

        <div className="cl-right">
          <div className="cl-card">
            <div className="cl-tabs">
              <button
                className={`cl-tab${tab === "create" ? " active" : ""}`}
                onClick={() => { setTab("create"); setError(""); }}
              >
                Create Room
              </button>
              <button
                className={`cl-tab${tab === "join" ? " active" : ""}`}
                onClick={() => { setTab("join"); setError(""); }}
              >
                Join Room
              </button>
            </div>

            {tab === "create" ? (
              <form className="cl-form" onSubmit={handleCreate}>
                <label className="cl-label" htmlFor="cl-name-create">Your name</label>
                <input
                  id="cl-name-create"
                  className="cl-input"
                  placeholder="Enter your name"
                  maxLength={40}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(""); }}
                  autoFocus
                />
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn btn-primary cl-btn" type="submit">
                  Create &amp; Enter Room
                </button>
              </form>
            ) : (
              <form className="cl-form" onSubmit={handleJoin}>
                <label className="cl-label" htmlFor="cl-room-id">Room ID</label>
                <input
                  id="cl-room-id"
                  className="cl-input"
                  placeholder="e.g. abcd-1234"
                  maxLength={9}
                  value={roomId}
                  onChange={(e) => { setRoomId(e.target.value); setError(""); }}
                  autoFocus
                />
                <label className="cl-label" htmlFor="cl-name-join">Your name</label>
                <input
                  id="cl-name-join"
                  className="cl-input"
                  placeholder="Enter your name"
                  maxLength={40}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(""); }}
                />
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn btn-primary cl-btn" type="submit">
                  Join Room
                </button>
              </form>
            )}
          </div>
          <p className="fine">Works in any modern browser. Rooms are deleted when everyone leaves.</p>
        </div>
      </div>
    </main>
  );
}

function rand(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
