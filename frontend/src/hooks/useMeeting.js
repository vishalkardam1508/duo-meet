import { useCallback, useEffect, useRef, useState } from "react";
import { FALLBACK_ICE_SERVERS, getWebSocketUrl } from "../lib/api.js";
import { tuneOpus } from "../lib/meeting.js";

export default function useMeeting({
  code,
  access,
  localStream,
  iceServers,
  media,
  onEnded,
  onPromote,
  onHostKeyChange,
}) {
  const [status, setStatus] = useState("Joining…");
  const [waiting, setWaiting] = useState("Waiting for someone to join");
  const [remoteStream, setRemoteStream] = useState(null);
  const [remotePresent, setRemotePresent] = useState(false);
  const [remoteName, setRemoteName] = useState("Participant");
  const [remoteIdentity, setRemoteIdentity] = useState("");
  const [remoteCameraOn, setRemoteCameraOn] = useState(true);
  const [remoteMicOn, setRemoteMicOn] = useState(true);
  const [remoteHost, setRemoteHost] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [recordingConsent, setRecordingConsent] = useState("idle");
  const [incomingRecordingRequest, setIncomingRecordingRequest] = useState(null);
  const [remoteRecording, setRemoteRecording] = useState(false);

  const mediaRef = useRef(media);
  const onEndedRef = useRef(onEnded);
  const onPromoteRef = useRef(onPromote);
  const onHostKeyChangeRef = useRef(onHostKeyChange);
  const remoteNameRef = useRef(remoteName);
  const chatOpenRef = useRef(chatOpen);
  const dataChannelRef = useRef(null);
  const recordingRequestIdRef = useRef(null);
  const recordingRequestTimeoutRef = useRef(null);
  const incomingRecordingRequestRef = useRef(null);
  mediaRef.current = media;
  onEndedRef.current = onEnded;
  onPromoteRef.current = onPromote;
  onHostKeyChangeRef.current = onHostKeyChange;
  chatOpenRef.current = chatOpen;
  remoteNameRef.current = remoteName;
  incomingRecordingRequestRef.current = incomingRecordingRequest;

  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      if (!open) {
        setUnread(0);
      }
      return !open;
    });
  }, []);

  const addMessage = useCallback((kind, text) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), kind, text }]);
  }, []);

  useEffect(() => {
    if (!localStream) {
      return undefined;
    }

    let active = true;
    let socket;
    let peerConnection = null;
    let dataChannel = null;
    let isOfferer = false;
    let retryCount = 0;
    let restartCount = 0;
    let tuned = false;
    let reconnectTimer;
    let disconnectTimer;
    let pendingCandidates = [];
    let promoting = false;

    const send = (message) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const sendState = () => {
      const currentMedia = mediaRef.current;
      if (dataChannel?.readyState === "open") {
        dataChannel.send(JSON.stringify({
          type: "state",
          mic: currentMedia.micOn,
          cam: currentMedia.camOn,
        }));
      }
    };

    const setupDataChannel = (channel) => {
      dataChannel = channel;
      dataChannelRef.current = channel;
      channel.onopen = () => {
        setChatEnabled(true);
        sendState();
      };
      channel.onclose = () => setChatEnabled(false);
      channel.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "chat" && typeof message.text === "string") {
          setMessages((current) => [...current, {
            id: crypto.randomUUID(),
            kind: "them",
            name: remoteNameRef.current,
            text: message.text.slice(0, 2000),
          }]);
          if (!chatOpenRef.current) {
            setUnread((count) => count + 1);
          }
        } else if (message.type === "state") {
          setRemoteCameraOn(message.cam !== false);
          setRemoteMicOn(message.mic !== false);
        } else if (message.type === "recording-request" && typeof message.id === "string") {
          setIncomingRecordingRequest({ id: message.id, name: remoteNameRef.current });
        } else if (
          message.type === "recording-response" &&
          message.id === recordingRequestIdRef.current
        ) {
          clearTimeout(recordingRequestTimeoutRef.current);
          recordingRequestIdRef.current = null;
          setRecordingConsent(message.accepted ? "approved" : "denied");
        } else if (message.type === "recording-state") {
          setRemoteRecording(message.active === true);
        } else if (message.type === "host-transfer" && message.identity === access.identity) {
          window.sessionStorage.setItem(`duo-host:${code}`, message.hostKey);
          onHostKeyChangeRef.current?.(message.hostKey);
          setRemoteHost(false);
        } else if (message.type === "host-transferred" && message.identity === access.identity) {
          window.sessionStorage.removeItem(`duo-host:${code}`);
          onHostKeyChangeRef.current?.("");
          setRemoteHost(true);
        }
      };
    };

    const closePeer = () => {
      clearTimeout(disconnectTimer);
      if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
        dataChannelRef.current = null;
      }
      if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.ondatachannel = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
        peerConnection = null;
      }
      isOfferer = false;
      pendingCandidates = [];
      setRemoteStream(null);
      setRemoteCameraOn(true);
      setRemoteMicOn(true);
      setChatEnabled(false);
      setRecordingConsent("idle");
      setIncomingRecordingRequest(null);
      setRemoteRecording(false);
      clearTimeout(recordingRequestTimeoutRef.current);
      recordingRequestIdRef.current = null;
    };

    const setLocalDescription = async (description) => {
      try {
        await peerConnection.setLocalDescription({
          type: description.type,
          sdp: tuneOpus(description.sdp),
        });
      } catch {
        await peerConnection.setLocalDescription(description);
      }
    };

    const makeOffer = async (options) => {
      if (!peerConnection) {
        return;
      }
      const offer = await peerConnection.createOffer(options);
      await setLocalDescription(offer);
      send({
        type: "signal",
        data: {
          description: {
            type: peerConnection.localDescription.type,
            sdp: peerConnection.localDescription.sdp,
          },
        },
      });
    };

    const flushCandidates = async () => {
      const candidates = pendingCandidates;
      pendingCandidates = [];
      for (const candidate of candidates) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (error) {
          console.warn("ICE candidate", error);
        }
      }
    };

    const tuneSenders = async () => {
      if (!peerConnection) {
        return;
      }
      for (const sender of peerConnection.getSenders()) {
        if (!sender.track) {
          continue;
        }
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) {
          continue;
        }
        if (sender.track.kind === "audio") {
          parameters.encodings[0].priority = "high";
          parameters.encodings[0].networkPriority = "high";
        } else {
          parameters.encodings[0].maxBitrate = 800000;
          parameters.encodings[0].maxFramerate = 30;
          parameters.degradationPreference = "balanced";
        }
        try {
          await sender.setParameters(parameters);
        } catch (error) {
          console.warn("setParameters", error);
        }
      }
    };

    const restartIce = () => {
      restartCount += 1;
      if (restartCount > 2) {
        setStatus("Can’t reach the other person. Your network may need a TURN relay.");
        setWaiting("Couldn’t connect. One of you may be on a network that blocks direct calls.");
        return;
      }
      setStatus("Reconnecting…");
      makeOffer({ iceRestart: true }).catch((error) => {
        console.error(error);
        setStatus("Couldn’t restart the call. Check your connection.");
      });
    };

    const createPeer = () => {
      peerConnection = new RTCPeerConnection({
        iceServers: iceServers?.length ? iceServers : FALLBACK_ICE_SERVERS,
      });
      tuned = false;
      restartCount = 0;
      for (const track of localStream.getTracks()) {
        peerConnection.addTrack(track, localStream);
      }
      if (!localStream.getVideoTracks().length) {
        peerConnection.addTransceiver("video", { direction: "recvonly" });
      }
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          send({ type: "signal", data: { candidate: event.candidate.toJSON() } });
        }
      };
      peerConnection.ontrack = (event) => {
        setRemoteStream(event.streams[0]
          ? new MediaStream(event.streams[0].getTracks())
          : new MediaStream([event.track]));
      };
      peerConnection.ondatachannel = (event) => setupDataChannel(event.channel);
      peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) {
          return;
        }
        const state = peerConnection.connectionState;
        if (state === "connected") {
          clearTimeout(disconnectTimer);
          restartCount = 0;
          setWaiting("");
          setStatus("Connected");
          if (!tuned) {
            tuned = true;
            tuneSenders().catch((error) => console.warn("setParameters", error));
          }
          sendState();
        } else if (state === "disconnected") {
          setStatus("Connection is unstable. Trying to recover…");
          clearTimeout(disconnectTimer);
          disconnectTimer = setTimeout(() => {
            if (peerConnection?.connectionState !== "connected" && isOfferer) {
              restartIce();
            }
          }, 3000);
        } else if (state === "failed") {
          if (isOfferer) {
            restartIce();
          } else {
            setStatus("Couldn’t connect. Retrying…");
          }
        }
      };
    };

    const handleSignal = async (data) => {
      if (!data) {
        return;
      }
      if (data.description?.type === "offer") {
        if (!peerConnection) {
          isOfferer = false;
          createPeer();
        }
        await peerConnection.setRemoteDescription(data.description);
        await flushCandidates();
        const answer = await peerConnection.createAnswer();
        await setLocalDescription(answer);
        send({
          type: "signal",
          data: {
            description: {
              type: peerConnection.localDescription.type,
              sdp: peerConnection.localDescription.sdp,
            },
          },
        });
      } else if (data.description?.type === "answer" && peerConnection) {
        await peerConnection.setRemoteDescription(data.description);
        await flushCandidates();
      } else if (data.candidate) {
        if (!peerConnection || !peerConnection.remoteDescription) {
          pendingCandidates.push(data.candidate);
        } else {
          try {
            await peerConnection.addIceCandidate(data.candidate);
          } catch (error) {
            console.warn("ICE candidate", error);
          }
        }
      }
    };

    const handleServerMessage = async (message) => {
      switch (message.type) {
        case "joined":
          if (message.peers === 0) {
            setRemotePresent(false);
            setRemoteHost(false);
            setWaiting("Waiting for someone to join");
            setStatus("Share the link to invite someone");
          } else {
            setRemotePresent(true);
            setRemoteIdentity(message.peerIdentity || "");
            setRemoteName(message.peerName || "Participant");
            setWaiting("Connecting…");
            setStatus("Connecting…");
          }
          break;
        case "promote":
        case "group":
          setStatus("Moving to the group meeting…");
          promoting = true;
          send({ type: "leave" });
          socket?.close();
          closePeer();
          onPromoteRef.current?.();
          break;
        case "full":
          send({ type: "leave" });
          onEndedRef.current(
            "This meeting is full",
            "It already has two people. Ask for a new link or start your own meeting.",
            false,
          );
          break;
        case "peer-joined":
          setRemotePresent(true);
          setRemoteHost(false);
          setRemoteIdentity(message.identity || "");
          setRemoteName(message.name || "Participant");
          closePeer();
          isOfferer = true;
          createPeer();
          setupDataChannel(peerConnection.createDataChannel("chat"));
          setWaiting("Connecting…");
          setStatus("Connecting…");
          await makeOffer();
          break;
        case "signal":
          await handleSignal(message.data);
          break;
        case "peer-left":
          setRemotePresent(false);
          setRemoteIdentity("");
          setRemoteHost(false);
          setRemoteName("Participant");
          closePeer();
          addMessage("sys", "The other person left");
          setWaiting("The other person left. Waiting for someone to join");
          setStatus("Share the link to invite someone");
          break;
        case "error":
          setStatus(message.message || "Something went wrong.");
          break;
        default:
          break;
      }
    };

    const connect = () => {
      socket = new WebSocket(getWebSocketUrl());
      socket.onopen = () => {
        retryCount = 0;
        send({ type: "join", code, token: access.token });
      };
      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        handleServerMessage(message).catch((error) => {
          console.error(error);
          setStatus("A call error occurred. Check your connection and try again.");
        });
      };
      socket.onerror = () => {
        setStatus("Couldn’t reach the meeting server. Reconnecting…");
      };
      socket.onclose = () => {
        if (!active || promoting) {
          return;
        }
        setRemotePresent(false);
        setRemoteIdentity("");
        closePeer();
        setWaiting("Reconnecting…");
        setStatus("Lost connection to the server. Reconnecting…");
        const delay = Math.min(1000 * 2 ** retryCount++, 10000);
        reconnectTimer = setTimeout(() => {
          if (active) {
            connect();
          }
        }, delay);
      };
    };

    connect();
    return () => {
      active = false;
      clearTimeout(reconnectTimer);
      clearTimeout(disconnectTimer);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave" }));
      }
      socket?.close();
      closePeer();
    };
  }, [access.identity, access.token, addMessage, code, iceServers, localStream]);

  useEffect(() => {
    const channel = chatOpen;
    if (channel) {
      setUnread(0);
    }
  }, [chatOpen]);

  useEffect(() => {
    const channel = dataChannelRef.current;
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify({
        type: "state",
        mic: media.micOn,
        cam: media.camOn,
      }));
    }
  }, [media]);

  const sendPeerMessage = useCallback((message) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") {
      return false;
    }
    channel.send(JSON.stringify(message));
    return true;
  }, []);

  const requestRecording = useCallback(() => {
    if (remoteRecording || recordingConsent === "pending") {
      return false;
    }
    const id = crypto.randomUUID();
    if (!sendPeerMessage({ type: "recording-request", id })) {
      return false;
    }
    recordingRequestIdRef.current = id;
    setRecordingConsent("pending");
    recordingRequestTimeoutRef.current = setTimeout(() => {
      if (recordingRequestIdRef.current === id) {
        recordingRequestIdRef.current = null;
        setRecordingConsent("expired");
      }
    }, 60_000);
    return true;
  }, [recordingConsent, remoteRecording, sendPeerMessage]);

  const respondToRecordingRequest = useCallback((accepted) => {
    const request = incomingRecordingRequestRef.current;
    if (!request) {
      return;
    }
    sendPeerMessage({
      type: "recording-response",
      id: request.id,
      accepted,
    });
    setIncomingRecordingRequest(null);
  }, [sendPeerMessage]);

  const publishRecordingState = useCallback((active) => {
    sendPeerMessage({ type: "recording-state", active });
  }, [sendPeerMessage]);

  const resetRecordingConsent = useCallback(() => {
    clearTimeout(recordingRequestTimeoutRef.current);
    recordingRequestIdRef.current = null;
    setRecordingConsent("idle");
  }, []);

  const sendChat = useCallback((text) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") {
      return false;
    }
    const clean = text.trim().slice(0, 2000);
    if (!clean) {
      return false;
    }
    channel.send(JSON.stringify({ type: "chat", text: clean }));
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      kind: "me",
      name: access.name,
      text: clean,
    }]);
    return true;
  }, [access.name]);

  return {
    status,
    waiting,
    remoteStream,
    remotePresent,
    remoteName,
    remoteIdentity,
    remoteCameraOn,
    remoteMicOn,
    remoteHost,
    chatEnabled,
    chatOpen,
    messages,
    unread,
    recordingConsent,
    incomingRecordingRequest,
    remoteRecording,
    addMessage,
    toggleChat,
    requestRecording,
    respondToRecordingRequest,
    publishRecordingState,
    resetRecordingConsent,
    sendChat,
  };
}
