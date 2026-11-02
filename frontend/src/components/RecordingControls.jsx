function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export default function RecordingControls({
  canRecord,
  recording,
  starting,
  elapsedSeconds,
  error,
  onStart,
  onStop,
}) {
  let label = "Record meeting";
  if (recording) {
    label = `Stop & download (${formatDuration(elapsedSeconds)})`;
  } else if (starting) {
    label = "Preparing recording…";
  }

  const disabled = recording ? false : starting || !canRecord;

  const handleClick = () => {
    if (recording) onStop();
    else onStart();
  };

  return (
    <div className="recording-controls">
      <button
        className={`link-btn recording-button${recording ? " recording-active" : ""}`}
        onClick={handleClick}
        disabled={disabled}
      >
        {recording && <span className="recording-dot" aria-hidden="true" />}
        {label}
      </button>
      {error && <span className="recording-message recording-error" role="alert">{error}</span>}
    </div>
  );
}
