import { useCallback, useEffect, useRef, useState } from "react";

const WIDTH = 1280;
const HEIGHT = 720;

function chooseMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function drawTile(context, video, x, y, width, height, participant) {
  context.fillStyle = "#1b324a";
  context.fillRect(x, y, width, height);

  if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    context.drawImage(
      video,
      x + (width - drawWidth) / 2,
      y + (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else {
    const gradient = context.createRadialGradient(
      x + width / 2, y + height * 0.35, 0,
      x + width / 2, y + height * 0.35, Math.min(width, height) * 0.6,
    );
    gradient.addColorStop(0, `hsl(${participant.hue} 60% 38%)`);
    gradient.addColorStop(1, `hsl(${participant.hue} 50% 18%)`);
    context.fillStyle = gradient;
    context.fillRect(x, y, width, height);
    const size = Math.min(width, height) * 0.28;
    context.fillStyle = `hsl(${participant.hue} 55% 52%)`;
    context.beginPath();
    context.arc(x + width / 2, y + height / 2, size, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.font = `700 ${Math.max(20, size * 0.8)}px Figtree, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(participant.initials, x + width / 2, y + height / 2);
  }

  context.fillStyle = "rgb(15 33 51 / 75%)";
  context.fillRect(x, y + height - 38, width, 38);
  context.fillStyle = "#eaf0f6";
  context.font = "600 16px Figtree, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(participant.name.slice(0, 40), x + 12, y + height - 13);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function hashHue(value) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  }
  return hash;
}

function closeResources(resources) {
  if (!resources || resources.closed) {
    return;
  }
  resources.closed = true;
  cancelAnimationFrame(resources.animationFrame);
  resources.videoElements.forEach((video) => {
    video.pause();
    video.srcObject = null;
  });
  resources.recordingStream?.getTracks().forEach((track) => track.stop());
  resources.audioContext?.close().catch((error) => console.warn("AudioContext close", error));
}

export default function useRecording({ code, participants }) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const resourcesRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const startTokenRef = useRef(0);

  const stop = useCallback(() => {
    startTokenRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    } else if (resourcesRef.current) {
      closeResources(resourcesRef.current);
      resourcesRef.current = null;
      setStarting(false);
      setRecording(false);
    }
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (recording || starting) {
      return false;
    }
    if (participants.length < 2) {
      setError("Wait until another participant is connected before recording.");
      return false;
    }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setError("This browser does not support meeting recording.");
      return false;
    }

    setStarting(true);
    const startToken = ++startTokenRef.current;
    let resources;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Couldn’t prepare the recording canvas.");
      }

      const snapshots = participants.map((participant) => ({
        name: participant.name || "Participant",
        initials: initials(participant.name || ""),
        hue: hashHue(participant.identity),
        cameraTrack: participant.cameraOn ? participant.cameraTrack : null,
        microphoneTrack: participant.microphoneOn ? participant.microphoneTrack : null,
      }));
      const videoElements = snapshots.map(({ cameraTrack }) => {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        if (cameraTrack?.mediaStreamTrack) {
          video.srcObject = new MediaStream([cameraTrack.mediaStreamTrack]);
        }
        return video;
      });
      resources = {
        animationFrame: 0,
        audioContext: null,
        recordingStream: null,
        videoElements,
      };
      resourcesRef.current = resources;
      await Promise.all(videoElements.map((video) => video.srcObject ? video.play() : Promise.resolve()));
      if (startTokenRef.current !== startToken) {
        throw new Error("Recording setup cancelled.");
      }

      const columns = Math.ceil(Math.sqrt(snapshots.length * 16 / 9));
      const rows = Math.ceil(snapshots.length / columns);
      const tileWidth = WIDTH / columns;
      const tileHeight = HEIGHT / rows;
      const draw = () => {
        context.fillStyle = "#0f2133";
        context.fillRect(0, 0, WIDTH, HEIGHT);
        snapshots.forEach((participant, index) => {
          drawTile(
            context,
            videoElements[index],
            (index % columns) * tileWidth,
            Math.floor(index / columns) * tileHeight,
            tileWidth,
            tileHeight,
            participant,
          );
        });
        resources.animationFrame = requestAnimationFrame(draw);
      };
      draw();

      const recordingStream = canvas.captureStream(24);
      resources.recordingStream = recordingStream;
      const audioTracks = snapshots
        .map(({ microphoneTrack }) => microphoneTrack?.mediaStreamTrack)
        .filter((track) => track && track.readyState === "live");
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!audioTracks.length || !AudioContextConstructor) {
        throw new Error("Audio recording is unavailable for this call or browser.");
      }
      const audioContext = new AudioContextConstructor();
      resources.audioContext = audioContext;
      await audioContext.resume();
      if (startTokenRef.current !== startToken) {
        throw new Error("Recording setup cancelled.");
      }
      const output = audioContext.createMediaStreamDestination();
      audioTracks.forEach((track) => {
        audioContext.createMediaStreamSource(new MediaStream([track])).connect(output);
      });
      output.stream.getAudioTracks().forEach((track) => recordingStream.addTrack(track));

      const mimeType = chooseMimeType();
      const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        setError(event.error?.message || "The recording stopped because of an error.");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        if (blob.size) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          link.href = url;
          link.download = `duo-meeting-${code}-${timestamp}.webm`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } else {
          setError("The recording was empty, so no file was downloaded.");
        }
        closeResources(resourcesRef.current);
        resourcesRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        setRecording(false);
        setStarting(false);
      };
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setStarting(false);
      setRecording(true);
      return true;
    } catch (startError) {
      closeResources(resources);
      resourcesRef.current = null;
      if (startTokenRef.current === startToken) {
        setStarting(false);
        if (startError.message !== "Recording setup cancelled.") {
          setError(startError.message || "Couldn’t start recording.");
        }
      }
      return false;
    }
  }, [code, participants, recording, starting]);

  useEffect(() => {
    if (!recording) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (recording && participants.length < 2) {
      stop();
    }
  }, [participants.length, recording, stop]);

  useEffect(() => () => {
    startTokenRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    } else if (!recorder) {
      closeResources(resourcesRef.current);
    }
  }, []);

  return {
    recording,
    starting,
    elapsedSeconds,
    error,
    start,
    stop,
  };
}
