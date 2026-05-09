-- Video Sync Server Database Schema
-- PostgreSQL 14+

-- Таблиця кімнат (Rooms)
CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(3) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблиця користувачів (Users)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    role VARCHAR(20) DEFAULT 'PARTICIPANT',
    room_id VARCHAR(3) REFERENCES rooms(id) ON DELETE SET NULL,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблиця налаштувань кімнати (Room Settings)
-- Зв'язок 1:1 з таблицею rooms
CREATE TABLE IF NOT EXISTS room_settings (
    room_id VARCHAR(3) PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    democracy BOOLEAN DEFAULT FALSE,
    auto_sync_url BOOLEAN DEFAULT TRUE
);

-- Індекси для оптимізації запитів
CREATE INDEX IF NOT EXISTS idx_users_room_id ON users(room_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_rooms_owner_id ON rooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);
