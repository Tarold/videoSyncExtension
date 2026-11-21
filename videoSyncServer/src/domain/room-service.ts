import type { Logger } from '../logger.js';
import type { RoomStore } from '../persistence/room-store.js';
import type { PlayerState, SettingsPatch } from '../protocol.js';
import { KeyedMutex } from './keyed-mutex.js';
import {
  type Connection,
  type Room,
  DEFAULT_SETTINGS,
  applyVideoUpdate,
  broadcast,
  canChangeSettings,
  canControlPlayback,
  initialPlayerState,
  mergeSettings,
  randomRoomId,
  randomRoomName,
  roleOf,
  roomMetaMessage,
  transferOwnership,
} from './room.js';

export const ERRORS = {
  roomNotFound: 'Room not found',
  notOwner: 'Only room owner can change settings',
  noFreeRoomIds: 'No free room codes, try again later',
  internal: 'Internal server error',
} as const;

const MAX_ROOM_ID_ATTEMPTS = 50;

export type RoomServiceOptions = {
  random?: () => number;
  now?: () => number;
};

/**
 * Owns all live rooms. Persistent facts (room, owner, members, settings) go through the
 * RoomStore; sockets and playback state live only here. Operations on the same room are
 * serialised, so a join can never race the deletion of the room it is joining.
 */
export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private readonly lock = new KeyedMutex();
  /** Room codes handed out but not yet created, so concurrent creates never collide. */
  private readonly reserved = new Set<string>();
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly store: RoomStore,
    private readonly logger: Logger,
    options: RoomServiceOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  async createRoom(
    userId: string,
    connection: Connection,
    url: string | undefined,
  ): Promise<Room | null> {
    let id: string | null;
    try {
      id = await this.reserveRoomId();
    } catch (err) {
      this.logger.error({ err }, 'Failed to allocate room id');
      connection.send({ action: 'error', message: ERRORS.internal });
      return null;
    }
    if (!id) {
      connection.send({ action: 'error', message: ERRORS.noFreeRoomIds });
      return null;
    }
    const roomId = id;
    try {
      return await this.lock.run(roomId, () =>
        this.createReservedRoom(roomId, userId, connection, url),
      );
    } finally {
      this.reserved.delete(roomId);
    }
  }

  private async createReservedRoom(
    id: string,
    userId: string,
    connection: Connection,
    url: string | undefined,
  ): Promise<Room | null> {
    const room: Room = {
      id,
      name: randomRoomName(this.random),
      ownerId: userId,
      hosts: [userId],
      settings: { ...DEFAULT_SETTINGS },
      videoUrl: url ?? null,
      playerState: initialPlayerState(this.now()),
      members: new Map(),
    };
    try {
      await this.store.createRoom({
        id,
        name: room.name,
        ownerId: userId,
        settings: room.settings,
      });
      await this.store.addMember(id, userId, 'OWNER');
    } catch (err) {
      this.logger.error({ err, roomId: id }, 'Failed to persist new room');
      connection.send({ action: 'error', message: ERRORS.internal });
      return null;
    }
    this.rooms.set(id, room);
    this.logger.info({ roomId: id, userId }, 'Room created');
    this.addMember(room, userId, connection);
    return room;
  }

  async joinRoom(
    roomId: string,
    userId: string,
    connection: Connection,
  ): Promise<Room | null> {
    return this.lock.run(roomId, async () => {
      try {
        const room = this.rooms.get(roomId) ?? (await this.restoreRoom(roomId));
        if (!room) {
          connection.send({ action: 'error', message: ERRORS.roomNotFound });
          return null;
        }
        await this.store.addMember(roomId, userId, roleOf(room, userId));
        this.addMember(room, userId, connection);
        return room;
      } catch (err) {
        this.logger.error({ err, roomId, userId }, 'Failed to join room');
        connection.send({ action: 'error', message: ERRORS.internal });
        return null;
      }
    });
  }

  /**
   * Removes a member. When `connection` is given, the member is only removed if it is still
   * that socket, so a stale socket closing cannot evict a user who already reconnected.
   */
  async leaveRoom(
    roomId: string,
    userId: string,
    connection?: Connection,
  ): Promise<void> {
    await this.lock.run(roomId, async () => {
      const room = this.rooms.get(roomId);
      if (!room) return;
      const current = room.members.get(userId);
      if (!current || (connection && current !== connection)) return;

      room.members.delete(userId);
      try {
        if (room.members.size === 0) {
          this.rooms.delete(roomId);
          this.logger.info({ roomId }, 'Room deleted (empty)');
          await this.store.deleteRoom(roomId);
          return;
        }
        await this.store.removeMember(roomId, userId);
        if (room.ownerId === userId) {
          const newOwner = transferOwnership(room);
          if (newOwner) await this.store.transferOwnership(roomId, newOwner);
        }
      } catch (err) {
        // Leaving cannot be refused; live state stays authoritative.
        this.logger.error({ err, roomId, userId }, 'Failed to persist leave');
      }
      if (this.rooms.has(roomId)) broadcast(room, roomMetaMessage(room));
    });
  }

  /** Replies to one client with the room's current playback state. */
  getState(roomId: string, connection: Connection): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    connection.send({
      action: 'sync-video',
      state: room.playerState,
      videoUrl: room.videoUrl,
      initiatorId: 'server',
    });
  }

  /** Applies a playback change and relays it to everyone else. Silently ignored if not allowed. */
  videoUpdate(
    roomId: string,
    userId: string,
    update: {
      playerState?: PlayerState | undefined;
      videoUrl?: string | undefined;
    },
    connection: Connection,
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !canControlPlayback(room, userId)) return false;
    applyVideoUpdate(room, update, this.now());
    broadcast(
      room,
      {
        action: 'sync-video',
        state: room.playerState,
        videoUrl: room.videoUrl,
        initiatorId: userId,
      },
      connection,
    );
    return true;
  }

  async updateSettings(
    roomId: string,
    userId: string,
    patch: SettingsPatch | undefined,
    connection: Connection,
  ): Promise<void> {
    await this.lock.run(roomId, async () => {
      const room = this.rooms.get(roomId);
      if (!room) {
        connection.send({ action: 'error', message: ERRORS.roomNotFound });
        return;
      }
      if (!canChangeSettings(room, userId)) {
        connection.send({ action: 'error', message: ERRORS.notOwner });
        return;
      }
      if (patch) {
        const next = mergeSettings(room.settings, patch);
        try {
          await this.store.updateSettings(roomId, next);
        } catch (err) {
          this.logger.error({ err, roomId }, 'Failed to persist settings');
          connection.send({ action: 'error', message: ERRORS.internal });
          return;
        }
        room.settings = next;
      }
      broadcast(room, roomMetaMessage(room));
    });
  }

  /**
   * Forgets all live rooms without touching storage. Used on shutdown so rooms survive a
   * restart and clients can rejoin them.
   */
  detachAll(): void {
    this.rooms.clear();
  }

  private addMember(room: Room, userId: string, connection: Connection): void {
    room.members.set(userId, connection);
    connection.send({
      action: 'joined',
      roomId: room.id,
      roomName: room.name,
      isOwner: room.ownerId === userId,
      settings: { ...room.settings },
      videoUrl: room.videoUrl,
    });
    broadcast(room, roomMetaMessage(room));
  }

  private async restoreRoom(roomId: string): Promise<Room | null> {
    const persisted = await this.store.findRoom(roomId);
    if (!persisted) return null;
    const hosts = persisted.hosts.includes(persisted.ownerId)
      ? persisted.hosts
      : [persisted.ownerId, ...persisted.hosts];
    const room: Room = {
      id: persisted.id,
      name: persisted.name,
      ownerId: persisted.ownerId,
      hosts,
      settings: persisted.settings,
      videoUrl: null,
      playerState: initialPlayerState(this.now()),
      members: new Map(),
    };
    this.rooms.set(roomId, room);
    this.logger.info({ roomId }, 'Room restored from storage');
    return room;
  }

  /** Picks a free code and reserves it; the caller must release it from `reserved`. */
  private async reserveRoomId(): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt++) {
      const id = randomRoomId(this.random);
      if (this.rooms.has(id) || this.reserved.has(id)) continue;
      this.reserved.add(id);
      let taken = true;
      try {
        taken = await this.store.roomExists(id);
      } finally {
        if (taken) this.reserved.delete(id);
      }
      if (!taken) return id;
    }
    return null;
  }
}
