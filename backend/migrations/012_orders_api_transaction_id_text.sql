-- Orders API transaction IDs are PAY-prefixed strings. Preserve any legacy
-- numeric payment IDs as their decimal string representation.
DO $$
DECLARE current_type text;
BEGIN
    SELECT data_type INTO current_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'mercado_pago_payment_id';

    IF current_type = 'bigint' THEN
        ALTER TABLE public.orders
            ALTER COLUMN mercado_pago_payment_id TYPE text
            USING mercado_pago_payment_id::text;
    ELSIF current_type IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION 'Unexpected orders.mercado_pago_payment_id type: %', current_type;
    END IF;
END $$;
