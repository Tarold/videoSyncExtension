# SyncPlayer: watch videos together

A Chrome extension and a small WebSocket server that keep video playback in sync between friends on **any website with an HTML5 `<video>`**, including videos embedded in iframes. Create a room, share its three-digit code, right-click a video and choose **⚡ Синхронізувати це відео** (*Sync this video*). From then on, play, pause and seek are mirrored for everyone in the room.

The extension is built on Manifest V3. The server is a TypeScript service on Node.js 22 (`ws`, Zod, PostgreSQL), tested with Vitest and shipped as a Docker image.

## Features

- **Works on any site.** The content script runs in every frame and attaches to whichever `<video>` you right-click, so no per-site integration is needed.
- **Rooms.** Each room gets a random three-digit code and an emoji name such as 🍿🎬🚀. Anyone with the code can join. A room is deleted when its last member leaves.
- **Roles and permissions.** The room creator is the owner and can switch **democracy mode**:
  - when it is on, anyone can control playback;
  - when it is off, only hosts can.

  When the owner leaves, ownership passes to the next member.
- **Server-authoritative state.** The server stores the current URL, play or pause status and position. A newly attached player asks for this state first and only then starts sending its own events, so late joiners do not reset the room.
- **Shared URL.** If you join a room that is watching a different page, the extension offers to open it.
- **Loop-free sync.** Changes that arrive from the server are applied with a short guard window and are tagged with the user who started them, so a remote play or seek is not echoed back. Seeks are applied only when the drift exceeds 0.5 s.
- **Resilient to MV3 lifecycle.** A keep-alive stops the service worker from being suspended mid-session. The synced tab is remembered, and if it is closed, its stale state is cleared.

## How it works

```text
 Tab (content.js)              Extension (service_worker.js)          Server (videoSyncServer/src)
 ─────────────────             ─────────────────────────────          ─────────────────
 <video> play/pause/seek ──►   update-status ──────────────►  video-update ──► room state
                                                                                │
 apply-status (skip own) ◄──   sync-video ◄──────────────────────── broadcast to others
 popup.js ── create/join/leave/settings ──► WebSocket ──► create-room · join-room ·
                                                         get-state · update-settings
                                            ◄── joined · room-meta-update · error
```

| Path | Responsibility |
| :--- | :--- |
| `videoSyncExtention/manifest.json` | MV3 manifest: context menu, storage, scripting, content script for all frames |
| `videoSyncExtention/service_worker.js` | WebSocket client, room lifecycle, message routing between popup, tabs and server |
| `videoSyncExtention/content.js` | Video attachment, player event capture, applying remote state, toasts |
| `videoSyncExtention/popup.*` | Create or join a room, room info and settings |
| `videoSyncServer/src/protocol.ts` | Zod schemas for incoming messages and types for outgoing ones |
| `videoSyncServer/src/domain/` | Room rules (permissions, ownership transfer, playback updates) and `RoomService`, which owns live rooms |
| `videoSyncServer/src/persistence/` | `RoomStore` interface with PostgreSQL and in-memory implementations |
| `videoSyncServer/src/ws/server.ts` | WebSocket and HTTP layer: validation, per-socket ordering, heartbeat, `GET /health` |
| `videoSyncServer/migrations/` | SQL migrations, applied on startup |

### Server design

- **Split state.** Durable facts (rooms, owners, members and their roles, settings) are stored in PostgreSQL. Sockets and playback state change many times a second and mean nothing after a restart, so they stay in memory.
- **Survives restarts.** On shutdown the server closes sockets without deleting rooms. When a client sends `join-room` for a room that is not live, it is restored from the database with its owner, hosts and settings.
- **Validated input.** Every message is parsed with a Zod discriminated union. Malformed messages get an `error` reply instead of crashing the handler. The protocol is unchanged, so the published extension works as is.
- **No races.** Messages from one socket are processed in order, and operations on one room are serialised with a per-room async mutex. A join can't interleave with the deletion of the same room, and two concurrent creates never get the same code.
- **Reconnect-safe.** If a user reconnects before their old socket closes, the late close does not remove them from the room.
- **Operable.** Configuration comes from the environment and is validated at startup. Logs are structured JSON (pino). `GET /health` checks the database. `SIGTERM` triggers a graceful shutdown. Idle persisted rooms are pruned on startup.

## Running locally

**1. Start the server.** With Docker, this starts PostgreSQL and the server:

```bash
cd videoSyncServer
docker compose up --build        # ws://localhost:3000, health check at http://localhost:3000/health
```

Or run it with Node.js 22:

```bash
cd videoSyncServer
npm install
docker compose up -d postgres --wait   # or point DATABASE_URL at your own PostgreSQL
cp .env.example .env                   # `npm run dev` loads it; production reads real env vars
npm run dev                            # watch mode via tsx; `npm run build && npm start` for production
```

Without `DATABASE_URL` the server still runs, but keeps rooms in memory only.

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Listen address |
| `DATABASE_URL` | unset | PostgreSQL connection string. If unset, rooms are kept in memory |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `MIGRATE_ON_START` | `true` | Apply pending migrations at startup (`npm run migrate` does it on demand) |
| `ROOM_IDLE_TTL_HOURS` | `24` | Persisted rooms idle for longer than this are pruned at startup |
| `LOG_LEVEL` | `info` | pino log level |

**2. Load the extension:**
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `videoSyncExtention` folder.

**3. Try it.** Open the popup and create a room. In a second browser profile, join it with the code. Then right-click a video in each profile and choose **⚡ Синхронізувати це відео**.

The extension connects to `WS_URL` in `service_worker.js` (`ws://localhost:3000`). To sync across machines, deploy the server, for example with the Docker image, and point `WS_URL` at it, using `wss://` behind TLS.

## Development

All commands run from `videoSyncServer/`:

```bash
npm run lint              # ESLint (typescript-eslint strict, type-aware) + Prettier
npm run typecheck         # tsc --noEmit, strict mode
npm test                  # unit tests: room rules, RoomService, protocol, config
npm run test:integration  # against real PostgreSQL: migrations, repository, end-to-end WebSocket flows
npm run smoke             # scripted two-client session against a running server (SERVER_URL)
```

Integration tests need `DATABASE_URL`. They drop and recreate the `public` schema, so point them at a throwaway database, such as the one from `docker compose up -d postgres`.

GitHub Actions ([`.github/workflows/server.yml`](.github/workflows/server.yml)) runs lint, typecheck, unit and integration tests against a PostgreSQL service container, then builds the Docker image, starts the compose stack and runs the smoke client against it.

## Status and roadmap

Done:
- server ported from a single JavaScript file to strict TypeScript, with an unchanged wire protocol;
- rooms, members, roles and settings persisted in PostgreSQL with versioned migrations. Migration 002 aligns the old schema defaults (`democracy FALSE`, `auto_sync_url TRUE`) with the runtime defaults (democracy on, URL auto-sync off);
- unit and integration tests, a Docker image, docker compose and CI.

Planned:
- configure the server URL from the popup instead of `WS_URL`;
- compensate for network latency using the state timestamp;
- localize the extension UI (currently Ukrainian) to English.

## Tech stack

**Server:** TypeScript (strict) · Node.js 22 · WebSocket (`ws`) · Zod · PostgreSQL (`pg`) · pino · Vitest · ESLint · Docker · GitHub Actions

**Extension:** JavaScript · Chrome Extensions Manifest V3 (service worker, content scripts, `chrome.storage`, context menus)
