import type {
  PlayerState,
  RoomSettings,
  ServerMessage,
  SettingsPatch,
} from '../protocol.js';

/** A live client socket, abstracted so room logic can be tested without `ws`. */
export interface Connection {
  readonly isOpen: boolean;
  send(message: ServerMessage): void;
}

export type MemberRole = 'OWNER' | 'HOST' | 'PARTICIPANT';

export type Room = {
  id: string;
  name: string;
  ownerId: string;
  /** Users allowed to control playback when democracy mode is off. */
  hosts: string[];
  settings: RoomSettings;
  /** Live-only state: never persisted, reset when a room is restored after a restart. */
  videoUrl: string | null;
  playerState: PlayerState;
  members: Map<string, Connection>;
};

/** Runtime defaults. Migration 002 aligns the database column defaults with these. */
export const DEFAULT_SETTINGS: Readonly<RoomSettings> = {
  democracy: true,
  autoSyncUrl: false,
};

export const ROOM_EMOJIS = [
  '🍿',
  '🎬',
  '🍕',
  '🚀',
  '🐱',
  '🌵',
  '👻',
  '👾',
  '📀',
  '📺',
] as const;

const ROOM_NAME_LENGTH = 3;
const MIN_ROOM_ID = 100;
const ROOM_ID_RANGE = 900; // three-digit codes: 100-999

export function randomRoomId(random: () => number): string {
  return String(Math.floor(random() * ROOM_ID_RANGE) + MIN_ROOM_ID);
}

export function randomRoomName(random: () => number): string {
  return Array.from(
    { length: ROOM_NAME_LENGTH },
    () => ROOM_EMOJIS[Math.floor(random() * ROOM_EMOJIS.length)],
  ).join('');
}

export function initialPlayerState(now: number): PlayerState {
  return { playerStatus: 'INIT', second: 0, timestamp: now };
}

export function canControlPlayback(room: Room, userId: string): boolean {
  return room.settings.democracy || room.hosts.includes(userId);
}

export function canChangeSettings(room: Room, userId: string): boolean {
  return room.ownerId === userId;
}

export function roleOf(room: Room, userId: string): MemberRole {
  if (room.ownerId === userId) return 'OWNER';
  return room.hosts.includes(userId) ? 'HOST' : 'PARTICIPANT';
}

/**
 * Applies a playback update. A new video URL resets the player to a paused state at 0s,
 * taking precedence over any player state sent in the same update.
 */
export function applyVideoUpdate(
  room: Room,
  update: {
    playerState?: PlayerState | undefined;
    videoUrl?: string | undefined;
  },
  now: number,
): void {
  if (update.playerState) {
    room.playerState = update.playerState;
  }
  if (update.videoUrl && update.videoUrl !== room.videoUrl) {
    room.videoUrl = update.videoUrl;
    room.playerState = { playerStatus: 'PAUSE', second: 0, timestamp: now };
  }
}

export function mergeSettings(
  current: RoomSettings,
  patch: SettingsPatch,
): RoomSettings {
  return {
    democracy: patch.democracy ?? current.democracy,
    autoSyncUrl: patch.autoSyncUrl ?? current.autoSyncUrl,
  };
}

/**
 * Hands ownership to the longest-standing remaining member (Map insertion order) and makes
 * them a host. Returns the new owner, or undefined if nobody is left.
 */
export function transferOwnership(room: Room): string | undefined {
  const next = room.members.keys().next();
  if (next.done) return undefined;
  room.ownerId = next.value;
  if (!room.hosts.includes(next.value)) room.hosts.push(next.value);
  return next.value;
}

export function roomMetaMessage(room: Room): ServerMessage {
  return {
    action: 'room-meta-update',
    users: [...room.members.keys()],
    ownerId: room.ownerId,
    hosts: [...room.hosts],
    settings: { ...room.settings },
  };
}

export function broadcast(
  room: Room,
  message: ServerMessage,
  exclude?: Connection,
): void {
  for (const connection of room.members.values()) {
    if (connection !== exclude && connection.isOpen) connection.send(message);
  }
}
