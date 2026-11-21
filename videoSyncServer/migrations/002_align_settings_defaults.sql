-- Align column defaults with the server's runtime defaults (democracy on, URL auto-sync off).
-- The server always writes settings explicitly; this keeps manual inserts consistent.
ALTER TABLE room_settings
    ALTER COLUMN democracy SET DEFAULT TRUE,
    ALTER COLUMN auto_sync_url SET DEFAULT FALSE;

UPDATE room_settings SET democracy = TRUE WHERE democracy IS NULL;
UPDATE room_settings SET auto_sync_url = FALSE WHERE auto_sync_url IS NULL;

ALTER TABLE room_settings
    ALTER COLUMN democracy SET NOT NULL,
    ALTER COLUMN auto_sync_url SET NOT NULL;

-- Roles used by the server: the owner, hosts (previous owners who rejoin) and participants.
UPDATE users SET role = 'PARTICIPANT' WHERE role IS NULL OR role NOT IN ('OWNER', 'HOST', 'PARTICIPANT');
ALTER TABLE users
    ALTER COLUMN role SET NOT NULL,
    ADD CONSTRAINT users_role_check CHECK (role IN ('OWNER', 'HOST', 'PARTICIPANT'));
