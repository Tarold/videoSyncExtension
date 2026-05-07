const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// База даних кімнат (Source of Truth)
const rooms = new Map();

// Список емодзі для назв кімнат
const EMOJIS = ['🍿', '🎬', '🍕', '🚀', '🐱', '🌵', '👻', '👾', '📀', '📺'];

function generateRoomId() {
  let id;
  do {
    id = Math.floor(Math.random() * 900 + 100).toString(); // 100-999
  } while (rooms.has(id));
  return id;
}

function getRandomEmojis() {
  return Array(3)
    .fill()
    .map(() => EMOJIS[Math.floor(Math.random() * EMOJIS.length)])
    .join('');
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentUserId = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error('Invalid JSON received:', message);
      return;
    }

    const { action, userId, roomId, payload } = data;
    currentUserId = userId; // Оновлюємо, якщо прийшов новий userId
    console.log(`Received action: ${action} `);
    switch (action) {
      case 'create-room': {
        const newRoomId = generateRoomId();
        const name = getRandomEmojis();

        rooms.set(newRoomId, {
          id: newRoomId,
          name: name,
          ownerId: userId,
          hosts: [userId],
          settings: { democracy: true, autoSyncUrl: false },
          videoUrl: payload?.url || null,
          playerState: {
            playerStatus: 'INIT',
            second: 0,
            timestamp: Date.now(),
          },
          users: new Map(), // userId -> ws connection
        });
        handleJoinRoom(newRoomId, userId, ws);
        break;
      }

      case 'join-room': {
        handleJoinRoom(roomId, userId, ws);
        break;
      }

      case 'leave-room': {
        handleLeaveRoom(currentRoomId, userId);
        break;
      }

      case 'get-state': {
        const room = rooms.get(roomId);
        if (room) {
          // Відправляємо 'sync-video' ТІЛЬКИ цьому клієнту
          ws.send(
            JSON.stringify({
              action: 'sync-video',
              state: room.playerState,
              videoUrl: room.videoUrl,
              initiatorId: 'server', // ВИКОРИСТОВУЙТЕ "server" АБО ПУСТИЙ РЯДОК
            }),
          );
        }
        break;
      }

      case 'video-update': {
        // Оновлення від клієнта (Play/Pause/Seek/URL Change)
        const room = rooms.get(roomId);
        if (!room) return;

        const isAllowed =
          room.settings.democracy || room.hosts.includes(userId);

        if (isAllowed) {
          if (payload.playerState) {
            room.playerState = payload.playerState;
          }
          if (payload.videoUrl && payload.videoUrl !== room.videoUrl) {
            room.videoUrl = payload.videoUrl;
            // При зміні URL, скидаємо стан
            room.playerState = {
              playerStatus: 'PAUSE',
              second: 0,
              timestamp: Date.now(),
            };
          }

          // Розсилаємо всім, КРІМ відправника
          broadcastToRoom(
            roomId,
            {
              action: 'sync-video',
              state: room.playerState,
              videoUrl: room.videoUrl,
              initiatorId: userId,
            },
            ws,
          );
        }
        break;
      }

      case 'update-settings': {
        // Оновлення налаштувань кімнати (тільки власник)
        const room = rooms.get(roomId);
        if (!room) {
          ws.send(
            JSON.stringify({ action: 'error', message: 'Room not found' }),
          );
          return;
        }

        // Тільки власник може змінювати налаштування
        if (room.ownerId !== userId) {
          ws.send(
            JSON.stringify({
              action: 'error',
              message: 'Only room owner can change settings',
            }),
          );
          return;
        }

        // Оновлюємо налаштування
        if (payload.settings) {
          room.settings = { ...room.settings, ...payload.settings };
        }

        // Розсилаємо оновлені налаштування всім користувачам
        broadcastRoomState(roomId);
        break;
      }
    }
    console.log(`rooms: ${[...rooms.values()].length}`);
  });

  ws.on('close', () => {
    if (currentRoomId && currentUserId) {
      handleLeaveRoom(currentRoomId, currentUserId);
    }
  });

  // --- Helpers ---

  function handleJoinRoom(roomId, userId, socket) {
    const room = rooms.get(roomId);
    if (!room) {
      socket.send(
        JSON.stringify({ action: 'error', message: 'Room not found' }),
      );
      return;
    }

    currentRoomId = roomId;

    room.users.set(userId, socket);

    socket.send(
      JSON.stringify({
        action: 'joined',
        roomId: roomId,
        roomName: room.name,
        isOwner: room.ownerId === userId,
        settings: room.settings,
        videoUrl: room.videoUrl,
        // В initial state тепер не потрібно слати playerState, бо клієнт його сам запросить через get-state
      }),
    );

    broadcastRoomState(roomId);
  }

  function handleLeaveRoom(roomId, userId) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.users.delete(userId);

    // Видаляємо кімнату, якщо пуста (запит користувача)
    if (room.users.size === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty).`);
    } else {
      // Передача прав власнику (опціонально)
      if (room.ownerId === userId) {
        const nextUser = room.users.keys().next().value;
        room.ownerId = nextUser;
        if (!room.hosts.includes(nextUser)) room.hosts.push(nextUser);
      }
      broadcastRoomState(roomId);
    }
  }

  function broadcastRoomState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const userList = Array.from(room.users.keys());
    const msg = JSON.stringify({
      action: 'room-meta-update',
      users: userList,
      ownerId: room.ownerId,
      hosts: room.hosts,
      settings: room.settings,
    });

    room.users.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  function broadcastToRoom(roomId, data, excludeSocket) {
    const room = rooms.get(roomId);
    if (!room) return;

    const msg = JSON.stringify(data);
    room.users.forEach((client) => {
      if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }
});

server.listen(3000, () => {
  console.log('Server started on port 3000');
});
