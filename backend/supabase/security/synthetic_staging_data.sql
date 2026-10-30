-- Local isolated PostgreSQL only. Every value below is synthetic.
INSERT INTO public.profiles (id,email,password_hash,full_name,role) VALUES
  ('00000000-0000-0000-0000-000000000101','rls-customer@example.test','synthetic-not-a-login','Synthetic Customer','customer'),
  ('00000000-0000-0000-0000-000000000102','rls-admin@example.test','synthetic-not-a-login','Synthetic Admin','admin');
INSERT INTO public.addresses (user_id) VALUES
  ('00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000102');
INSERT INTO public.categories (name,slug) VALUES ('Synthetic Category','synthetic-category');
INSERT INTO public.collections (name,slug) VALUES ('Synthetic Collection','synthetic-collection');
INSERT INTO public.products (name,sku,category,collection,price,status) VALUES
  ('Synthetic Product','SYN-RLS-01','Synthetic Category','Synthetic Collection',100.00,'published');
INSERT INTO public.coupons (code,discount_type,discount_value) VALUES ('SYNTHETIC10','percentage',10);
INSERT INTO public.settings (key,value,is_public) VALUES ('rls_synthetic_setting','{"synthetic":true}'::jsonb,false);
