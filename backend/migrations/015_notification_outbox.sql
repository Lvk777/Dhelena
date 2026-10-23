-- Prepared only. Apply in production solely after separate authorization.
-- Existing rows keep NULL payloads and are never auto-replayed by the new worker.
ALTER TABLE notification_logs
    ADD COLUMN delivery_payload jsonb,
    ADD COLUMN source_event_id uuid REFERENCES order_events(id),
    ADD COLUMN next_attempt_at timestamptz,
    ADD COLUMN first_attempt_at timestamptz;
CREATE INDEX notification_outbox_pending ON notification_logs(next_attempt_at, created_at)
    WHERE status IN ('pending','retrying','failed') AND source_event_id IS NOT NULL;
