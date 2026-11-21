import type { MemberRole } from '../domain/room.js';
import type { RoomSettings } from '../protocol.js';

export type PersistedRoom = {
  id: string;
  name: string;
  ownerId: string;
  settings: RoomSettings;
  /** Members currently assigned the OWNER or HOST role. */
  hosts: string[];
};

/**
 * Durable storage for rooms, memberships and settings. Live sockets and playback state are
 * deliberately kept out of it: they change many times per second and are meaningless after
 * a restart.
 */
export interface RoomStore {
  createRoom(room: {
    id: string;
    name: string;
    ownerId: string;
    settings: RoomSettings;
  }): Promise<void>;
  findRoom(roomId: string): Promise<PersistedRoom | null>;
  roomExists(roomId: string): Promise<boolean>;
  deleteRoom(roomId: string): Promise<void>;
  updateSettings(roomId: string, settings: RoomSettings): Promise<void>;
  /** Adds a user to a room (moving them out of any previous room) with the given role. */
  addMember(roomId: string, userId: string, role: MemberRole): Promise<void>;
  removeMember(roomId: string, userId: string): Promise<void>;
  transferOwnership(roomId: string, newOwnerId: string): Promise<void>;
  /** Deletes rooms with no creation or join activity since `cutoff`. Returns how many. */
  pruneIdleRooms(cutoff: Date): Promise<number>;
}
