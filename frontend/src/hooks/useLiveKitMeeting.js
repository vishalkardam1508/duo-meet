import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  decideJoinRequest,
  getWaitingRoomRequests,
  transferMeetingHost,
} from "../lib/api.js";

const CHAT_TOPIC = "duo-chat";
const RECORDING_TOPIC = "duo-recording";

function participantView(participant, local = false) {
  const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
  const microphone = participant.getTrackPublication(Track.Source.Microphone)?.track;
  return {
    identity: participant.identity,
    name: participant.name || "Participant",
    host: participant.attributes?.host === "true",
    local,
    cameraTrack: camera || null,
    microphoneTrack: microphone || null,
    cameraOn: Boolean(camera && !camera.isMuted),
    microphoneOn: Boolean(microphone && !microphone.isMuted),
    speaking: participant.isSpeaking,
  };
}

function decodeMessage(payload) {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}

export default function useLiveKitMeeting({ access, localStream, hostKey, onEnded }) {
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState("Connecting to meeting…");
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [waitingRequests, setWaitingRequests] = useState([]);
  const [admissionError, setAdmissionError] = useState("");
  const [incomingRecordingRequest, setIncomingRecordingRequest] = useState(null);
  const [recordingConsent, setRecordingConsent] = useState("idle");
  const [remoteRecording, setRemoteRecording] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [activeHostKey, setActiveHostKey] = useState(hostKey || "");
  const roomRef = useRef(null);
  const chatOpenRef = useRef(chatOpen);
  const recordingRequestRef = useRef(null);
  const consentResponsesRef = useRef(new Set());
  const expectedConsentRef = useRef(0);
  const requestTimerRef = useRef(null);
  const onEndedRef = useRef(onEnded);

  chatOpenRef.current = chatOpen;
  onEndedRef.current = onEnded;

  const refreshParticipants = useCallback((room) => {
    const list = [
      participantView(room.localParticipant, true),
      ...[...room.remoteParticipants.values()].map((participant) => participantView(participant)),
    ];
    setParticipants(list);
  }, []);

  const publish = useCallback(async (message, topic = RECORDING_TOPIC, destinationIdentities) => {
    const room = roomRef.current;
    if (!room || room.state !== "connected") {
      return false;
    }
    try {
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(message)),
        { reliable: true, topic, destinationIdentities },
      );
      return true;
    } catch (error) {
      console.error("Couldn’t send meeting message", error);
      return false;
    }
  }, []);

  useEffect(() => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        simulcast: true,
        videoCodec: "vp8",
        videoEncoding: { maxBitrate: 800_000, maxFramerate: 24 },
        degradationPreference: "balanced",
      },
    });
    roomRef.current = room;
    let active = true;

    const onChanged = () => refreshParticipants(room);
    const onData = (payload, participant, _kind, topic) => {
      const message = decodeMessage(payload);
      if (!message) {
        return;
      }
      if (message.type === "host-transfer" && message.identity === room.localParticipant.identity) {
        window.sessionStorage.setItem(`duo-host:${access.roomName}`, message.hostKey);
        setActiveHostKey(message.hostKey);
        return;
      }
      if (message.type === "host-transferred" && message.identity === room.localParticipant.identity) {
        window.sessionStorage.removeItem(`duo-host:${access.roomName}`);
        setActiveHostKey("");
      }
      if (participant?.identity === room.localParticipant.identity) {
        return;
      }
      if (topic === CHAT_TOPIC && message.type === "chat" && typeof message.text === "string") {
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          kind: "them",
          name: participant?.name || "Participant",
          text: message.text.slice(0, 2000),
        }]);
        if (!chatOpenRef.current) {
          setUnread((count) => count + 1);
        }
      } else if (topic === RECORDING_TOPIC && message.type === "recording-request") {
        setIncomingRecordingRequest({ id: message.id, name: participant?.name || "Participant" });
      } else if (topic === RECORDING_TOPIC && message.type === "recording-response") {
        if (message.id !== recordingRequestRef.current || !participant) {
          return;
        }
        if (!message.accepted) {
          clearTimeout(requestTimerRef.current);
          recordingRequestRef.current = null;
          setRecordingConsent("denied");
          return;
        }
        consentResponsesRef.current.add(participant.identity);
        if (consentResponsesRef.current.size >= expectedConsentRef.current) {
          clearTimeout(requestTimerRef.current);
          recordingRequestRef.current = null;
          setRecordingConsent("approved");
        }
      } else if (topic === RECORDING_TOPIC && message.type === "recording-state") {
        setRemoteRecording(message.active === true);
      }
    };

    room
      .on(RoomEvent.Connected, () => {
        if (active) {
          setStatus("Connected");
          refreshParticipants(room);
        }
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (active && state === "reconnecting") {
          setStatus("Reconnecting…");
        } else if (active && state === "connected") {
          setStatus("Connected");
        }
      })
      .on(RoomEvent.Disconnected, () => {
        if (active) {
          setStatus("Disconnected");
          onEndedRef.current(
            "Meeting connection ended",
            "The meeting server disconnected you. You can try rejoining.",
            true,
          );
        }
      })
      .on(RoomEvent.ParticipantConnected, onChanged)
      .on(RoomEvent.ParticipantDisconnected, onChanged)
      .on(RoomEvent.TrackSubscribed, onChanged)
      .on(RoomEvent.TrackUnsubscribed, onChanged)
      .on(RoomEvent.TrackPublished, onChanged)
      .on(RoomEvent.TrackUnpublished, onChanged)
      .on(RoomEvent.TrackMuted, onChanged)
      .on(RoomEvent.TrackUnmuted, onChanged)
      .on(RoomEvent.ActiveSpeakersChanged, onChanged)
      .on(RoomEvent.ParticipantAttributesChanged, onChanged)
      .on(RoomEvent.DataReceived, onData);

    const connect = async () => {
      try {
        await room.connect(access.url, access.token, { autoSubscribe: true });
        if (!active) {
          await room.disconnect();
          return;
        }
        await Promise.all(localStream.getTracks().map((track) => (
          room.localParticipant.publishTrack(track, {
            source: track.kind === "video" ? Track.Source.Camera : Track.Source.Microphone,
          })
        )));
        setMicOn(Boolean(localStream.getAudioTracks().length));
        setCamOn(Boolean(localStream.getVideoTracks().length));
        refreshParticipants(room);
      } catch (error) {
        console.error("LiveKit connection failed", error);
        setStatus(error.message || "Couldn’t connect to the group call.");
        onEndedRef.current(
          "Couldn’t join the meeting",
          error.message || "Check the LiveKit server configuration and try again.",
          true,
        );
      }
    };
    connect();

    return () => {
      active = false;
      clearTimeout(requestTimerRef.current);
      if (roomRef.current === room) {
        roomRef.current = null;
      }
      room.removeAllListeners();
      room.disconnect();
    };
  }, [access, localStream, refreshParticipants]);

  useEffect(() => {
    if (!activeHostKey) {
      return undefined;
    }
    let active = true;
    const loadRequests = async () => {
      try {
        const result = await getWaitingRoomRequests(access.roomName || "", activeHostKey);
        if (active) {
          setWaitingRequests(result.requests);
          setAdmissionError("");
        }
      } catch (error) {
        if (active) {
          setAdmissionError(error.message);
        }
      }
    };
    loadRequests();
    const timer = window.setInterval(loadRequests, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [access.roomName, activeHostKey]);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
    refreshParticipants(roomRef.current);
  }, [micOn, refreshParticipants]);

  const toggleCam = useCallback(async () => {
    const next = !camOn;
    await roomRef.current?.localParticipant.setCameraEnabled(next);
    setCamOn(next);
    refreshParticipants(roomRef.current);
  }, [camOn, refreshParticipants]);

  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      if (!open) {
        setUnread(0);
      }
      return !open;
    });
  }, []);

  const sendChat = useCallback(async (text) => {
    const clean = text.trim().slice(0, 2000);
    if (!clean || !await publish({ type: "chat", text: clean }, CHAT_TOPIC)) {
      return false;
    }
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      kind: "me",
      name: access.name,
      text: clean,
    }]);
    return true;
  }, [access.name, publish]);

  const decideAdmission = useCallback(async (requestId, admit) => {
    if (!activeHostKey) {
      return;
    }
    try {
      await decideJoinRequest(access.roomName, requestId, activeHostKey, admit);
      setWaitingRequests((current) => current.filter((request) => request.id !== requestId));
      setAdmissionError("");
    } catch (error) {
      setAdmissionError(error.message);
    }
  }, [access.roomName, activeHostKey]);

  const isHost = participants.some((participant) => participant.local && participant.host) || Boolean(activeHostKey);

  const transferHost = useCallback(async (identity) => {
    if (!activeHostKey || !identity || identity === access.identity) {
      return false;
    }
    try {
      const result = await transferMeetingHost(access.roomName, activeHostKey, identity);
      const delivered = await publish({
        type: "host-transfer",
        identity,
        hostKey: result.hostKey,
      }, "duo-host", [identity]);
      if (!delivered) {
        const rollback = await transferMeetingHost(access.roomName, result.hostKey, access.identity);
        window.sessionStorage.setItem(`duo-host:${access.roomName}`, rollback.hostKey);
        setActiveHostKey(rollback.hostKey);
        setAdmissionError("Host transfer failed to reach the participant; host controls were restored to you.");
        return false;
      }
      await publish({
        type: "host-transferred",
        identity: access.identity,
      }, "duo-host", [access.identity]);
      window.sessionStorage.removeItem(`duo-host:${access.roomName}`);
      setActiveHostKey("");
      setAdmissionError("");
      return true;
    } catch (error) {
      setAdmissionError(error.message);
      return false;
    }
  }, [access.identity, access.roomName, activeHostKey, publish]);

  const requestRecording = useCallback(async () => {
    const remoteCount = Math.max(0, participants.length - 1);
    if (remoteCount === 0) {
      return false;
    }
    const id = crypto.randomUUID();
    recordingRequestRef.current = id;
    consentResponsesRef.current = new Set();
    expectedConsentRef.current = remoteCount;
    setRecordingConsent("pending");
    const sent = await publish({ type: "recording-request", id });
    if (!sent) {
      recordingRequestRef.current = null;
      setRecordingConsent("idle");
      return false;
    }
    requestTimerRef.current = window.setTimeout(() => {
      if (recordingRequestRef.current === id) {
        recordingRequestRef.current = null;
        setRecordingConsent("expired");
      }
    }, 60_000);
    return true;
  }, [participants.length, publish]);

  const respondToRecordingRequest = useCallback(async (accepted) => {
    if (incomingRecordingRequest) {
      await publish({
        type: "recording-response",
        id: incomingRecordingRequest.id,
        accepted,
      });
      setIncomingRecordingRequest(null);
    }
  }, [incomingRecordingRequest, publish]);

  const publishRecordingState = useCallback((active) => {
    publish({ type: "recording-state", active });
  }, [publish]);

  const resetRecordingConsent = useCallback(() => {
    clearTimeout(requestTimerRef.current);
    recordingRequestRef.current = null;
    setRecordingConsent("idle");
  }, []);

  return {
    participants,
    status,
    messages,
    unread,
    chatOpen,
    waitingRequests,
    admissionError,
    incomingRecordingRequest,
    recordingConsent,
    remoteRecording,
    micOn,
    camOn,
    isHost,
    toggleMic,
    toggleCam,
    toggleChat,
    sendChat,
    decideAdmission,
    transferHost,
    requestRecording,
    respondToRecordingRequest,
    publishRecordingState,
    resetRecordingConsent,
  };
}
