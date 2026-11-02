import { useEffect, useState } from "react";
import { endReportCall, getReportCallStatus, startReportCall } from "../lib/api.js";

export default function CallsPage() {
  const [report, setReport] = useState("");
  const [callConsent, setCallConsent] = useState(false);
  const [callId, setCallId] = useState("");
  const [callStatus, setCallStatus] = useState(null);
  const [callError, setCallError] = useState("");
  const [startingCall, setStartingCall] = useState(false);
  const [endingCall, setEndingCall] = useState(false);

  useEffect(() => {
    if (!callId) return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const status = await getReportCallStatus(callId);
        if (!active) return;
        setCallStatus(status);
        if (status.status === "completed" || status.status === "failed") clearInterval(timer);
      } catch (err) {
        if (active) { setCallError(err.message || "Couldn't check call status."); clearInterval(timer); }
      }
    };
    poll();
    timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [callId]);

  const startPhoneCall = async (e) => {
    e.preventDefault();
    setCallError("");
    setStartingCall(true);
    try {
      const call = await startReportCall(report);
      setCallId(call.id);
      setCallStatus(call);
      setCallConsent(false);
    } catch (err) {
      setCallError(err.message || "Couldn't start the phone call.");
    } finally {
      setStartingCall(false);
    }
  };

  const hangUp = async () => {
    if (!callId) return;
    setEndingCall(true);
    setCallError("");
    try {
      const status = await endReportCall(callId);
      setCallStatus(status);
    } catch (err) {
      setCallError(err.message || "Couldn't end the phone call.");
    } finally {
      setEndingCall(false);
    }
  };

  const callActive = callStatus && !["completed", "failed"].includes(callStatus.status);

  return (
    <main className="calls-page">
      <div className="calls-inner">
        <div className="calls-hero">
          <p className="calls-eyebrow">OUTBOUND PHONE CALL</p>
          <h1>Read a report aloud</h1>
          <p className="calls-lede">
            Paste your report and Duo will call the privately configured phone number and read it aloud using a voice agent.
          </p>
        </div>

        <div className="calls-card" aria-labelledby="calls-title">
          <div className="calls-card-header">
            <span className="calls-card-icon">☎</span>
            <div>
              <p className="calls-card-eyebrow">REPORT CALL</p>
              <h2 id="calls-title">Start a call</h2>
            </div>
          </div>

          <form className="calls-form" onSubmit={startPhoneCall}>
            <label className="calls-label" htmlFor="report-text">Report text</label>
            <textarea
              id="report-text"
              className="calls-textarea"
              value={report}
              onChange={(e) => setReport(e.target.value)}
              maxLength={5000}
              placeholder="Paste the report you want read aloud…"
              disabled={Boolean(callActive) || startingCall}
              required
            />
            <span className="calls-count">{report.length}/5000</span>

            <label className="calls-consent">
              <input
                type="checkbox"
                checked={callConsent}
                onChange={(e) => setCallConsent(e.target.checked)}
                disabled={Boolean(callActive) || startingCall}
              />
              <span>I'm authorized to call the configured phone number.</span>
            </label>

            {callStatus && (
              <p className={`calls-status calls-status-${callStatus.status}`} role="status" aria-live="polite">
                <span className="calls-status-dot" />
                {callStatus.message || callStatus.status}
              </p>
            )}
            {callError && <p className="error" role="alert">{callError}</p>}

            {callActive ? (
              <button className="btn calls-hangup" type="button" onClick={hangUp} disabled={endingCall}>
                {endingCall ? "Ending call…" : "End call"}
              </button>
            ) : (
              <button
                className="btn btn-primary calls-submit"
                type="submit"
                disabled={startingCall || !report.trim() || !callConsent}
              >
                {startingCall ? "Starting call…" : "Call and read report"}
              </button>
            )}
          </form>

          <p className="calls-disclaimer">
            Requires a configured LiveKit SIP trunk and report-reading voice agent. Report text is sent to LiveKit to generate speech. Carrier and voice usage may cost extra.
          </p>
        </div>
      </div>
    </main>
  );
}
