import { useEffect, useMemo, useState } from "react";
import ChatPanel from "./ChatPanel.jsx";
import MeetingControls from "./MeetingControls.jsx";
import ParticipantTile from "./ParticipantTile.jsx";
import RecordingControls from "./RecordingControls.jsx";
import WaitingRoomPanel from "./WaitingRoomPanel.jsx";
import useMeeting from "../hooks/useMeeting.js";
import useRecording from "../hooks/useRecording.js";
import { getWaitingRoomRequests, decideJoinRequest, transferMeetingHost } from "../lib/api.js";

function mediaTrack(track) {
  if (!track) return null;
  return {
    mediaStreamTrack: track,
    attach(element) { element.srcObject = new MediaStream([track]); return element; },
    detach(element) { element.srcObject = null; return element; },
  };
}

export default function DirectMeetingRoom({
  code, access, localStream, hostKey, media, toggleMic, toggleCam, onEnded, onPromote,
}) {
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const [activeHostKey, setActiveHostKey] = useState(hostKey || "");
  const [waitingRequests, setWaitingRequests] = useState([]);
  const [admissionError, setAdmissionError] = useState("");
  const meeting = useMeeting({
    code, access, localStream, iceServers: access.iceServers,
    media, onEnded, onPromote, onHostKeyChange: setActiveHostKey,
  });

  const localCamera = useMemo(() => mediaTrack(localStream.getVideoTracks()[0]), [localStream]);
  const localMicrophone = useMemo(() => mediaTrack(localStream.getAudioTracks()[0]), [localStream]);
  const remoteCamera = useMemo(() => mediaTrack(meeting.remoteStream?.getVideoTracks()[0]), [meeting.remoteStream]);
  const remoteMicrophone = useMemo(() => mediaTrack(meeting.remoteStream?.getAudioTracks()[0]), [meeting.remoteStream]);
  const isHost = Boolean(activeHostKey);

  const participants = useMemo(() => {
    const list = [{
      identity: access.identity, name: access.name, host: isHost, local: true,
      cameraTrack: localCamera, microphoneTrack: localMicrophone,
      cameraOn: media.camOn && Boolean(localCamera),
      microphoneOn: media.micOn && Boolean(localMicrophone),
      speaking: false,
    }];
    if (meeting.remotePresent) {
      list.push({
        identity: meeting.remoteIdentity, name: meeting.remoteName,
        host: meeting.remoteHost, local: false,
        cameraTrack: remoteCamera, microphoneTrack: remoteMicrophone,
        cameraOn: meeting.remoteCameraOn && Boolean(remoteCamera),
        microphoneOn: meeting.remoteMicOn, speaking: false,
      });
    }
    return list;
  }, [
    access.identity, access.name, code, isHost, localCamera, localMicrophone,
    media.camOn, media.micOn, meeting.remoteCameraOn, meeting.remoteMicOn,
    meeting.remoteName, meeting.remoteHost, meeting.remoteIdentity,
    meeting.remotePresent, remoteCamera, remoteMicrophone,
  ]);

  const recording = useRecording({ code, participants });

  useEffect(() => {
    if (!activeHostKey) { setWaitingRequests([]); return undefined; }
    let active = true;
    const load = async () => {
      try {
        const result = await getWaitingRoomRequests(code, activeHostKey);
        if (active) { setWaitingRequests(result.requests); setAdmissionError(""); }
      } catch (error) { if (active) setAdmissionError(error.message); }
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeHostKey, code]);

  const copyLink = async () => {
    const url = `${window.location.origin}/m/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyLabel("Link copied");
      window.setTimeout(() => setCopyLabel("Copy link"), 2000);
    } catch { window.prompt("Copy this link:", url); }
  };

  const handleRecording = async () => {
    if (await recording.start()) {
      meeting.publishRecordingState(true);
    }
  };

  const stopRecording = () => {
    meeting.publishRecordingState(false);
    recording.stop();
  };

  const transferHost = async (identity, name) => {
    if (!activeHostKey || !meeting.chatEnabled) {
      setAdmissionError("Wait until the other person is connected before transferring host controls.");
      return false;
    }
    try {
      const result = await transferMeetingHost(code, activeHostKey, identity);
      if (!meeting.sendPeerMessage({ type: "host-transfer", identity, hostKey: result.hostKey })) {
        const rollback = await transferMeetingHost(code, result.hostKey, access.identity);
        window.sessionStorage.setItem(`duo-host:${code}`, rollback.hostKey);
        setActiveHostKey(rollback.hostKey);
        setAdmissionError("Host transfer could not reach the participant; host controls were restored to you.");
        return false;
      }
      meeting.sendPeerMessage({ type: "host-transferred", identity: access.identity });
      window.sessionStorage.removeItem(`duo-host:${code}`);
      setActiveHostKey("");
      setAdmissionError("");
      return true;
    } catch (error) { setAdmissionError(error.message); return false; }
  };

  const leaveMeeting = async () => {
    if (isHost && meeting.remotePresent) {
      const transferred = await transferHost(meeting.remoteIdentity, meeting.remoteName);
      if (!transferred && !window.confirm("Host transfer failed. Leave without transferring host controls?")) return;
    }
    if (recording.recording || recording.starting) stopRecording();
    onEnded("You left the meeting", "Rejoin with the same link while the other person is still there.", true);
  };

  const decideAdmission = async (requestId, admit) => {
    if (!activeHostKey) return;
    try {
      await decideJoinRequest(code, requestId, activeHostKey, admit);
      setWaitingRequests((current) => current.filter((r) => r.id !== requestId));
      setAdmissionError("");
    } catch (error) { setAdmissionError(error.message); }
  };

  return (
    <section className="room" aria-label="Meeting">
      <div className="topbar">
        <span className="room-code">{code}</span>
        <span className="participant-count" aria-live="polite">
          {participants.length} {participants.length === 1 ? "participant" : "participants"}
        </span>
        <button className="link-btn" onClick={copyLink}>{copyLabel}</button>
        {isHost && (
          <RecordingControls
            canRecord={meeting.remotePresent && Boolean(remoteMicrophone)}
            recording={recording.recording}
            starting={recording.starting}
            elapsedSeconds={recording.elapsedSeconds}
            error={recording.error}
            onStart={handleRecording}
            onStop={stopRecording}
          />
        )}
        <span className="status" role="status" aria-live="polite">{meeting.status}</span>
      </div>

      <div className="room-body">
        <div className={`participant-grid direct-participant-grid${meeting.remotePresent ? " direct-has-remote" : ""}`}>
          {participants.map((participant) => (
            <ParticipantTile
              participant={participant}
              canTransferHost={isHost && !participant.local}
              onTransferHost={(identity, name) => {
                if (window.confirm(`Transfer host controls to ${name}?`)) transferHost(identity, name);
              }}
              key={participant.identity}
            />
          ))}
        </div>
        <ChatPanel
          open={meeting.chatOpen}
          enabled={meeting.chatEnabled}
          messages={meeting.messages}
          onClose={meeting.toggleChat}
          onSend={meeting.sendChat}
        />
      </div>

      {isHost && (
        <WaitingRoomPanel
          requests={waitingRequests}
          error={admissionError}
          onDecide={decideAdmission}
        />
      )}

      <MeetingControls
        micOn={media.micOn}
        camOn={media.camOn}
        hasVideo={Boolean(localStream.getVideoTracks().length)}
        unread={meeting.unread}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onChat={meeting.toggleChat}
        onLeave={leaveMeeting}
      />
    </section>
  );
}
