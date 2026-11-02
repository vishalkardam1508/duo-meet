export default function WaitingRoomPanel({ requests, error, onDecide }) {
  if (!requests.length && !error) {
    return null;
  }
  return (
    <aside className="waiting-room-panel" aria-label="Waiting room">
      <h2>Waiting room <span>{requests.length}</span></h2>
      {error && <p className="error" role="alert">{error}</p>}
      {requests.length === 0
        ? <p>No one is waiting.</p>
        : requests.map((request) => (
          <div className="waiting-request" key={request.id}>
            <span className="waiting-request-name">{request.name}</span>
            <div className="waiting-request-actions">
              <button className="btn btn-primary" onClick={() => onDecide(request.id, true)}>Admit</button>
              <button className="btn" onClick={() => onDecide(request.id, false)}>Deny</button>
            </div>
          </div>
        ))}
    </aside>
  );
}
