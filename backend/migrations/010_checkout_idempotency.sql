CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency_unique
    ON orders (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
