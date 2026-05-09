# Video Sync Server - Database Setup Implementation Guide

## Implementation Completed ✓

All database infrastructure components have been created and are ready for integration.

---

## 📁 File Structure Created

```
videoSyncServer/
├── db/
│   ├── config.js                 # PostgreSQL connection pool & configuration
│   └── db_repository.js          # Database query functions (CRUD)
├── sql/
│   └── schema.sql                # Database schema (CREATE TABLE statements)
├── .env                          # Environment variables (DO NOT COMMIT)
├── .env.example                  # Template for .env
├── .gitignore                    # Git ignore file (includes .env)
├── init-db.sh                    # Database initialization script (Linux/Mac)
├── init-db.ps1                   # Database initialization script (Windows)
├── package.json                  # Updated with pg and dotenv dependencies
└── POSTGRES_SETUP.md             # PostgreSQL installation guide for Windows
```

---

## 🚀 Quick Start Guide

### Step 1: Install PostgreSQL (Windows)

Follow the instructions in [POSTGRES_SETUP.md](POSTGRES_SETUP.md):

```
- Download PostgreSQL 14+ installer
- Create user: videosync_user
- Create database: videosync_db
- Note the password for .env
```

### Step 2: Configure Environment Variables

Copy `.env.example` to `.env` and update with your PostgreSQL credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=videosync_user
DB_PASSWORD=your_secure_password
DB_NAME=videosync_db
NODE_ENV=development
```

### Step 3: Install Node.js Dependencies

```bash
npm install
```

This installs:

- `pg` — PostgreSQL client library
- `dotenv` — Environment variable loader

### Step 4: Initialize Database Schema

Run the initialization script to create tables and indexes:

**Windows (PowerShell):**

```powershell
node -e "require('dotenv').config(); const { exec } = require('child_process'); exec('psql -U ' + process.env.DB_USER + ' -d ' + process.env.DB_NAME + ' -h ' + process.env.DB_HOST + ' -f sql/schema.sql -v ON_ERROR_STOP=1', (err, stdout, stderr) => { if (err) { console.error(err); process.exit(1); } console.log(stdout); });"
```

**Or manually using psql:**

```powershell
psql -U videosync_user -d videosync_db -h localhost -f sql/schema.sql
```

Expected output:

```
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
```

---

## 📊 Database Schema

### Table: `rooms`

```sql
id          VARCHAR(3) PRIMARY KEY      -- Room ID (3-digit code)
name        VARCHAR(255)                -- Room name (emoji string)
owner_id    VARCHAR(50)                 -- Owner's user ID
created_at  TIMESTAMP                   -- Room creation timestamp
```

### Table: `users`

```sql
id          VARCHAR(50) PRIMARY KEY     -- User ID
role        VARCHAR(20)                 -- OWNER or PARTICIPANT
room_id     VARCHAR(3) FK               -- Current room (NULL if not in room)
last_active TIMESTAMP                   -- Last activity timestamp
```

### Table: `room_settings`

```sql
room_id         VARCHAR(3) PRIMARY KEY  -- Room ID (1:1 relationship)
democracy       BOOLEAN                 -- Democracy mode enabled?
auto_sync_url   BOOLEAN                 -- Auto-sync video URLs?
```

---

## 🔧 Database Repository Functions

### Room Operations

**`createRoom(id, name, ownerId)`** → Creates room + default settings (transaction)

```javascript
const room = await db.createRoom('427', '🍿🎬🍕', 'user123');
```

**`getRoomDetails(roomId)`** → Gets room with settings (JOIN)

```javascript
const room = await db.getRoomDetails('427');
// { id, name, ownerId, createdAt, democracy, autoSyncUrl }
```

**`getAllRooms()`** → List all rooms with user count

```javascript
const rooms = await db.getAllRooms();
```

**`removeRoom(roomId)`** → Delete room (cascade deletes users & settings)

```javascript
await db.removeRoom('427');
```

### Settings Operations

**`updateRoomSettings(roomId, settings)`** → Update democracy/autoSyncUrl

```javascript
await db.updateRoomSettings('427', { democracy: true, autoSyncUrl: false });
```

### User Operations

**`addUserToRoom(userId, roomId, role)`** → Add/update user in room

```javascript
await db.addUserToRoom('user123', '427', 'PARTICIPANT');
```

**`removeUserFromRoom(userId, roomId)`** → Remove user from room

```javascript
await db.removeUserFromRoom('user123', '427');
```

**`getUsersInRoom(roomId)`** → Get all users in a room

```javascript
const users = await db.getUsersInRoom('427');
// [{ id, role, last_active }, ...]
```

**`getUser(userId)`** → Get user by ID

```javascript
const user = await db.getUser('user123');
// { id, role, roomId, lastActive }
```

**`deleteUser(userId)`** → Delete user from database

```javascript
await db.deleteUser('user123');
```

**`updateUserLastActive(userId)`** → Update last active timestamp

```javascript
await db.updateUserLastActive('user123');
```

---

## 💾 Configuration Module (`db/config.js`)

Features:

- ✓ Connection pooling (max 10 connections)
- ✓ Automatic connection timeout handling
- ✓ Query parameterization (SQL injection prevention)
- ✓ Query logging with duration
- ✓ Error handling on connection pool
- ✓ Startup validation (tests connection on require)

Usage:

```javascript
const db = require('./db/config');

// Execute query
const result = await db.query('SELECT * FROM rooms WHERE id = $1', ['427']);

// Get client for transactions
const client = await db.getClient();
await client.query('BEGIN');
// ... multiple queries ...
await client.query('COMMIT');
client.release();

// Close pool on server shutdown
await db.close();
```

---

## 🔐 Security Notes

1. **Environment Variables:** `.env` is excluded from git via `.gitignore`
2. **Parameter Binding:** All queries use `$1`, `$2` placeholders (SQL injection safe)
3. **Password Storage:** `.env.example` provided as template; never commit actual `.env`
4. **Connection Pool:** Manages connections efficiently with timeout handling
5. **Transaction Support:** `createRoom()` uses transactions for data consistency

---

## 📝 Next Steps (Not Implemented Yet)

These will be needed later:

### Phase 5: Server Integration

- Modify [index.js](index.js) to use database repository functions
- Replace in-memory room storage with database calls
- Add database connection initialization on server start
- Close database pool on server shutdown

### Phase 6: Verification & Testing

- Test database connectivity
- Test WebSocket handlers with database persistence
- Verify in-memory player state logic still works
- Manual integration tests

---

## 🛠️ Troubleshooting

### "connect ECONNREFUSED"

PostgreSQL is not running. Start it:

```powershell
# Check if running
Get-Service postgresql*

# Start service
Start-Service postgresql-x64-14
```

### "password authentication failed"

Update `.env` with correct PostgreSQL password (from Phase 1 setup).

### "relation rooms does not exist"

Schema wasn't initialized. Run:

```powershell
psql -U videosync_user -d videosync_db -h localhost -f sql/schema.sql
```

### "cannot connect to server"

Make sure:

1. PostgreSQL is installed and running
2. `DB_HOST`, `DB_PORT` in `.env` are correct
3. `DB_USER` and `DB_PASSWORD` match PostgreSQL user

---

## 📚 File Reference

| File                  | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `db/config.js`        | PostgreSQL connection pool & query execution       |
| `db/db_repository.js` | Database CRUD functions for rooms, users, settings |
| `sql/schema.sql`      | SQL schema with CREATE TABLE statements            |
| `.env`                | PostgreSQL credentials (DO NOT COMMIT)             |
| `.env.example`        | Template for .env configuration                    |
| `.gitignore`          | Excludes .env and node_modules from git            |
| `package.json`        | Node dependencies (pg, dotenv)                     |
| `POSTGRES_SETUP.md`   | PostgreSQL installation guide for Windows          |

---

## ✅ What's Ready

✓ PostgreSQL installation guide for Windows  
✓ SQL schema with 3 tables (rooms, users, room_settings)  
✓ Database repository module with CRUD functions  
✓ Configuration module with connection pooling  
✓ Environment variable setup (.env, .env.example)  
✓ Git ignore configuration  
✓ Package dependencies (pg, dotenv)

## ⏳ What's Next

When you're ready for **Phase 5**, the following will be modified:

- [index.js](index.js) — WebSocket handlers will call database functions
- Server startup/shutdown logic will manage database connections
- Real-time player state stays in-memory for performance

---

## 📖 Documentation Links

- [PostgreSQL Documentation](https://www.postgresql.org/docs/14/)
- [pg (node-postgres) Documentation](https://node-postgres.com/)
- [dotenv Documentation](https://github.com/motdotla/dotenv)
