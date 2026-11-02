import { useEffect, useRef } from "react";

export default function VideoPlayer({
  stream,
  className,
  muted = false,
  mirrored = false,
  playbackRequest = 0,
  onPlaybackBlocked,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.srcObject = stream || null;
    if (stream) {
      video.play().then(() => onPlaybackBlocked?.(false)).catch(() => onPlaybackBlocked?.(true));
    } else {
      onPlaybackBlocked?.(false);
    }
  }, [onPlaybackBlocked, playbackRequest, stream]);

  return (
    <video
      ref={videoRef}
      className={`${className}${mirrored ? " mirrored" : ""}`}
      autoPlay
      playsInline
      muted={muted}
    />
  );
}
