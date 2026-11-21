# SyncPlayer: watch videos together

A Chrome extension and a small WebSocket server that keep video playback in sync between friends on **any website with an HTML5 `<video>`**, including videos embedded in iframes. Create a room, share its three-digit code, right-click a video and choose **⚡ Синхронізувати це відео** (*Sync this video*). From then on, play, pause and seek are mirrored for everyone in the room.

The extension is built on Manifest V3. The server runs on Node.js with `ws`.

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
 Tab (content.js)              Extension (service_worker.js)          Server (index.js)
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
| `videoSyncServer/index.js` | WebSocket server: rooms, permissions, state, broadcasting |
| `videoSyncServer/db`, `sql/`, `init-db.*` | PostgreSQL persistence layer (see the status note below) |

## Running locally

**1. Start the server** (Node.js 18 or newer):

```bash
cd videoSyncServer
npm install
npm start            # ws://localhost:3000
```

**2. Load the extension:**
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `videoSyncExtention` folder.

**3. Try it.** Open the popup and create a room. In a second browser profile, join it with the code. Then right-click a video in each profile and choose **⚡ Синхронізувати це відео**.

The server address is set by `WS_URL` in `service_worker.js`. To sync across machines, deploy the server and point `WS_URL` at it, using `wss://` behind TLS.

## Status and roadmap

- Rooms are currently kept **in memory**.
- A PostgreSQL layer is prepared but not yet wired into the WebSocket server. It includes the schema (`rooms`, `users`, `room_settings`), a connection pool, a repository with transactional room creation, and init scripts for Linux, macOS and Windows. Setup instructions are in [videoSyncServer/DATABASE_SETUP.md](videoSyncServer/DATABASE_SETUP.md).
- The extension UI is in Ukrainian.

Planned:
- persist rooms in PostgreSQL;
- configure the server URL from the popup;
- compensate for network latency using the state timestamp;
- localize the UI to English.

## Tech stack

JavaScript · Chrome Extensions Manifest V3 (service worker, content scripts, `chrome.storage`, context menus) · Node.js · WebSocket (`ws`) · PostgreSQL (`pg`)
