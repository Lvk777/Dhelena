-- Financial refunds, physical returns and stock restoration are separate ledgers.
-- Apply deliberately; production migrations are never run at boot.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('pending', 'approved', 'rejected', 'partially_refunded', 'refunded'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_attempt_started_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_attempt_method text;

CREATE TABLE IF NOT EXISTS order_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id),
    idempotency_key text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('full', 'partial', 'remaining')),
    amount numeric(10,2) NOT NULL CHECK (amount > 0),
    status text NOT NULL CHECK (status IN ('reserved', 'processing', 'processed', 'failed', 'reconciliation_required')),
    provider_order_id text NOT NULL,
    provider_payment_id text NOT NULL,
    provider_refund_id text,
    provider_status text,
    return_id uuid,
    reason text NOT NULL,
    actor_id uuid NOT NULL,
    selected_items jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refunds_provider_id ON order_refunds(provider_refund_id)
    WHERE provider_refund_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refunds_unresolved ON order_refunds(order_id)
    WHERE status IN ('reserved', 'processing', 'reconciliation_required');

CREATE TABLE IF NOT EXISTS order_returns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id),
    status text NOT NULL DEFAULT 'solicitada'
        CHECK (status IN ('solicitada', 'autorizada', 'aguardando_postagem',
                         'em_transito_retorno', 'recebida', 'reembolso_processado',
                         'recusada', 'cancelada')),
    reason text NOT NULL,
    requested_by uuid NOT NULL,
    reviewed_by uuid,
    received_by uuid,
    received_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_return_id_fkey') THEN
        ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_return_id_fkey
            FOREIGN KEY (return_id) REFERENCES order_returns(id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_return_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id uuid NOT NULL REFERENCES order_returns(id),
    order_item_id uuid NOT NULL REFERENCES order_items(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    restockable boolean,
    UNIQUE (return_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS stock_restorations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id),
    order_item_id uuid NOT NULL REFERENCES order_items(id),
    return_item_id uuid REFERENCES order_return_items(id),
    source text NOT NULL CHECK (source IN ('cancellation', 'return')),
    quantity integer NOT NULL CHECK (quantity > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((source = 'return' AND return_item_id IS NOT NULL)
        OR (source = 'cancellation' AND return_item_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_restoration_cancellation ON stock_restorations(order_item_id)
    WHERE source = 'cancellation';
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_restoration_return ON stock_restorations(return_item_id)
    WHERE source = 'return';
CREATE INDEX IF NOT EXISTS idx_stock_restorations_item ON stock_restorations(order_item_id);
