import type { MemberRole } from '../domain/room.js';
import type { RoomSettings } from '../protocol.js';
import type { PersistedRoom, RoomStore } from './room-store.js';

type StoredRoom = {
  id: string;
  name: string;
  ownerId: string;
  settings: RoomSettings;
  createdAt: Date;
};

type StoredUser = { roomId: string | null; role: MemberRole; lastActive: Date };

/** In-process RoomStore used when no DATABASE_URL is configured, and in unit tests. */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, StoredRoom>();
  private readonly users = new Map<string, StoredUser>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  createRoom(room: {
    id: string;
    name: string;
    ownerId: string;
    settings: RoomSettings;
  }): Promise<void> {
    if (this.rooms.has(room.id)) {
      return Promise.reject(new Error(`Room ${room.id} already exists`));
    }
    this.rooms.set(room.id, {
      ...room,
      settings: { ...room.settings },
      createdAt: this.now(),
    });
    return Promise.resolve();
  }

  findRoom(roomId: string): Promise<PersistedRoom | null> {
    const room = this.rooms.get(roomId);
    if (!room) return Promise.resolve(null);
    const hosts = [...this.users]
      .filter(([, u]) => u.roomId === roomId && u.role !== 'PARTICIPANT')
      .map(([id]) => id);
    return Promise.resolve({
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      settings: { ...room.settings },
      hosts,
    });
  }

  roomExists(roomId: string): Promise<boolean> {
    return Promise.resolve(this.rooms.has(roomId));
  }

  deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
    for (const user of this.users.values()) {
      if (user.roomId === roomId) user.roomId = null;
    }
    return Promise.resolve();
  }

  updateSettings(roomId: string, settings: RoomSettings): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) room.settings = { ...settings };
    return Promise.resolve();
  }

  addMember(roomId: string, userId: string, role: MemberRole): Promise<void> {
    if (!this.rooms.has(roomId)) {
      return Promise.reject(new Error(`Room ${roomId} does not exist`));
    }
    this.users.set(userId, { roomId, role, lastActive: this.now() });
    return Promise.resolve();
  }

  removeMember(roomId: string, userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user?.roomId === roomId) user.roomId = null;
    return Promise.resolve();
  }

  transferOwnership(roomId: string, newOwnerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) room.ownerId = newOwnerId;
    const user = this.users.get(newOwnerId);
    if (user?.roomId === roomId) user.role = 'OWNER';
    return Promise.resolve();
  }

  pruneIdleRooms(cutoff: Date): Promise<number> {
    let pruned = 0;
    for (const room of [...this.rooms.values()]) {
      const lastActivity = Math.max(
        room.createdAt.getTime(),
        ...[...this.users.values()]
          .filter((u) => u.roomId === room.id)
          .map((u) => u.lastActive.getTime()),
      );
      if (lastActivity < cutoff.getTime()) {
        void this.deleteRoom(room.id);
        pruned++;
      }
    }
    return Promise.resolve(pruned);
  }
}
