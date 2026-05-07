const WS_URL = 'ws://localhost:3000';
let socket = null;
let keepAliveInterval;

// Helper: Get User ID
function getUserId(cb) {
  chrome.storage.local.get('myUserId', (res) => {
    if (res.myUserId) cb(res.myUserId);
    else {
      const id = 'user_' + Math.floor(Math.random() * 100000);
      chrome.storage.local.set({ myUserId: id });
      cb(id);
    }
  });
}

// Helper: Keep Alive (for MV3)
function startKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(
    () => chrome.runtime.getPlatformInfo(() => {}),
    20000,
  );
}
function stopKeepAlive() {
  clearInterval(keepAliveInterval);
}

function detachVideo(tabId) {
  chrome.storage.local.set({
    videoAttached: false,
    syncedTabId: null,
  });
  if (tabId) {
    // Кажемо content script прибрати рамку та зупинити відправку даних
    chrome.tabs.sendMessage(tabId, { action: 'detach-video' }).catch(() => {
      // Якщо вкладка закрита, просто ігноруємо помилку
    });
  }
}

// --- WebSocket Management ---

function connect(roomId, actionType) {
  if (socket) socket.close();

  getUserId((userId) => {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      console.log('WS Connected');
      startKeepAlive();

      const msg = { action: actionType, userId: userId, roomId: roomId };

      // --- ВИПРАВЛЕННЯ ПРОБЛЕМИ №2: Sync Persistence ---
      if (actionType === 'create-room') {
        chrome.storage.local.get(['syncedTabId'], (res) => {
          if (res.syncedTabId) {
            // Якщо вже є синхронізована вкладка, беремо URL з неї
            chrome.tabs.get(res.syncedTabId, (tab) => {
              if (tab) {
                msg.payload = { url: tab.url };
              }
              socket.send(JSON.stringify(msg));
            });
          } else {
            // Немає синхронізованої - беремо URL активної
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) msg.payload = { url: tabs[0].url };
              socket.send(JSON.stringify(msg));
            });
          }
        });
      } else {
        socket.send(JSON.stringify(msg));
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    };

    socket.onclose = () => {
      console.log('WS Closed');
      chrome.storage.local.set({ connected: false });
      stopKeepAlive();
    };
  });
}

// --- Server Message Handler ---

function handleServerMessage(data) {
  switch (data.action) {
    case 'joined':
      chrome.storage.local.set({
        roomId: data.roomId,
        roomName: data.roomName,
        connected: true,
        isOwner: data.isOwner,
        settings: data.settings,
        videoAttached: false, // Скидаємо статус відео, поки клієнт не підтвердить
      });
      // Редірект-логіка (якщо URL не співпадає)
      if (data.videoUrl) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url !== data.videoUrl) {
            // Inject script to ask user
            chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              func: (url) => {
                if (confirm(`Room is watching: ${url}\nGo there?`))
                  window.location.href = url;
              },
              args: [data.videoUrl],
            });
          }
        });
      }

      requestServerState();
      break;

    case 'sync-video':
      // Отримали наказ синхронізуватися (від сервера або як відповідь на запит get-state)

      // --- ВИПРАВЛЕННЯ ПРОБЛЕМИ №2: Відправка в ЗБЕРЕЖЕНУ ВКЛАДКУ ---
      chrome.storage.local.get('syncedTabId', (res) => {
        const targetTabId = res.syncedTabId;
        if (targetTabId) {
          chrome.tabs
            .sendMessage(targetTabId, {
              action: 'apply-status',
              status: data.state, // { playerStatus, second ... }
              initiatorId: data.initiatorId,
            })
            .catch((err) => {
              // Вкладка закрита: скидаємо стан
              if (err.message.includes('Could not establish connection')) {
                chrome.storage.local.set({
                  videoAttached: false,
                  syncedTabId: null,
                });
              }
            });
        }
      });
      break;

    case 'error':
      alert('SyncPlayer Error: ' + data.message);
      break;

    case 'room-meta-update':
      // Оновлення метаданих кімнати (користувачі, налаштування, тощо)
      chrome.storage.local.set({
        settings: data.settings,
        hosts: data.hosts,
        users: data.users,
        ownerId: data.ownerId,
      });
      break;
  }
}

// --- Message Listeners (Content/Popup) ---

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  // Popup Actions (Create/Join/Leave)
  if (req.action === 'create-room' || req.action === 'join-room')
    connect(req.roomId, req.action);

  if (req.action === 'leave-room') {
    chrome.storage.local.get('syncedTabId', (res) => {
      if (socket) socket.close();
      // 1. Відключаємо відео
      detachVideo(res.syncedTabId);
      // 2. Очищаємо решту
      chrome.storage.local.set({ roomId: null, connected: false });
    });
  }
  if (req.action === 'request-server-state') {
    requestServerState();
  }
  if (req.action === 'unsync-video-manual') {
    chrome.storage.local.get('syncedTabId', (res) => {
      detachVideo(res.syncedTabId);
    });
  }

  if (req.action === 'video-detached-manual') {
    chrome.storage.local.set({
      videoAttached: false,
      syncedTabId: null,
    });
  }

  // Update Settings: Popup sends new settings
  if (req.action === 'update-settings') {
    chrome.storage.local.get(['myUserId'], (res) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            action: 'update-settings',
            roomId: req.roomId,
            userId: res.myUserId,
            payload: { settings: req.settings },
          }),
        );
      }
    });
  }

  // Video Selection: Content Script informs us it attached a video
  if (req.action === 'video-attached-request') {
    // --- ЗАПИТ НА СТАН (SERVER AUTHORITY) ---
    chrome.storage.local.get(['roomId', 'myUserId'], (res) => {
      if (!res.roomId) {
        chrome.tabs
          .sendMessage(sender.tab.id, { action: 'sync-failed-no-room' })
          .catch(() => {});
        return;
      }
      chrome.storage.local.set({
        videoAttached: true,
        syncedTabId: sender.tab.id, // ЗБЕРІГАЄМО ID Вкладки
      });

      if (socket && socket.readyState === WebSocket.OPEN) {
        // Шлемо запит на сервер, щоб отримати актуальний стан
        socket.send(
          JSON.stringify({
            action: 'get-state',
            roomId: res.roomId,
            userId: res.myUserId,
          }),
        );
      }
    });
  }

  // Video Control: Content Script sends update
  if (req.action === 'update-status') {
    chrome.storage.local.get(['roomId', 'myUserId'], (res) => {
      if (res.roomId && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            action: 'video-update',
            roomId: res.roomId,
            userId: res.myUserId,
            payload: { playerState: req.status },
          }),
        );
      }
    });
  }
});

function requestServerState() {
  chrome.storage.local.get(['roomId', 'myUserId'], (res) => {
    if (res.roomId && socket && socket.readyState === WebSocket.OPEN) {
      console.log(`Sending GET-STATE request for Room ${res.roomId}`);
      socket.send(
        JSON.stringify({
          action: 'get-state',
          roomId: res.roomId,
          userId: res.myUserId,
        }),
      );
    }
  });
}

// Init: Context Menu for Right Click
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sync-video-action',
    title: '⚡ Синхронізувати це відео',
    contexts: ['all'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sync-video-action') {
    chrome.tabs
      .sendMessage(tab.id, { action: 'activate-sync-from-context' })
      .catch(() => console.log('Please refresh page'));
  }
});
