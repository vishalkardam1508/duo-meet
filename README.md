# Duo: group video meetings

Create a meeting, share the link (`/m/abc-defg-hij`), and talk face to face. A host
admits participants from a waiting room. Meetings support up to **25 participants
including the host**, with display names, initials avatars, and group chat. LiveKit
provides group media through its SFU; two-person calls use direct WebRTC to avoid
an unnecessary media-server hop. When a third admitted participant joins, the
signaling server moves everyone into LiveKit. The Node backend issues signed
meeting tokens and controls host admission.

Local meeting recording requests consent from every other connected participant.
After everyone approves, the requester can record the participant grid and audio
and download a WebM file. Recordings are not uploaded or stored by the app server.

To record, wait until at least one other participant is connected, choose **Request to
record**, and have them approve the request. Then choose **Start recording**.
Choose **Stop & download** to save the WebM file locally. All participants see a
recording notice while recording is active.

## Project structure

```text
frontend/
  src/
    components/ React pages and reusable UI
    hooks/      Direct WebRTC, LiveKit room, and recording lifecycle
    lib/        API and meeting helpers
    App.jsx     App-level routing and media state
    main.jsx    React entry point
  index.html    Vite HTML entry
  vite.config.js
backend/
  src/
    agents/     Report-reading LiveKit voice agent
    calls/      Outbound phone-call lifecycle
    meetings/   Meeting room and creation state
    routes/     HTTP API routes
    app.js      Express app and middleware
    config.js   Backend configuration
    iceServers.js
  server.js     Node process entry point
  test/         Backend and admission tests
```

## Run locally

Install dependencies:

```bash
npm install
```

Start the app (builds frontend then starts backend):

```bash
npm run dev
```

Open `http://localhost:3000`. Every time you change frontend code, re-run `npm run dev` and refresh.

Build the frontend and start the backend for production:

```bash
npm run build
npm start
```

## Outbound report calls

The landing page can call a privately configured phone number and read a pasted
report aloud. This requires a LiveKit outbound SIP trunk and a separately running
report-reading agent. Configure the following backend environment variables (use
`backend/.env` locally and deployment secrets in production):

- `REPORT_CALL_ENABLED=true`: explicit opt-in after verifying the destination,
  caller ID, SIP trunk, and worker configuration.
- `LIVEKIT_SIP_TRUNK_ID`: outbound trunk ID from LiveKit.
- `REPORT_CALL_TO` and `REPORT_CALLER_ID`: authorized destination and caller ID
  in international E.164 format (for example, `+15551234567`).
- `LIVEKIT_REPORT_AGENT_NAME`: name under which the report-reading agent is
  registered. It must match the agent worker's name.
- `REPORT_TTS_MODEL`: optional LiveKit Inference TTS model; defaults to
  `deepgram/aura-2`.

The agent worker uses the same LiveKit URL and API credentials. For local
development, `npm run dev:all` starts the worker when all required call settings
are configured. For production, deploy it as a separate worker process with the
same environment variables. The phone call route is intentionally unavailable
until SIP and agent settings are complete. Calls
require a SIP carrier/trunk that can call the configured number; LiveKit does not
provide a free cellular/PSTN line. Carrier and speech synthesis may incur
separate charges. Report text is sent through LiveKit to the voice agent and TTS
service; avoid submitting sensitive information unless permitted.

## Deploy to Render (free)

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service** → pick the repo.
3. Runtime **Node**, Root Directory `.`, Build command `npm install && npm run build`, Start command
   `npm start`, Plan **Free**.
4. Add `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from your LiveKit
   project to Render environment variables.
5. Deploy. Your app is at `https://<name>.onrender.com`.

Render gives HTTPS automatically. The server pings its own `/api/status` every
10 minutes (using Render’s `RENDER_EXTERNAL_URL`), so it doesn’t sleep. For extra
safety, also add a free UptimeRobot or cron-job.org monitor on
`https://<name>.onrender.com/api/status`.

## Website on Vercel + server on Render

Vercel builds the React frontend, while Render hosts the API and admission backend.
Two-person calls use direct WebRTC. When a third admitted person joins, LiveKit
Cloud carries the group media:

1. Deploy this repo to **Render** as above. Note its URL, e.g.
   `https://duo-server.onrender.com`.
2. On **Vercel**, import the same repo from its root directory. `vercel.json`
   configures the Vite build and meeting-link rewrites.
3. In Vercel project settings, add the build environment variable
   `VITE_SERVER_URL=https://duo-server.onrender.com`.
4. On Render, set `ALLOWED_ORIGINS=https://your-app.vercel.app` and
   `PUBLIC_APP_URL=https://your-app.vercel.app`.

## Environment variables

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | LiveKit WebSocket URL, e.g. `wss://your-project.livekit.cloud`. Required for calls. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Server-side LiveKit credentials. Keep secret; never use these as frontend variables. |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to use the API. Empty = any origin. |
| `PUBLIC_APP_URL` | Base URL for meeting links returned by the API (set to your Vercel URL when split). |
| `LIVEKIT_SIP_TRUNK_ID` | LiveKit outbound SIP trunk required for report phone calls. |
| `REPORT_CALL_TO` / `REPORT_CALLER_ID` | Privately configured E.164 phone numbers; no destination is accepted from the browser. |
| `LIVEKIT_REPORT_AGENT_NAME` | Registered LiveKit report-reader agent name. |
| `REPORT_TTS_MODEL` | Optional LiveKit Inference text-to-speech model (default `deepgram/aura-2`). |
| `REPORT_CALL_ENABLED` | Must be `true` to enable outbound calls; defaults to disabled. |
| `KEEPALIVE_URL` | Self-ping URL if not on Render. |
| `VITE_SERVER_URL` | Frontend build-time backend URL when frontend and backend are deployed separately. |

## API

| Route | Description |
|---|---|
| `POST /api/meetings` | Creates a meeting and host key (20 per minute per IP) |
| `POST /api/meetings/:code/host-token` | Creates the host’s signed meeting token for direct and group calls |
| `POST /api/meetings/:code/join-requests` | Requests host admission |
| `GET /api/meetings/:code/join-requests` | Lists requests (host key required) |
| `POST /api/meetings/:code/join-requests/:id/decision` | Admits or denies a guest (host key required) |
| `GET /api/meetings/:code/join-requests/:id` | Checks request status and returns an admitted participant’s token |
| `POST /api/meetings/:code/host-transfer` | Transfers host control to an admitted participant |
| `GET /m/:code` | Meeting page |
| `GET /api/status` | Keep-alive and server status |

## What’s tuned for smooth audio

- Two-person calls send media directly between browsers; the backend only relays
  authenticated signaling.
- Three-or-more-person calls use LiveKit SFU subscriptions with adaptive stream,
  dynacast, and bounded video encoding.
- Browser echo cancellation, noise suppression, and auto gain are on.
- Participant limit is 25, including host and direct-call reservations during a
  transition to group mode.
- Recording combines the participant grid and available audio into a local WebM file.

## Tested

- Backend tests (`npm test`) cover meeting creation, host-only admission,
  authenticated direct signaling, the two-to-group transition, participant tokens,
  and the 25-person limit.
- Real group calls require valid LiveKit credentials and still need end-to-end
  testing against a LiveKit project.

## Limitations

- Meeting host keys, admission requests, and chat are not persisted; the backend
  must use shared storage to scale across multiple instances.
- Outbound call status and rate limits are held in memory; a backend restart loses
  their status records. Calls also have a ten-minute maximum duration.
- LiveKit Cloud has usage quotas and may charge for usage beyond its current free
  allowances. A 25-participant cap is not a guarantee of free 25-person calls.
- Chat works only while participants are connected and isn’t saved.
