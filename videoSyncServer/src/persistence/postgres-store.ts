import type { Pool, PoolClient } from 'pg';
import type { MemberRole } from '../domain/room.js';
import type { RoomSettings } from '../protocol.js';
import type { PersistedRoom, RoomStore } from './room-store.js';

type RoomRow = {
  id: string;
  name: string;
  owner_id: string;
  democracy: boolean | null;
  auto_sync_url: boolean | null;
  hosts: string[];
};

export class PostgresRoomStore implements RoomStore {
  constructor(private readonly pool: Pool) {}

  async createRoom(room: {
    id: string;
    name: string;
    ownerId: string;
    settings: RoomSettings;
  }): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        'INSERT INTO rooms (id, name, owner_id) VALUES ($1, $2, $3)',
        [room.id, room.name, room.ownerId],
      );
      await client.query(
        'INSERT INTO room_settings (room_id, democracy, auto_sync_url) VALUES ($1, $2, $3)',
        [room.id, room.settings.democracy, room.settings.autoSyncUrl],
      );
    });
  }

  async findRoom(roomId: string): Promise<PersistedRoom | null> {
    const { rows } = await this.pool.query<RoomRow>(
      `SELECT r.id, r.name, r.owner_id, s.democracy, s.auto_sync_url,
              COALESCE(
                ARRAY_AGG(u.id ORDER BY u.id) FILTER (WHERE u.role IN ('OWNER', 'HOST')),
                '{}'
              ) AS hosts
         FROM rooms r
         LEFT JOIN room_settings s ON s.room_id = r.id
         LEFT JOIN users u ON u.room_id = r.id
        WHERE r.id = $1
        GROUP BY r.id, s.democracy, s.auto_sync_url`,
      [roomId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      // Rows created before migration 002 may lack settings; fall back to runtime defaults.
      settings: {
        democracy: row.democracy ?? true,
        autoSyncUrl: row.auto_sync_url ?? false,
      },
      hosts: row.hosts,
    };
  }

  async roomExists(roomId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM rooms WHERE id = $1',
      [roomId],
    );
    return rowCount === 1;
  }

  async deleteRoom(roomId: string): Promise<void> {
    // room_settings cascades; users.room_id is set to NULL by the foreign key.
    await this.pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
  }

  async updateSettings(roomId: string, settings: RoomSettings): Promise<void> {
    await this.pool.query(
      `INSERT INTO room_settings (room_id, democracy, auto_sync_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id) DO UPDATE
         SET democracy = EXCLUDED.democracy, auto_sync_url = EXCLUDED.auto_sync_url`,
      [roomId, settings.democracy, settings.autoSyncUrl],
    );
  }

  async addMember(
    roomId: string,
    userId: string,
    role: MemberRole,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, room_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET room_id = EXCLUDED.room_id, role = EXCLUDED.role, last_active = CURRENT_TIMESTAMP`,
      [userId, roomId, role],
    );
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET room_id = NULL WHERE id = $1 AND room_id = $2',
      [userId, roomId],
    );
  }

  async transferOwnership(roomId: string, newOwnerId: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('UPDATE rooms SET owner_id = $2 WHERE id = $1', [
        roomId,
        newOwnerId,
      ]);
      await client.query(
        `UPDATE users SET role = 'OWNER' WHERE id = $1 AND room_id = $2`,
        [newOwnerId, roomId],
      );
    });
  }

  async pruneIdleRooms(cutoff: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM rooms r
        WHERE r.created_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.room_id = r.id AND u.last_active >= $1
          )`,
      [cutoff],
    );
    return rowCount ?? 0;
  }

  private async transaction(
    work: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
