-- New orders only. Historical sale movements and stock counts are untouched.
CREATE TABLE IF NOT EXISTS public.stock_reservations (
    order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id),
    order_id uuid NOT NULL REFERENCES public.orders(id),
    product_id uuid NOT NULL REFERENCES public.products(id),
    color_id text NOT NULL,
    size text NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    status text NOT NULL CHECK (status IN ('active', 'sold', 'released')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON public.stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_active_product ON public.stock_reservations(product_id)
    WHERE status = 'active';
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.stock_reservations FROM PUBLIC;
DO $revoke$
DECLARE role_name text;
BEGIN
    FOR role_name IN SELECT rolname FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.stock_reservations FROM %I', role_name);
    END LOOP;
END
$revoke$;
