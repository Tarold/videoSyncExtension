/**
 * WebSocket protocol shared with the Chrome extension (videoSyncExtention/service_worker.js).
 * Message names and shapes must stay backwards compatible with the published extension.
 */
import { z } from 'zod';

const MAX_ID_LENGTH = 50; // users.id / rooms.owner_id are VARCHAR(50)
const MAX_URL_LENGTH = 4096;

export const userIdSchema = z.string().min(1).max(MAX_ID_LENGTH);
const roomIdSchema = z.string().min(1).max(MAX_ID_LENGTH);
const urlSchema = z.string().min(1).max(MAX_URL_LENGTH);

export const playerStateSchema = z.object({
  playerStatus: z.string().min(1).max(32), // 'INIT' | 'PAUSE' | 'PLAYING'
  second: z.number().nonnegative(),
  timestamp: z.number(),
});

export const settingsPatchSchema = z.object({
  democracy: z.boolean().optional(),
  autoSyncUrl: z.boolean().optional(),
});

const base = { userId: userIdSchema };

export const clientMessageSchema = z.discriminatedUnion('action', [
  z.object({
    ...base,
    action: z.literal('create-room'),
    roomId: z.unknown().optional(), // the extension sends `roomId: undefined`
    payload: z.object({ url: urlSchema.optional() }).nullish(),
  }),
  z.object({ ...base, action: z.literal('join-room'), roomId: roomIdSchema }),
  z.object({
    ...base,
    action: z.literal('leave-room'),
    roomId: roomIdSchema.nullish(),
  }),
  z.object({ ...base, action: z.literal('get-state'), roomId: roomIdSchema }),
  z.object({
    ...base,
    action: z.literal('video-update'),
    roomId: roomIdSchema,
    payload: z.object({
      playerState: playerStateSchema.optional(),
      videoUrl: urlSchema.optional(),
    }),
  }),
  z.object({
    ...base,
    action: z.literal('update-settings'),
    roomId: roomIdSchema,
    payload: z.object({ settings: settingsPatchSchema.optional() }),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type PlayerState = z.infer<typeof playerStateSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export type RoomSettings = { democracy: boolean; autoSyncUrl: boolean };

export type ServerMessage =
  | {
      action: 'joined';
      roomId: string;
      roomName: string;
      isOwner: boolean;
      settings: RoomSettings;
      videoUrl: string | null;
    }
  | {
      action: 'sync-video';
      state: PlayerState;
      videoUrl: string | null;
      /** userId of whoever caused the change, or 'server' for a direct get-state reply. */
      initiatorId: string;
    }
  | {
      action: 'room-meta-update';
      users: string[];
      ownerId: string;
      hosts: string[];
      settings: RoomSettings;
    }
  | { action: 'error'; message: string };

export type ParseResult =
  { ok: true; message: ClientMessage } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  const result = clientMessageSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      error: `Invalid message: ${formatIssues(result.error)}`,
    };
  }
  return { ok: true, message: result.data };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('; ');
}
