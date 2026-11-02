export default function EndedPage({
  title = "You left the meeting",
  text = "Rejoin with the same link while the other person is still there.",
  canRejoin = true,
}) {
  return (
    <main className="ended">
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="lobby-actions centered">
          {canRejoin && (
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Rejoin
            </button>
          )}
          <a className="btn" href="/">Back to home</a>
        </div>
      </div>
    </main>
  );
}
