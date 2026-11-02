import { useEffect, useRef, useState } from "react";
import MeetingControls from "./MeetingControls.jsx";
import VideoPlayer from "./VideoPlayer.jsx";
import {
  createJoinRequest,
  getIceServers,
  getHostToken,
  getJoinRequest,
} from "../lib/api.js";

function getMediaError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera and microphone are blocked. Allow them in your browser’s site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one and try again.";
    case "NotReadableError":
      return "Your microphone or camera is being used by another app. Close that app and try again.";
    default:
      return "Couldn’t start your microphone. Reload the page and try again.";
  }
}

function getInitials(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

export default function LobbyPage({
  code,
  localStream,
  setLocalStream,
  setMedia,
  media,
  toggleMic,
  toggleCam,
  onJoin,
  onHome,
}) {
  const [name, setName] = useState(() => window.sessionStorage.getItem("duo-name") || "");
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const [requestState, setRequestState] = useState("idle");
  const cancelled = useRef(false);
  const hostKey = window.sessionStorage.getItem(`duo-host:${code}`);
  const isHost = Boolean(hostKey);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const startMedia = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext
        ? "This browser can’t make video calls. Use a recent Chrome, Edge, Firefox or Safari."
        : "Camera and microphone need a secure address. Open this page over https (or on localhost).");
    }

    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    const video = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: "user",
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio, video });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
        setNote("Camera isn’t available, so you’ll join with audio only.");
      } catch (mediaError) {
        throw new Error(getMediaError(mediaError));
      }
    }
    setLocalStream(stream);
    setMedia({ micOn: true, camOn: Boolean(stream.getVideoTracks().length) });
    return stream;
  };

  const handleJoin = async (event) => {
    event.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!cleanName || cleanName.length > 40) {
      setError("Enter your name (up to 40 characters).");
      return;
    }

    setError("");
    setBusy(true);
    cancelled.current = false;
    window.sessionStorage.setItem("duo-name", cleanName);
    try {
      let access = credentials;
      if (isHost) {
        access = await getHostToken(code, hostKey, cleanName);
        setCredentials(access);
      } else if (requestState === "idle") {
        const request = await createJoinRequest(code, cleanName);
        setRequestState("waiting");
        setNote("Waiting for the host to admit you…");
        while (!cancelled.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          const result = await getJoinRequest(code, request.requestId);
          if (result.status === "denied") {
            setRequestState("idle");
            setNote("");
            throw new Error("The host declined your request to join.");
          }
          if (result.status === "admitted") {
            access = result;
            setCredentials(result);
            setRequestState("admitted");
            setNote("");
            break;
          }
        }
        if (cancelled.current) {
          return;
        }
      }

      const stream = localStream || await startMedia();
      if (access) {
        const iceServers = await getIceServers();
        onJoin({ ...access, iceServers }, stream);
      }
    } catch (joinError) {
      setError(joinError.message || "Couldn’t join the meeting.");
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/m/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyLabel("Link copied");
      window.setTimeout(() => setCopyLabel("Copy link"), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const hasVideo = Boolean(localStream?.getVideoTracks().length);
  const cleanName = name.trim().replace(/\s+/g, " ");
  const buttonText = isHost
    ? "Start meeting"
    : requestState === "admitted"
      ? "Join meeting"
      : requestState === "waiting"
        ? "Waiting for host…"
        : "Request to join";

  return (
    <main className="lobby">
      <header className="prejoin-header">
        <p className="brand">Duo<span aria-hidden="true" /></p>
        <span className="prejoin-capacity">One-to-one or group · Up to 25 people</span>
      </header>
      <div className="lobby-inner">
        <section className="preview-wrap" aria-label="Camera preview">
          <div className="preview-label">
            <span className={`preview-indicator${localStream ? " preview-indicator-on" : ""}`} />
            {localStream ? "Camera preview" : "Camera preview is off"}
          </div>
          {localStream && (
            <>
              <VideoPlayer stream={localStream} className="preview-video" muted mirrored />
              {!media.camOn && <div className="preview-off">Camera is off</div>}
              <MeetingControls
                compact
                micOn={media.micOn}
                camOn={media.camOn}
                hasVideo={hasVideo}
                onToggleMic={toggleMic}
                onToggleCam={toggleCam}
              />
            </>
          )}
          {!localStream && (
            <div className="preview-off">
              <span className="preview-avatar" aria-hidden="true">{getInitials(name)}</span>
              <span className="preview-placeholder-title">{cleanName || "Your camera is off"}</span>
              <span className="preview-placeholder-copy">You can turn it on before joining</span>
            </div>
          )}
          <div className="preview-caption">
            <span>{cleanName || "Your name"}</span>
            <span>
              {localStream ? (media.micOn ? "Microphone on" : "Microphone off") : "Mic ready when you join"}
            </span>
          </div>
        </section>
        <div className="lobby-side">
          <p className="prejoin-eyebrow">{isHost ? "YOU’RE THE HOST" : "YOU’RE INVITED"}</p>
          <h1>{isHost ? "Ready to start?" : "Join the conversation"}</h1>
          <p className="prejoin-description">
            {isHost
              ? "Choose how your name appears, then start the meeting."
              : "Enter your name to ask the host to let you in."}
          </p>
          <div className="meeting-code-card">
            <span className="meeting-code-icon" aria-hidden="true">#</span>
            <span>
              <span className="meeting-code-label">MEETING CODE</span>
              <strong>{code}</strong>
            </span>
            <button className="meeting-copy" type="button" onClick={copyLink}>{copyLabel}</button>
          </div>
          <form onSubmit={handleJoin}>
            <label className="name-label" htmlFor="participant-name">Your display name</label>
            <input
              id="participant-name"
              className="name-input"
              autoComplete="name"
              maxLength={40}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              placeholder="e.g. Alex Morgan"
              disabled={busy || requestState === "waiting"}
              aria-describedby={error ? "prejoin-error" : "name-help"}
            />
            <p className="name-help" id="name-help">This is how your name will appear to everyone.</p>
            <div className="lobby-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !cleanName || requestState === "waiting"}
              >
                {busy ? "Connecting…" : buttonText}
              </button>
              {!isHost && requestState === "waiting" && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    cancelled.current = true;
                    setRequestState("idle");
                    setNote("");
                    setBusy(false);
                  }}
                >
                  Cancel request
                </button>
              )}
            </div>
          </form>
          {note && <p className="prejoin-note" role="status">{note}</p>}
          {error && <p className="error prejoin-error" id="prejoin-error" role="alert">{error}</p>}
          <button className="prejoin-back" type="button" onClick={onHome}>Back to home</button>
        </div>
      </div>
    </main>
  );
}
