import { useEffect, useState } from "react";

const icons = {
  Meetings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 10l4.553-2.277A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14" />
      <rect x="2" y="7" width="13" height="10" rx="2" />
    </svg>
  ),
  "Group Chat": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  Calls: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z" />
    </svg>
  ),
  "Contact Us": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
};

const links = [
  { label: "Meetings",    href: "/" },
  { label: "Group Chat",  href: "/chat" },
  { label: "Calls",       href: "/calls", soon: true },
  { label: "Contact Us",  href: "https://vishalkardam.vercel.app", external: true },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(() => new URLSearchParams(window.location.search).get("toast") === "calls");
  const path = window.location.pathname;
  const close = () => setMenuOpen(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("toast") === "calls") {
      // clean the query param without reload
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setToast(false), 4000);
    }
  }, []);

  const showToast = () => {
    close();
    setToast(true);
    setTimeout(() => setToast(false), 4000);
  };

  return (
    <nav className="navbar" aria-label="Main navigation">
      <div className="navbar-inner">
        <a className="navbar-logo" href="/" aria-label="Duo home">
          <svg className="navbar-logo-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="var(--accent)" />
            <path d="M8 10h6a6 6 0 010 12H8V10z" fill="#fff" />
            <circle cx="22" cy="16" r="3" fill="#fff" opacity=".7" />
          </svg>
          Duo
        </a>

        <button
          className={`navbar-burger${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span /><span /><span />
        </button>

        {menuOpen && <div className="navbar-backdrop" onClick={close} aria-hidden="true" />}

        <ul className={`navbar-links${menuOpen ? " open" : ""}`} role="list">
          {links.map(({ label, href, soon, external }) => {
            const isActive = href !== "#" && path === href;
            const icon = icons[label];
            return (
              <li key={label}>
                {external ? (
                  <a
                    className="navbar-link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={close}
                  >
                    <span className="navbar-link-icon">{icon}</span>
                    {label}
                  </a>
                ) : (
                  <a
                    className={`navbar-link${isActive ? " active" : ""}${soon ? " soon" : ""}`}
                    href={soon ? undefined : href}
                    onClick={soon ? showToast : close}
                    aria-disabled={soon}
                  >
                    <span className="navbar-link-icon">{icon}</span>
                    {label}
                    {soon && <span className="navbar-soon">Soon</span>}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {toast && (
        <div className="navbar-toast" role="alert">
          <span className="navbar-toast-icon">☕</span>
          <div>
            <p className="navbar-toast-title">Our budget ran out!</p>
            <p className="navbar-toast-msg">Please donate or <a href="https://buymeacoffee.com" target="_blank" rel="noopener noreferrer">buy me a coffee</a> to keep calls alive ❤️</p>
          </div>
          <button className="navbar-toast-close" onClick={() => setToast(false)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </nav>
  );
}
