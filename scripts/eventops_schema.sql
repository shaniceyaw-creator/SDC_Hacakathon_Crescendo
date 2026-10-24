-- Development schema. Apply using the development database tool, not at runtime.
-- Replit's Publish flow handles the production schema.
-- Current OpusEvents model-based website.
-- Obsolete planner tables are not created for new installations.
-- Existing databases are not modified by this source-file cleanup.
CREATE TABLE IF NOT EXISTS eo2_events (
    id text PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('Pending','Approved','Declined','Cancelled')),
    source text NOT NULL CHECK (source IN ('customer','manager')),
    account_id text,
    event jsonb NOT NULL,
    estimate jsonb NOT NULL,
    plan jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    decision_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eo2_events_date ON eo2_events ((event->>'date'));
CREATE TABLE IF NOT EXISTS eo2_assignments (
    event_id text NOT NULL REFERENCES eo2_events(id) ON DELETE CASCADE,
    staff_id text NOT NULL,
    role text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('assigned','extra')),
    pay_rm numeric,
    PRIMARY KEY (event_id, staff_id)
);
CREATE TABLE IF NOT EXISTS eo2_open_tasks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id text NOT NULL REFERENCES eo2_events(id) ON DELETE CASCADE,
    role text NOT NULL,
    hours numeric NOT NULL,
    pay_rm numeric NOT NULL,
    status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Taken','Freelance','Closed')),
    taken_by text
);
CREATE TABLE IF NOT EXISTS eo2_leave (
    id text PRIMARY KEY,
    staff_id text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text NOT NULL CHECK (status IN ('Approved','Pending')),
    synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eo2_activity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id text,
    actor text NOT NULL,
    action text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eo2_meta (
    key text PRIMARY KEY,
    value jsonb NOT NULL
);
