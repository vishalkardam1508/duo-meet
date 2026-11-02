import { useState } from "react";
import { createMeeting } from "../lib/api.js";
import { parseMeetingCode } from "../lib/meeting.js";

export default function HomePage() {
  const [input, setInput] = useState("");
  const [meetingError, setMeetingError] = useState("");
  const [creating, setCreating] = useState(false);

  const startMeeting = async () => {
    setCreating(true);
    setMeetingError("");
    try {
      const meeting = await createMeeting();
      window.sessionStorage.setItem(`duo-host:${meeting.code}`, meeting.hostKey);
      window.location.assign(`/m/${meeting.code}`);
    } catch (err) {
      setMeetingError(
        err.message && err.message !== "Request failed" && err.message !== "Failed to fetch"
          ? err.message
          : "Couldn't create a meeting. Check your connection and try again.",
      );
      setCreating(false);
    }
  };

  const joinMeeting = (e) => {
    e.preventDefault();
    const code = parseMeetingCode(input);
    if (!code) {
      setMeetingError("Enter a code like abc-defg-hij, or paste the full link.");
      return;
    }
    window.location.assign(`/m/${code}`);
  };

  return (
    <main className="home">
      <div className="home-inner">
        <div>
          <p className="brand">Duo<span aria-hidden="true" /></p>
          <h1>Video calls, together.</h1>
          <p className="lede">
            Make a link, invite your group, and talk face to face. The host admits people into every meeting.
          </p>
          <div className="actions">
            <button className="btn btn-primary" onClick={startMeeting} disabled={creating}>
              {creating ? "Creating…" : "New meeting"}
            </button>
            <form className="join-form" onSubmit={joinMeeting}>
              <input
                autoComplete="off"
                aria-label="Meeting code or link"
                placeholder="Enter a code or link"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn" type="submit">Join</button>
            </form>
          </div>
          {meetingError && <p className="error" role="alert">{meetingError}</p>}
          <p className="fine">Needs a recent browser that can use your camera and microphone.</p>
        </div>
        <div className="home-tools">
          <div className="duo-art" aria-hidden="true">
            <div className="frame one"><div className="face" /></div>
            <div className="frame two"><div className="face" /></div>
          </div>
        </div>
      </div>
    </main>
  );
}
