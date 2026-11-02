<div align="center">

# 🎥 Duo Meet

**Free group video meetings: create a link, share it, talk face to face.**

Up to 25 participants · host waiting room · in-call chat · local recording

![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![LiveKit](https://img.shields.io/badge/LiveKit-WebRTC-FF6B35)
![License](https://img.shields.io/badge/License-MIT-yellow)

<a href="https://buymeacoffee.com/vishalkardam" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50">
</a>

</div>

---

## ✨ Features

- **Instant meetings:** create a meeting and share a link like `/m/abc-defg-hij`.
- **Host waiting room:** the host admits or denies each guest before they join.
- **Up to 25 participants**, including the host.
- **Smart media routing:** two-person calls go directly between browsers (WebRTC);
  when a third person is admitted, everyone moves to the LiveKit SFU automatically.
- **In-call chat:** message everyone in the meeting.
- **Consent-based recording:** recording starts only after every other participant
  approves. The participant grid and audio are saved as a local WebM file and are
  never uploaded to the server.
- **Host transfer:** hand host controls to another participant.
- **Tuned audio:** echo cancellation, noise suppression and auto gain are on.

## 🛠 Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6 |
| Backend | Node.js, Express, WebSocket (`ws`) |
| Media | WebRTC (1:1), LiveKit Cloud SFU (groups) |
| Hosting | Render (full app) or Vercel (frontend) + Render (backend) |

## 🚀 Getting started

### Prerequisites

- Node.js 18 or newer
- A free [LiveKit Cloud](https://livekit.io) project (needed for group calls)

### Run locally

```bash
git clone https://github.com/vishalkardam1508/duo-meet.git
cd duo-meet
npm install
```

Copy `backend/.env.example` to `backend/.env` and fill in your LiveKit values:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

Start the app (builds the frontend, then starts the server):

```bash
npm run dev
```

Open **http://localhost:3000**. After changing frontend code, re-run `npm run dev` and refresh.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build the frontend and start the server |
| `npm run build` | Build the frontend into `frontend/dist` |
| `npm start` | Start the server (serves the built frontend) |
| `npm test` | Run backend signaling and admission tests |

## 📼 Recording a meeting

1. Wait until at least one other participant is connected.
2. Click **Request to record**. Everyone else must approve.
3. Click **Start recording**. All participants see a recording notice.
4. Click **Stop & download** to save the WebM file on your computer.

## ☁️ Deployment

### Option A: Render Blueprint (auto-deploy)

The repo includes a [`render.yaml`](render.yaml).

1. Push the repo to GitHub.
2. On Render, choose **New → Blueprint** and select the repo.
3. Enter `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` when prompted.
4. Click **Apply**. Every push to `main` now redeploys automatically.

### Option B: Render Web Service (manual)

1. On Render, choose **New → Web Service** and select the repo.
2. Runtime **Node**, Build command `npm install && npm run build`,
   Start command `npm start`, Plan **Free**.
3. Add the three LiveKit environment variables.
4. Deploy. Your app is live at `https://<name>.onrender.com`.

Render provides HTTPS automatically. The server pings its own `/api/status` every
10 minutes so the free instance doesn't sleep. For extra safety, add an
UptimeRobot or cron-job.org monitor on `https://<name>.onrender.com/api/status`.

### Option C: Frontend on Vercel + backend on Render

1. Deploy the backend to Render as above and note its URL.
2. Import the same repo into **Vercel** (`vercel.json` handles the build and routes).
3. In Vercel, add `VITE_SERVER_URL=https://<your-render-app>.onrender.com`.
4. In Render, set `ALLOWED_ORIGINS` and `PUBLIC_APP_URL` to your Vercel URL.

## ⚙️ Environment variables

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | LiveKit WebSocket URL, e.g. `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Server-side LiveKit credentials. Keep these secret. |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API (empty = any) |
| `PUBLIC_APP_URL` | Base URL used in meeting links (your Vercel URL when split) |
| `KEEPALIVE_URL` | Self-ping URL when not hosted on Render |
| `VITE_SERVER_URL` | Backend URL for the frontend build when deployed separately |

<details>
<summary><b>Optional: outbound report calls</b></summary>

The landing page can call a privately configured phone number and read a pasted
report aloud. This needs a LiveKit outbound SIP trunk and a separately running
report-reading agent with the same LiveKit credentials.

| Variable | Purpose |
|---|---|
| `REPORT_CALL_ENABLED` | Must be `true` to enable calls (off by default) |
| `LIVEKIT_SIP_TRUNK_ID` | LiveKit outbound SIP trunk ID |
| `REPORT_CALL_TO` / `REPORT_CALLER_ID` | Destination and caller ID in E.164 format, e.g. `+15551234567` |
| `LIVEKIT_REPORT_AGENT_NAME` | Registered agent name (must match the worker) |
| `REPORT_TTS_MODEL` | Text-to-speech model (default `deepgram/aura-2`) |

LiveKit does not provide a phone line, so you need a SIP carrier. Carrier and
text-to-speech usage may cost extra. Avoid sending sensitive reports.

</details>

## 🔌 API

| Route | Description |
|---|---|
| `POST /api/meetings` | Create a meeting and host key (20/min per IP) |
| `POST /api/meetings/:code/host-token` | Get the host's signed meeting token |
| `POST /api/meetings/:code/join-requests` | Ask the host to be admitted |
| `GET /api/meetings/:code/join-requests` | List join requests (host key required) |
| `POST /api/meetings/:code/join-requests/:id/decision` | Admit or deny a guest (host key required) |
| `GET /api/meetings/:code/join-requests/:id` | Check request status and get the participant token |
| `POST /api/meetings/:code/host-transfer` | Transfer host control |
| `GET /m/:code` | Meeting page |
| `GET /api/status` | Health check and keep-alive |

## 📁 Project structure

```text
frontend/
  src/
    components/   React pages and UI
    hooks/        WebRTC, LiveKit and recording logic
    lib/          API and meeting helpers
    App.jsx       Routing and media state
    main.jsx      Entry point
backend/
  src/
    agents/       Report-reading voice agent
    calls/        Outbound phone calls
    meetings/     Meeting state
    routes/       HTTP API routes
    app.js        Express app
    config.js     Configuration
  server.js       Server entry point
  test/           Backend tests
render.yaml       Render Blueprint (auto-deploy)
vercel.json       Vercel config
```

## ⚠️ Limitations

- Meetings, admission requests and chat live in memory, so a server restart clears
  them, and scaling to multiple instances needs shared storage.
- Chat isn't saved after the meeting.
- LiveKit Cloud has free-tier usage limits; heavy group usage may be billed.
- Group calls need valid LiveKit credentials.

## 👨‍💻 Creator

**Vishal Kardam**, creator and developer of Duo Meet.

- GitHub: [@vishalkardam1508](https://github.com/vishalkardam1508)

If Duo Meet helps you, consider supporting the project:

<a href="https://buymeacoffee.com/vishalkardam" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50">
</a>

## 📄 License

[MIT](https://opensource.org/licenses/MIT) © Vishal Kardam
