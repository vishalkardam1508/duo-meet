function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      <path className="slash" d="M4 4l16 16" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
      <path className="slash" d="M3 3l18 18" />
    </svg>
  );
}

export default function MeetingControls({
  micOn,
  camOn,
  hasVideo,
  onToggleMic,
  onToggleCam,
  onChat,
  onLeave,
  unread = 0,
  compact = false,
}) {
  return (
    <div className={compact ? "preview-controls" : "controls"}>
      <button
        className={`ctl${micOn ? "" : " off"}`}
        onClick={onToggleMic}
        aria-label={micOn ? "Turn microphone off" : "Turn microphone on"}
        aria-pressed={!micOn}
      >
        <MicIcon />
        {!compact && <span className="ctl-label">{micOn ? "Mute" : "Unmute"}</span>}
      </button>
      <button
        className={`ctl${camOn ? "" : " off"}`}
        onClick={onToggleCam}
        disabled={!hasVideo}
        aria-label={camOn ? "Turn camera off" : "Turn camera on"}
        aria-pressed={!camOn}
      >
        <CameraIcon />
        {!compact && <span className="ctl-label">{camOn ? "Stop video" : "Start video"}</span>}
      </button>
      {!compact && (
        <>
          <button className="ctl chat-control" onClick={onChat} aria-label="Open chat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
            <span className="ctl-label">Chat</span>
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
          <button className="ctl hangup" onClick={onLeave} aria-label="Leave meeting">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.56.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.36 11.36 0 0 0 .57 3.56 1 1 0 0 1-.25 1.02z" />
            </svg>
            <span className="ctl-label">Leave</span>
          </button>
        </>
      )}
    </div>
  );
}
