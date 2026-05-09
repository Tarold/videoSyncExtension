/**
 * Database Repository for Video Sync Server
 * Handles all database operations for rooms, users, and settings
 */

const db = require('./config');

// ============================================================================
// ROOM OPERATIONS
// ============================================================================

/**
 * Create a new room with default settings (transaction)
 * @param {string} id - Room ID (3-digit string)
 * @param {string} name - Room name (emoji string)
 * @param {string} ownerId - User ID of room owner
 * @returns {Promise<{id, name, ownerId, democracy, autoSyncUrl}>}
 */
async function createRoom(id, name, ownerId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Insert room
    await client.query(
      'INSERT INTO rooms (id, name, owner_id) VALUES ($1, $2, $3)',
      [id, name, ownerId],
    );

    // Insert default room settings
    await client.query(
      'INSERT INTO room_settings (room_id, democracy, auto_sync_url) VALUES ($1, $2, $3)',
      [id, false, true],
    );

    await client.query('COMMIT');

    console.log(`[DB] Room created: ${id} (${name}) by ${ownerId}`);
    return { id, name, ownerId, democracy: false, autoSyncUrl: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB Error] Failed to create room:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get room details with settings (JOIN)
 * @param {string} roomId - Room ID
 * @returns {Promise<{id, name, ownerId, createdAt, democracy, autoSyncUrl} | null>}
 */
async function getRoomDetails(roomId) {
  const query = `
    SELECT 
      r.id, 
      r.name, 
      r.owner_id as "ownerId",
      r.created_at as "createdAt",
      s.democracy,
      s.auto_sync_url as "autoSyncUrl"
    FROM rooms r
    LEFT JOIN room_settings s ON r.id = s.room_id
    WHERE r.id = $1
  `;

  try {
    const result = await db.query(query, [roomId]);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] Failed to get room details:', err.message);
    throw err;
  }
}

/**
 * Get all rooms (for debugging/admin purposes)
 * @returns {Promise<Array>}
 */
async function getAllRooms() {
  const query = `
    SELECT 
      r.id,
      r.name,
      r.owner_id as "ownerId",
      r.created_at as "createdAt",
      s.democracy,
      s.auto_sync_url as "autoSyncUrl",
      COUNT(u.id) as "userCount"
    FROM rooms r
    LEFT JOIN room_settings s ON r.id = s.room_id
    LEFT JOIN users u ON r.id = u.room_id
    GROUP BY r.id, r.name, r.owner_id, r.created_at, s.democracy, s.auto_sync_url
    ORDER BY r.created_at DESC
  `;

  try {
    const result = await db.query(query);
    return result.rows;
  } catch (err) {
    console.error('[DB Error] Failed to get all rooms:', err.message);
    throw err;
  }
}

/**
 * Delete a room (cascade deletes users and settings)
 * @param {string} roomId - Room ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function removeRoom(roomId) {
  try {
    const result = await db.query('DELETE FROM rooms WHERE id = $1', [roomId]);
    const deleted = result.rowCount > 0;
    if (deleted) {
      console.log(`[DB] Room deleted: ${roomId}`);
    }
    return deleted;
  } catch (err) {
    console.error('[DB Error] Failed to delete room:', err.message);
    throw err;
  }
}

// ============================================================================
// ROOM SETTINGS OPERATIONS
// ============================================================================

/**
 * Update room settings
 * @param {string} roomId - Room ID
 * @param {object} settings - Settings object {democracy, autoSyncUrl}
 * @returns {Promise<{democracy, autoSyncUrl}>}
 */
async function updateRoomSettings(roomId, settings) {
  const { democracy, autoSyncUrl } = settings;

  let query = 'UPDATE room_settings SET ';
  const params = [];
  const updates = [];
  let paramCount = 1;

  if (democracy !== undefined) {
    updates.push(`democracy = $${paramCount}`);
    params.push(democracy);
    paramCount++;
  }

  if (autoSyncUrl !== undefined) {
    updates.push(`auto_sync_url = $${paramCount}`);
    params.push(autoSyncUrl);
    paramCount++;
  }

  if (updates.length === 0) {
    return null; // No updates to perform
  }

  query += updates.join(', ');
  query += ` WHERE room_id = $${paramCount}`;
  params.push(roomId);

  try {
    const result = await db.query(query, params);
    if (result.rowCount > 0) {
      const updated = await getRoomDetails(roomId);
      console.log(`[DB] Room settings updated: ${roomId}`);
      return {
        democracy: updated.democracy,
        autoSyncUrl: updated.autoSyncUrl,
      };
    }
    return null;
  } catch (err) {
    console.error('[DB Error] Failed to update room settings:', err.message);
    throw err;
  }
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Add or update user in room
 * @param {string} userId - User ID
 * @param {string} roomId - Room ID
 * @param {string} role - User role (OWNER or PARTICIPANT)
 * @returns {Promise<{id, role, roomId}>}
 */
async function addUserToRoom(userId, roomId, role = 'PARTICIPANT') {
  try {
    await db.query(
      `INSERT INTO users (id, room_id, role) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (id) DO UPDATE 
       SET room_id = $2, role = $3, last_active = CURRENT_TIMESTAMP`,
      [userId, roomId, role],
    );

    console.log(`[DB] User added to room: ${userId} → ${roomId} (${role})`);
    return { id: userId, role, roomId };
  } catch (err) {
    console.error('[DB Error] Failed to add user to room:', err.message);
    throw err;
  }
}

/**
 * Remove user from room (sets room_id to NULL)
 * @param {string} userId - User ID
 * @param {string} roomId - Room ID
 * @returns {Promise<boolean>} True if user was in the room
 */
async function removeUserFromRoom(userId, roomId) {
  try {
    const result = await db.query(
      'UPDATE users SET room_id = NULL WHERE id = $1 AND room_id = $2',
      [userId, roomId],
    );
    if (result.rowCount > 0) {
      console.log(`[DB] User removed from room: ${userId} ← ${roomId}`);
    }
    return result.rowCount > 0;
  } catch (err) {
    console.error('[DB Error] Failed to remove user from room:', err.message);
    throw err;
  }
}

/**
 * Get all users in a room
 * @param {string} roomId - Room ID
 * @returns {Promise<Array>}
 */
async function getUsersInRoom(roomId) {
  try {
    const result = await db.query(
      'SELECT id, role, last_active FROM users WHERE room_id = $1 ORDER BY last_active DESC',
      [roomId],
    );
    return result.rows;
  } catch (err) {
    console.error('[DB Error] Failed to get users in room:', err.message);
    throw err;
  }
}

/**
 * Update user's last_active timestamp
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function updateUserLastActive(userId) {
  try {
    const result = await db.query(
      'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1',
      [userId],
    );
    return result.rowCount > 0;
  } catch (err) {
    console.error('[DB Error] Failed to update user last_active:', err.message);
    throw err;
  }
}

/**
 * Get user by ID
 * @param {string} userId - User ID
 * @returns {Promise<{id, role, roomId, lastActive} | null>}
 */
async function getUser(userId) {
  try {
    const result = await db.query(
      `SELECT 
        id, 
        role, 
        room_id as "roomId",
        last_active as "lastActive"
       FROM users 
       WHERE id = $1`,
      [userId],
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] Failed to get user:', err.message);
    throw err;
  }
}

/**
 * Delete user from database
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function deleteUser(userId) {
  try {
    const result = await db.query('DELETE FROM users WHERE id = $1', [userId]);
    if (result.rowCount > 0) {
      console.log(`[DB] User deleted: ${userId}`);
    }
    return result.rowCount > 0;
  } catch (err) {
    console.error('[DB Error] Failed to delete user:', err.message);
    throw err;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Room operations
  createRoom,
  getRoomDetails,
  getAllRooms,
  removeRoom,

  // Settings operations
  updateRoomSettings,

  // User operations
  addUserToRoom,
  removeUserFromRoom,
  getUsersInRoom,
  updateUserLastActive,
  getUser,
  deleteUser,
};
