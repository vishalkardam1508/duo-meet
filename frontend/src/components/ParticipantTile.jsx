import { useEffect, useRef } from "react";

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("") || "?";
}

function avatarHue(identity) {
  let value = 0;
  for (const character of identity) {
    value = (value * 31 + character.charCodeAt(0)) % 360;
  }
  return value;
}

function AttachedTrack({ track, kind, muted = false }) {
  const elementRef = useRef(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!track || !element) {
      return undefined;
    }
    track.attach(element);
    return () => track.detach(element);
  }, [track]);

  if (!track) {
    return null;
  }
  if (kind === "audio") {
    return <audio className="participant-audio" ref={elementRef} autoPlay playsInline />;
  }
  return <video ref={elementRef} autoPlay playsInline muted={muted} />;
}

export default function ParticipantTile({ participant, canTransferHost = false, onTransferHost }) {
  const { identity, name, cameraTrack, microphoneTrack, cameraOn, microphoneOn, host, local, speaking } = participant;
  return (
    <article
      className={`participant-tile${speaking ? " speaking" : ""}`}
      aria-label={`${name}${local ? ", you" : ""}${host ? ", host" : ""}`}
    >
      {cameraOn && cameraTrack
        ? <AttachedTrack track={cameraTrack} kind="video" muted={local} />
        : <div
          className="participant-avatar"
          style={{ "--avatar-hue": avatarHue(identity) }}
          aria-hidden="true"
        >
          <span>{initials(name)}</span>
        </div>}
      {microphoneTrack && !local && <AttachedTrack track={microphoneTrack} kind="audio" />}
      <div className="participant-caption">
        <span className="participant-name">{name}{local ? " (You)" : ""}</span>
        <span className="participant-state">
          {host && <span className="host-badge">Host</span>}
          {!microphoneOn && <span aria-label="Microphone muted">Muted</span>}
        </span>
      </div>
      {canTransferHost && (
        <button
          className="transfer-host"
          onClick={() => onTransferHost(identity, name)}
        >
          Make host
        </button>
      )}
    </article>
  );
}
