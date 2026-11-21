-- Store activity timestamps with time zone so comparisons don't depend on the session time zone.
ALTER TABLE rooms ALTER COLUMN created_at TYPE TIMESTAMPTZ;
ALTER TABLE users ALTER COLUMN last_active TYPE TIMESTAMPTZ;
