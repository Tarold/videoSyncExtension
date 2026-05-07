let activeVideo = null;
let isRemoteUpdate = false;
let isInitializing = false;
let lastRightClickedVideo = null;
let roomSettings = null;
let isOwner = false;

// --- Helpers ---
function safeSendMessage(message) {
  if (!chrome.runtime?.id) {
    return;
  }
  try {
    chrome.runtime.sendMessage(message).catch((err) => {
      if (err.message.includes('Extension context invalidated')) return;
      console.error('SyncPlayer Send Error:', err);
    });
  } catch (e) {
    console.log('Context lost.');
  }
}

function showToast(text) {
  // 1. Знаходимо всі активні тости, щоб розрахувати загальний зсув
  const activeToasts = document.querySelectorAll('.toast-notification');
  let offset = 20;
  const toastHeight = 50; // Припустима фіксована висота тоста + відступ

  if (activeToasts.length > 0) {
    // Розраховуємо загальну висоту
    offset += activeToasts.length * toastHeight;
  }

  const div = document.createElement('div');
  div.textContent = text;
  div.classList.add('toast-notification'); // Додаємо клас для пошуку

  div.style.cssText = `
  position: fixed; 
  top: ${offset}px; 
  right: 20px; 
  z-index: 999999; 
  background: rgba(0,0,0,0.8); 
  color: white; 
  padding: 10px 20px; 
  border-radius: 5px; 
  font-family: sans-serif; 
  pointer-events: none;
    `;

  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- НОВЕ: Логіка відключення відео ---
function detachListeners() {
  if (activeVideo) {
    activeVideo.style.border = 'none';
    // activeVideo = null; // Залишаємо його, але знімаємо рамку
    showToast('Відео відключено від синхронізації 🚫');
  }
  // Відправляємо Service Worker, що ми відключилися (щоб скинути syncedTabId),
  // але тільки якщо activeVideo був встановлений, щоб уникнути спаму
  if (activeVideo) {
    activeVideo = null; // Очищуємо активне відео після відключення
    safeSendMessage({ action: 'video-detached-manual' });
  }
  isInitializing = false;
}

// --- Video Selection & Listeners ---
document.addEventListener(
  'contextmenu',
  (event) => {
    lastRightClickedVideo =
      event.target.tagName === 'VIDEO'
        ? event.target
        : document.querySelector('video');
  },
  true,
);

function attachListeners(video) {
  if (!video) return;

  // Якщо відео вже синхронізоване, і це та сама вкладка, то нічого не робимо
  if (activeVideo === video) {
    showToast('Відео вже синхронізовано! ✅');
    return;
  }

  // Якщо якесь інше відео було активне, відключаємо його (на випадок, якщо користувач змінив відео на сторінці)
  if (activeVideo) activeVideo.style.border = 'none';

  activeVideo = video;
  activeVideo.style.border = '4px solid #4CAF50';

  showToast('Відео знайдено! Перевірка стану кімнати... ⏳');

  // 1. Реєструємо вкладку та статус (для Service Worker). SW перевірить, чи є кімната.
  safeSendMessage({
    action: 'video-attached-request', // Змінено на "request"
    url: window.location.href,
  });

  // 2. Вмикаємо режим ініціалізації (блокуємо відправку локальних подій)
  isInitializing = true;

  // Отримуємо поточні налаштування кімнати
  chrome.storage.local.get(['settings', 'isOwner'], (res) => {
    roomSettings = res.settings || { democracy: true };
    isOwner = res.isOwner || false;
  });

  const eventHandler = () => {
    // Якщо це оновлення від сервера АБО ми ще не отримали перший стан сервера (isInitializing)
    // АБО activeVideo = null (після detach)
    if (isRemoteUpdate || isInitializing || !activeVideo) return;

    // Перевіряємо, чи дозволено користувачу змінювати стан відео (перевірка democracy)
    if (roomSettings && !roomSettings.democracy && !isOwner) {
      // democracy відключено (false) і користувач не адмін
      return;
    }

    setTimeout(() => {
      if (isRemoteUpdate || isInitializing || !activeVideo) return;

      const status = {
        playerStatus: activeVideo.paused ? 'PAUSE' : 'PLAYING',
        second: activeVideo.currentTime,
        timestamp: Date.now(),
      };
      safeSendMessage({ action: 'update-status', status: status });
    }, 100);
  };

  // Додаємо слухачів до активного відео
  activeVideo.addEventListener('play', eventHandler);
  activeVideo.addEventListener('pause', eventHandler);
  activeVideo.addEventListener('seeked', eventHandler);
}

// --- Sync Logic ---

function applyRemoteStatus(serverState) {
  if (!activeVideo) return;

  // 🔥 ВИПРАВЛЕННЯ: Знімаємо блок після першого успішного sync
  if (isInitializing) {
    console.log('Initial sync complete ✅');
    isInitializing = false;
    showToast('Синхронізовано ✅');
    // Запитуємо стан сервера після успішного підключення
    safeSendMessage({ action: 'request-server-state' });
  }

  isRemoteUpdate = true;

  const delta = Math.abs(activeVideo.currentTime - serverState.second);
  if (delta > 0.5) {
    activeVideo.currentTime = serverState.second;
  }

  if (serverState.playerStatus === 'PLAYING') {
    activeVideo.play().catch(() => {});
  } else {
    activeVideo.pause();
  }

  setTimeout(() => {
    isRemoteUpdate = false;
  }, 500);
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'activate-sync-from-context') {
    if (lastRightClickedVideo) attachListeners(lastRightClickedVideo);
  }

  // --- НОВЕ: Обробка відключення ---
  if (msg.action === 'detach-video') {
    detachListeners();
  }

  // --- НОВЕ: Обробка помилки (Немає кімнати) ---
  if (msg.action === 'sync-failed-no-room') {
    if (activeVideo) {
      detachListeners();
      showToast('⚠️ Помилка: Спочатку створіть або приєднайтеся до кімнати.');
    }
  }

  if (msg.action === 'apply-status') {
    chrome.storage.local.get('myUserId', (res) => {
      if (msg.initiatorId !== res.myUserId || msg.initiatorId === 'server') {
        applyRemoteStatus(msg.status);
      }
    });
  }

  // --- НОВЕ: Обновлення налаштувань кімнати ---
  if (msg.action === 'room-settings-updated') {
    roomSettings = msg.settings;
    isOwner = msg.isOwner;
  }
});

// Слухаємо зміни в chrome.storage для оновлення налаштувань
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.settings) {
      roomSettings = changes.settings.newValue || { democracy: true };
    }
    if (changes.isOwner) {
      isOwner = changes.isOwner.newValue || false;
    }
  }
});
