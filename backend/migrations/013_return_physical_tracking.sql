-- Physical return milestones and manual reverse-shipping details.
-- Apply deliberately before deploying the corresponding API/UI changes.
ALTER TABLE order_returns
    ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
    ADD COLUMN IF NOT EXISTS awaiting_post_at timestamptz,
    ADD COLUMN IF NOT EXISTS posted_at timestamptz,
    ADD COLUMN IF NOT EXISTS in_transit_at timestamptz,
    ADD COLUMN IF NOT EXISTS closed_at timestamptz,
    ADD COLUMN IF NOT EXISTS posting_instructions text,
    ADD COLUMN IF NOT EXISTS reverse_tracking_code text,
    ADD COLUMN IF NOT EXISTS reverse_posting_code text,
    ADD COLUMN IF NOT EXISTS reverse_shipment_id text;

ALTER TABLE order_return_items
    ADD COLUMN IF NOT EXISTS condition_note text;
