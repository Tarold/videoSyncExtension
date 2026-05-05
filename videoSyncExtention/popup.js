const screens = {
  menu: document.getElementById('screen-menu'),
  join: document.getElementById('screen-join'),
  room: document.getElementById('screen-room'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// Оновлення UI на основі даних зі сховища
function updateUI() {
  chrome.storage.local.get(
    ['roomId', 'roomName', 'connected', 'isOwner', 'settings', 'videoAttached'],
    (data) => {
      if (data.roomId) {
        showScreen('room');
        document.getElementById('display-room-id').textContent = data.roomId;
        document.getElementById('display-room-emoji').textContent =
          data.roomName || '⏳';

        // 1. Статус Сервера
        const statusEl = document.getElementById('connection-status');
        statusEl.textContent = data.connected ? 'Server: OK' : 'Server: Off';
        statusEl.className = `status-badge ${
          data.connected ? 'status-connected' : 'status-disconnected'
        }`;

        // 2. Статус Відео
        const videoEl = document.getElementById('video-status');
        if (data.videoAttached) {
          videoEl.textContent = 'Video: Synced 🎬';
          videoEl.className = 'status-badge status-connected';
        } else {
          videoEl.textContent = 'Video: None ❌';
          videoEl.className = 'status-badge status-disconnected';
        }

        // Адмін панель
        const adminPanel = document.getElementById('admin-controls');
        if (data.isOwner) {
          adminPanel.classList.remove('hidden');
          document.getElementById('chk-democracy').checked =
            data.settings?.democracy || false;
        } else {
          adminPanel.classList.add('hidden');
        }

        const btnUnsync = document.getElementById('btn-unsync-video');
        if (data.videoAttached) {
          btnUnsync.classList.remove('hidden');
        } else {
          btnUnsync.classList.add('hidden');
        }
      } else {
        showScreen('menu');
      }
    }
  );
}

// 1. Кнопка "Створити"
document.getElementById('btn-create').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'create-room' });
});

// 2. Навігація "Увійти"
document.getElementById('btn-join-menu').addEventListener('click', () => {
  showScreen('join');
});
document.getElementById('btn-back').addEventListener('click', () => {
  showScreen('menu');
});

// 3. Дія "Увійти по коду"
document.getElementById('btn-join-action').addEventListener('click', () => {
  const code = document.getElementById('room-code-input').value;
  if (code.length === 3) {
    chrome.runtime.sendMessage({ action: 'join-room', roomId: code });
  } else {
    alert('Введіть 3 цифри!');
  }
});

// 4. Кнопка "Вийти"
document.getElementById('btn-leave').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'leave-room' });
});

// 5. Налаштування (Тільки для адміна)
document.getElementById('chk-democracy').addEventListener('change', (e) => {
  chrome.storage.local.get('roomId', (res) => {
    if (res.roomId) {
      chrome.runtime.sendMessage({
        action: 'update-settings',
        roomId: res.roomId,
        settings: { democracy: e.target.checked },
      });
    }
  });
});

document.getElementById('btn-unsync-video').addEventListener('click', () => {
  if (
    confirm(
      'Ви впевнені, що хочете відключити відео? Ви залишитеся в кімнаті, але керувати відео не будете.'
    )
  ) {
    chrome.runtime.sendMessage({ action: 'unsync-video-manual' });
  }
});

// Слухаємо зміни, щоб оновлювати UI в реальному часі
chrome.storage.onChanged.addListener(() => {
  updateUI();
});

// Ініціалізація
document.addEventListener('DOMContentLoaded', updateUI);
