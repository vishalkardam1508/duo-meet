import { useState } from "react";
import ChatPanel from "./ChatPanel.jsx";
import MeetingControls from "./MeetingControls.jsx";
import ParticipantTile from "./ParticipantTile.jsx";
import RecordingControls from "./RecordingControls.jsx";
import WaitingRoomPanel from "./WaitingRoomPanel.jsx";
import useLiveKitMeeting from "../hooks/useLiveKitMeeting.js";
import useRecording from "../hooks/useRecording.js";

export default function LiveKitMeetingRoom({ code, access, localStream, hostKey, onEnded }) {
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const meeting = useLiveKitMeeting({
    access,
    localStream,
    hostKey,
    onEnded,
  });
  const recording = useRecording({ code, participants: meeting.participants });

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

  const handleRecording = async () => {
    if (await recording.start()) {
      meeting.publishRecordingState(true);
    }
  };

  const stopRecording = () => {
    meeting.publishRecordingState(false);
    recording.stop();
  };

  const leaveMeeting = async () => {
    if (meeting.isHost) {
      const nextHost = meeting.participants.find((participant) => !participant.local);
      if (nextHost) {
        const transferred = await meeting.transferHost(nextHost.identity);
        if (!transferred && !window.confirm("Host transfer failed. Leave the meeting without transferring host controls?")) {
          return;
        }
      }
    }
    if (recording.recording || recording.starting) {
      stopRecording();
    }
    onEnded(
      "You left the meeting",
      "Rejoin with the same link while the other person is still there.",
      true,
    );
  };

  return (
    <section className="room" aria-label="Meeting">
      <div className="topbar">
        <span className="room-code">{code}</span>
        <span className="participant-count" aria-live="polite">
          {meeting.participants.length} {meeting.participants.length === 1 ? "participant" : "participants"}
        </span>
        <button className="link-btn" onClick={copyLink}>{copyLabel}</button>
        {meeting.isHost && (
          <RecordingControls
            canRecord={meeting.participants.length > 1}
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
        <div className={`participant-grid participants-${Math.min(meeting.participants.length, 25)}`}>
          {meeting.participants.map((participant) => (
            <ParticipantTile
              participant={participant}
              canTransferHost={meeting.isHost && !participant.local}
              onTransferHost={(identity, name) => {
                if (window.confirm(`Transfer host controls to ${name}?`)) {
                  meeting.transferHost(identity);
                }
              }}
              key={participant.identity}
            />
          ))}
          {meeting.participants.length === 0 && (
            <div className="group-call-status">
              <h2>{meeting.status}</h2>
              <p>Waiting for meeting participants…</p>
            </div>
          )}
        </div>

        <ChatPanel
          open={meeting.chatOpen}
          enabled={meeting.status === "Connected"}
          messages={meeting.messages}
          onClose={meeting.toggleChat}
          onSend={meeting.sendChat}
        />
      </div>

      {meeting.isHost && (
        <WaitingRoomPanel
          requests={meeting.waitingRequests}
          error={meeting.admissionError}
          onDecide={meeting.decideAdmission}
        />
      )}

      <MeetingControls
        micOn={meeting.micOn}
        camOn={meeting.camOn}
        hasVideo={Boolean(localStream.getVideoTracks().length)}
        unread={meeting.unread}
        onToggleMic={meeting.toggleMic}
        onToggleCam={meeting.toggleCam}
        onChat={meeting.toggleChat}
        onLeave={leaveMeeting}
      />
    </section>
  );
}
