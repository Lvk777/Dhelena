# D'Helenas — Arquitetura de Produção

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React + Vite (projeto atual, sem mudanças visuais) |
| Backend | Node.js + Express (Railway) |
| Banco | PostgreSQL 17 (Supabase) |
| Auth | Supabase Auth (JWT) |
| Storage | Supabase Storage |
| Integrações futuras | Mercado Pago, Melhor Envio, WhatsApp Cloud API, E-mail transacional |

---

## A. Estrutura de Pastas Proposta

```
dhelenas/
├── src/                          # Frontend React/Vite (atual, intocado)
│   ├── api/
│   │   ├── apiClient.js          # REESCRITO: fetch HTTP → Railway API
│   │   └── supabaseClient.js     # NOVO: cliente Supabase (auth + storage)
│   ├── pages/
│   ├── components/
│   ├── context/
│   ├── lib/
│   └── data/
│
├── backend/                      # NOVO: API Railway
│   ├── src/
│   │   ├── index.js              # Entry point Express
│   │   ├── config/
│   │   │   ├── env.js            # Validação de variáveis
│   │   │   └── supabase.js       # Cliente Supabase (service role)
│   │   ├── middleware/
│   │   │   ├── auth.js           # Verifica JWT do Supabase
│   │   │   ├── requireAdmin.js  # Bloqueia não-admins
│   │   │   └── errorHandler.js
│   │   ├── routes/
│   │   │   ├── products.js
│   │   │   ├── categories.js
│   │   │   ├── collections.js
│   │   │   ├── banners.js
│   │   │   ├── orders.js
│   │   │   ├── coupons.js
│   │   │   ├── stock.js
│   │   │   ├── favorites.js
│   │   │   ├── addresses.js
│   │   │   ├── settings.js
│   │   │   ├── notifications.js
│   │   │   └── audit.js
│   │   ├── services/
│   │   │   ├── orderService.js   # Lógica de placeOrder (transacional)
│   │   │   ├── stockService.js   # Baixa/restaura estoque (SELECT FOR UPDATE)
│   │   │   ├── couponService.js  # Validação server-side
│   │   │   ├── notificationService.js  # E-mail + WhatsApp + NotificationLog
│   │   │   └── auditService.js   # AuditLog
│   │   └── utils/
│   │       ├── format.js
│   │       └── idempotency.js
│   ├── migrations/
│   │   ├── 001_profiles.sql
│   │   ├── 002_catalog.sql       # products, variants, categories, collections
│   │   ├── 003_orders.sql        # orders, order_items
│   │   ├── 004_stock.sql         # stock_movements
│   │   ├── 005_coupons.sql        # coupons, coupon_usages
│   │   ├── 006_content.sql        # banners, settings
│   │   ├── 007_favorites_addresses.sql
│   │   ├── 008_audit_notifications.sql  # audit_logs, notification_logs
│   │   └── 009_rls.sql            # Row Level Security policies
│   ├── seed/
│   │   └── seed.js               # Migra dados de initialData.json
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
│
├── docker-compose.base44.yml     # Desenvolvimento local (Base44)
└── ARCHITECTURE.md               # Este documento
```

---

## B. Schema SQL

### 001 — profiles

```sql
CREATE TABLE profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    full_name   TEXT,
    phone       TEXT,
    role        TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### 002 — catálogo

```sql
CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    image       TEXT,
    sort_order  INT DEFAULT 0,
    parent_id   UUID REFERENCES categories(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE collections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    description TEXT,
    image       TEXT,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    sku               TEXT UNIQUE,
    category_id       UUID REFERENCES categories(id),
    collection_id     UUID REFERENCES collections(id),
    description       TEXT,
    short_description TEXT,
    details           TEXT,
    price             NUMERIC(10,2) NOT NULL,
    sale_price        NUMERIC(10,2),
    cost_price        NUMERIC(10,2) DEFAULT 0,
    installments      INT DEFAULT 6,
    images            JSONB DEFAULT '[]',
    badges            JSONB DEFAULT '{}',
    composition       TEXT,
    modeling          TEXT,
    length            TEXT,
    lining            TEXT,
    transparency      TEXT,
    elasticity         TEXT,
    care               TEXT,
    measurements       TEXT,
    weight             NUMERIC(8,2) DEFAULT 0,
    package_height     NUMERIC(8,2) DEFAULT 0,
    package_width      NUMERIC(8,2) DEFAULT 0,
    package_length     NUMERIC(8,2) DEFAULT 0,
    status            TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    rating             NUMERIC(2,1) DEFAULT 5,
    sold_count         INT DEFAULT 0,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Variações: cada combinação de cor + tamanho é uma linha com estoque próprio
CREATE TABLE product_variants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    color_id        TEXT NOT NULL,
    color_name      TEXT,
    color_hex       TEXT,
    color_image     TEXT,
    size            TEXT NOT NULL,
    stock_quantity  INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (product_id, color_id, size)
);
```

### 003 — pedidos

```sql
CREATE TABLE orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number    TEXT UNIQUE NOT NULL,
    user_id         UUID NOT NULL REFERENCES profiles(id),
    status          TEXT NOT NULL DEFAULT 'recebido'
                    CHECK (status IN ('recebido','pagamento_aprovado','em_separacao',
                                      'enviado','em_transporte','saiu_entrega',
                                      'entregue','cancelado')),
    payment_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN ('pending','approved','rejected','refunded')),
    payment_method  TEXT,
    shipping_method TEXT,
    shipping_cost   NUMERIC(10,2) DEFAULT 0,
    discount        NUMERIC(10,2) DEFAULT 0,
    coupon_code     TEXT,
    subtotal        NUMERIC(10,2) NOT NULL,
    total           NUMERIC(10,2) NOT NULL,
    snapshot        JSONB NOT NULL,        -- snapshot completo do pedido
    shipping_address JSONB,
    tracking_code   TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id      UUID REFERENCES products(id),
    variant_id      UUID REFERENCES product_variants(id),
    product_name    TEXT NOT NULL,         -- snapshot
    product_sku     TEXT,
    product_image   TEXT,
    color_id        TEXT,
    color_name      TEXT,
    size            TEXT,
    quantity        INT NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL,  -- recalculado server-side
    subtotal        NUMERIC(10,2) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 004 — estoque

```sql
CREATE TABLE stock_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id      UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    order_id        UUID REFERENCES orders(id),
    type            TEXT NOT NULL CHECK (type IN ('sale','cancel','adjust','return')),
    quantity        INT NOT NULL,           -- negativo = saída, positivo = entrada
    previous_stock  INT NOT NULL,
    new_stock       INT NOT NULL,
    reason          TEXT,
    admin_id        UUID REFERENCES profiles(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 005 — cupons

```sql
CREATE TABLE coupons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT UNIQUE NOT NULL,
    description         TEXT,
    discount_type       TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
    discount_value      NUMERIC(10,2) NOT NULL,
    min_order_value     NUMERIC(10,2) DEFAULT 0,
    max_uses            INT,                 -- NULL = ilimitado
    max_uses_per_customer INT DEFAULT 1,
    first_purchase_only  BOOLEAN DEFAULT FALSE,
    active              BOOLEAN DEFAULT TRUE,
    valid_from          TIMESTAMPTZ,
    valid_until         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE coupon_usages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id   UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    order_id    UUID NOT NULL REFERENCES orders(id),
    user_id     UUID NOT NULL REFERENCES profiles(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (coupon_id, order_id)
);
```

### 006 — conteúdo

```sql
CREATE TABLE banners (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                   TEXT,
    subtitle                TEXT,
    text                    TEXT,
    eyebrow                 TEXT,
    image                   TEXT,
    link                    TEXT,
    primary_cta_label        TEXT,
    primary_cta_link        TEXT,
    secondary_cta_label     TEXT,
    secondary_cta_link     TEXT,
    position                TEXT,
    sort_order              INT DEFAULT 0,
    active                  BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT UNIQUE NOT NULL,
    value       JSONB NOT NULL,
    is_public   BOOLEAN DEFAULT FALSE,
    updated_by  UUID REFERENCES profiles(id),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### 007 — favoritos e endereços

```sql
CREATE TABLE favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, product_id)
);

CREATE TABLE addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    label       TEXT,                   -- "Casa", "Trabalho"
    recipient   TEXT,
    zip_code    TEXT,
    street      TEXT,
    number      TEXT,
    complement  TEXT,
    district    TEXT,
    city        TEXT,
    state       TEXT,
    is_default  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 008 — auditoria e notificações

```sql
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID REFERENCES profiles(id),
    action      TEXT NOT NULL,           -- 'product.update', 'stock.adjust', etc.
    entity_type TEXT,
    entity_id   TEXT,
    changes     JSONB,                    -- diff antes/depois
    ip_address  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notification_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID REFERENCES orders(id),
    event               TEXT NOT NULL,     -- 'order_created', 'payment_approved'
    channel             TEXT NOT NULL,     -- 'email', 'whatsapp'
    recipient           TEXT NOT NULL,     -- e-mail ou número
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','failed','retrying')),
    attempts            INT DEFAULT 0,
    provider_message_id TEXT,
    error               TEXT,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    -- Idempotência: mesmo order_id + event + channel + recipient = enviado só uma vez
    UNIQUE (order_id, event, channel, recipient)
);
```

---

## C. Migrations Necessárias

| # | Arquivo | Conteúdo |
|---|---|---|
| 001 | `profiles.sql` | Tabela profiles + trigger para criar profile automaticamente no signup |
| 002 | `catalog.sql` | categories, collections, products, product_variants |
| 003 | `orders.sql` | orders, order_items |
| 004 | `stock.sql` | stock_movements |
| 005 | `coupons.sql` | coupons, coupon_usages |
| 006 | `content.sql` | banners, settings |
| 007 | `favorites_addresses.sql` | favorites, addresses |
| 008 | `audit_notifications.sql` | audit_logs, notification_logs |
| 009 | `rls.sql` | Políticas RLS em todas as tabelas |
| 010 | `seed.sql` | Migração dos 14 produtos, 5 categorias, 3 coleções, 2 banners, 3 settings do `initialData.json` |

**Ferramenta**: `supabase migration` CLI ou `node-pg-migrate` — versionadas no GitHub.

---

## D. Endpoints da API (Railway Express)

### Públicos (sem auth)
```
GET    /api/products                    — listar publicados (?cat=, ?collection=, ?q=)
GET    /api/products/:id                — detalhe do produto
GET    /api/categories                  — listar categorias
GET    /api/collections                 — listar coleções
GET    /api/banners                     — banners ativos
GET    /api/settings/public             — settings com is_public=true
POST   /api/coupons/validate            — validar cupom (retorna desconto, não aplica)
```

### Cliente (auth Supabase obrigatória)
```
POST   /api/auth/register               — complementa profile após signup Supabase
GET    /api/profile                     — dados do próprio perfil
PATCH  /api/profile                     — atualizar próprio perfil
GET    /api/addresses                   — listar endereços
POST   /api/addresses                   — criar endereço
PATCH  /api/addresses/:id              — editar endereço
DELETE /api/addresses/:id              — remover endereço
GET    /api/favorites                   — listar favoritos
POST   /api/favorites                   — favoritar produto
DELETE /api/favorites/:productId        — desfavoritar
GET    /api/orders                      — listar próprios pedidos
GET    /api/orders/:id                  — detalhe do próprio pedido
POST   /api/orders                      — criar pedido (placeOrder)
DELETE /api/orders/:id                 — cancelar pedido (cancelOrder)
```

### Admin (auth + role=admin)
```
GET    /api/admin/products             — todos (incluindo draft/archived)
POST   /api/admin/products             — criar produto
PATCH  /api/admin/products/:id         — editar produto
DELETE /api/admin/products/:id         — arquivar produto
POST   /api/admin/products/:id/images  — upload para Supabase Storage
GET    /api/admin/orders               — todos os pedidos
PATCH  /api/admin/orders/:id/status    — atualizar status (updateOrderStatus)
POST   /api/admin/stock/adjust         — ajuste manual (adjustStock)
GET    /api/admin/stock/movements      — histórico de movimentações
GET    /api/admin/coupons              — listar cupons
POST   /api/admin/coupons              — criar cupom
PATCH  /api/admin/coupons/:id          — editar cupom
DELETE /api/admin/coupons/:id          — desativar cupom
GET    /api/admin/customers            — listar clientes
GET    /api/admin/audit-logs           — logs de auditoria
GET    /api/admin/settings             — todas as settings
PUT    /api/admin/settings/:key        — atualizar setting
GET    /api/admin/notifications        — status das notificações
POST   /api/admin/notifications/resend — reenviar notificação falha
GET    /api/admin/banners              — todos os banners
POST   /api/admin/banners              — criar banner
PATCH  /api/admin/banners/:id          — editar banner
```

---

## E. Fluxo de Autenticação

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Frontend   │     │  Supabase Auth   │     │  Railway API │
└──────┬──────┘     └────────┬─────────┘     └──────┬───────┘
       │                      │                        │
       │ 1. POST /auth/signup │                        │
       ├─────────────────────►│                        │
       │                      │ 2. Cria user em auth   │
       │                      │    Trigger cria profile│
       │                      │    (role=customer)     │
       │ 3. Retorna JWT       │                        │
       │◄─────────────────────┤                        │
       │                      │                        │
       │ 4. POST /api/auth/register                     │
       │    Authorization: Bearer <JWT>                 │
       ├───────────────────────────────────────────────►│
       │                      │  5. Verifica JWT via   │
       │                      │     Supabase           │
       │                      │◄───────────────────────┤
       │                      │  6. Atualiza profile   │
       │                      │     (nome, telefone)   │
       │                      │───────────────────────►│
       │ 7. OK                │                        │
       │◄──────────────────────────────────────────────┤
       │                      │                        │
       │ Para CADA requisição:                         │
       │ Authorization: Bearer <JWT>                   │
       ├───────────────────────────────────────────────►│
       │                      │  Middleware auth:       │
       │                      │  supabase.auth.getUser  │
       │                      │  → profile.role         │
       │                      │  → autoriza ou 403      │
```

**Login/Cadastro/Logout/Reset** → Supabase Auth direto do frontend via `@supabase/supabase-js`.

**Role admin** → Definida no banco (`profiles.role`). Nunca derivada de e-mail. Admin promove outro admin via SQL ou painel Supabase.

**Sessão persistente** → Supabase gerencia refresh automático do JWT.

---

## F. Estratégia de RLS (Supabase)

```sql
-- Habilitar RLS em todas as tabelas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ... (todas as tabelas)

-- PROFILES: usuário vê apenas o próprio
CREATE POLICY "profiles_self_select" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_self_update" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- PRODUCTS: público lê published; admin lê tudo (via service role no backend)
CREATE POLICY "products_public_read" ON products
    FOR SELECT USING (status = 'published');

-- ORDERS: usuário vê apenas as próprias
CREATE POLICY "orders_owner_select" ON orders
    FOR SELECT USING (auth.uid() = user_id);

-- FAVORITES: apenas dono
CREATE POLICY "favorites_owner_all" ON favorites
    FOR ALL USING (auth.uid() = user_id);

-- ADDRESSES: apenas dono
CREATE POLICY "addresses_owner_all" ON addresses
    FOR ALL USING (auth.uid() = user_id);

-- STOCK_MOVEMENTS, AUDIT_LOGS, NOTIFICATION_LOGS: sem policy pública
-- Acesso exclusivo via service role no backend Railway
-- (nenhum SELECT/INSERT direto do frontend)

-- SETTINGS: público lê apenas is_public=true
CREATE POLICY "settings_public_read" ON settings
    FOR SELECT USING (is_public = true);
```

**Princípio**: Frontend usa `anon key` (respeita RLS). Backend Railway usa `service_role key` (bypassa RLS para operações administrativas). `service_role` **nunca** no frontend.

---

## G. Estratégia de Storage (Supabase Storage)

```
Buckets:
  product-images/     → uploads do admin (produtos)
  category-images/    → imagens de categorias
  collection-images/  → imagens de coleções
  banner-images/       → imagens de banners
  content-images/     → imagens da página Sobre, etc.
```

**Políticas de bucket**:
- **Leitura pública** em todos os buckets (produtos precisam de imagens públicas).
- **Upload**: apenas autenticado + role admin (verificado via policy com `auth.jwt()`).

**Fluxo**:
1. Admin seleciona imagem no painel → frontend faz upload direto para Supabase Storage via `supabase.storage.from('product-images').upload()`.
2. Storage retorna URL pública persistente.
3. URL é salva no campo `images` do produto via API Railway.
4. Imagem permanece disponível após reload, logout, outro dispositivo.

**Substitui completamente** `URL.createObjectURL`.

---

## H. Fluxo de Pedido (placeOrder)

```
Frontend                     Railway API                    Supabase DB
    │                             │                            │
    │ POST /api/orders            │                            │
    │ { items, address,           │                            │
    │   shipping_method,          │                            │
    │   coupon_code?,             │                            │
    │   payment_method }          │                            │
    ├────────────────────────────►│                            │
    │                             │ 1. Verifica JWT            │
    │                             │ 2. INICIA TRANSAÇÃO ──────►│
    │                             │                            │
    │                             │ 3. SELECT * FROM products  │
    │                             │    WHERE id = $product_id   │
    │                             │    FOR UPDATE ─────────────►│
    │                             │    (lock para evitar race)  │
    │                             │                            │
    │                             │ 4. Recalcula preço          │
    │                             │    (do banco, não do front) │
    │                             │                            │
    │                             │ 5. SELECT * FROM           │
    │                             │    product_variants         │
    │                             │    WHERE id = $variant_id  │
    │                             │    FOR UPDATE ─────────────►│
    │                             │                            │
    │                             │ 6. Verifica estoque ≥ qty   │
    │                             │    Se insuficiente → 409    │
    │                             │    ROLLBACK ───────────────►│
    │                             │                            │
    │                             │ 7. Valida cupom (se houver) │
    │                             │    (status, datas, limite, │
    │                             │     min_order, primeira    │
    │                             │     compra, max/cliente)   │
    │                             │                            │
    │                             │ 8. Calcula frete            │
    │                             │    (do settings, não front) │
    │                             │                            │
    │                             │ 9. Calcula subtotal,        │
    │                             │    desconto, total          │
    │                             │                            │
    │                             │ 10. INSERT INTO orders      │
    │                             │     (com snapshot JSONB)    │
    │                             │     RETURNING id, number ──►│
    │                             │                            │
    │                             │ 11. INSERT INTO order_items │
    │                             │     (snapshot de cada item)│
    │                             │     ───────────────────────►│
    │                             │                            │
    │                             │ 12. UPDATE product_variants │
    │                             │     SET stock_quantity -=   │
    │                             │     qty WHERE id = $variant │
    │                             │     ───────────────────────►│
    │                             │                            │
    │                             │ 13. INSERT INTO            │
    │                             │     stock_movements         │
    │                             │     (type='sale') ─────────►│
    │                             │                            │
    │                             │ 14. Registra coupon_usage   │
    │                             │     (se cupom usado) ──────►│
    │                             │                            │
    │                             │ 15. INSERT INTO audit_logs  │
    │                             │     ───────────────────────►│
    │                             │                            │
    │                             │ 16. COMMIT ────────────────►│
    │                             │                            │
    │                             │ 17. Dispara notificações    │
    │                             │     (async, não bloqueia)  │
    │                             │     - sendOrderEmail()      │
    │                             │     - sendOrderWhatsApp()   │
    │                             │     - NotificationLog       │
    │                             │                            │
    │ 200 OK                      │                            │
    │ { order_id, order_number,   │                            │
    │   status, total }           │                            │
    │◄────────────────────────────┤                            │
```

**Idempotência**: header `Idempotency-Key` opcional no POST. Se já existe order com essa chave, retorna o pedido existente em vez de criar duplicata.

---

## I. Fluxo de Estoque

### Venda (placeOrder)
```
1. SELECT stock_quantity FROM product_variants WHERE id=$ FOR UPDATE
2. Verifica stock_quantity >= qty
3. UPDATE SET stock_quantity = stock_quantity - qty
4. INSERT stock_movements (type='sale', quantity=-qty, previous, new)
```

### Cancelamento (cancelOrder)
```
1. Verifica se pedido já está cancelado (idempotência)
2. SELECT stock_quantity FROM product_variants WHERE id=$ FOR UPDATE
3. UPDATE SET stock_quantity = stock_quantity + qty (restaura)
4. INSERT stock_movements (type='cancel', quantity=+qty, previous, new)
5. UPDATE orders SET status='cancelado', payment_status='refunded'
6. AuditLog
```

### Ajuste manual (admin)
```
1. SELECT FOR UPDATE
2. UPDATE SET stock_quantity = $new_value
3. INSERT stock_movements (type='adjust', delta, reason, admin_id)
4. AuditLog
```

### Regras de integridade
- `CHECK (stock_quantity >= 0)` no banco → **nunca negativo**
- `SELECT ... FOR UPDATE` → previne double-spend da última unidade
- Transação atômica → tudo ou nada
- StockMovement sempre registrado

---

## J. Variáveis de Ambiente

### Frontend (Vite)
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_URL=https://dhelenas-api.up.railway.app
```

### Backend (Railway)
```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://...@db.xxx.supabase.co:5432/postgres

# E-mail transacional (ex: Resend, SendGrid)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="D'Helenas <noreply@dhelenas.com.br>"

# WhatsApp Business Cloud API
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WEBHOOK_SECRET=

# Mercado Pago (futuro)
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_PUBLIC_KEY=
MERCADO_PAGO_WEBHOOK_SECRET=

# Melhor Envio (futuro)
MELHOR_ENVIO_TOKEN=

# App
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://dhelenas.vercel.app   # ou domínio final
```

### Secrets que precisam ser cadastradas no Base44 (para dev)
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

### Secrets que NÃO vão no GitHub
- `SUPABASE_SERVICE_ROLE_KEY` — apenas no Railway
- `WHATSAPP_ACCESS_TOKEN` — Railway
- `MERCADO_PAGO_ACCESS_TOKEN` — Railway
- `MELHOR_ENVIO_TOKEN` — Railway
- `SMTP_PASSWORD` — Railway

---

## Próximos Passos

1. **Criar projeto no Supabase** → obter URL + anon key + service role key
2. **Criar projeto no Railway** → conectar ao repositório
3. **Configurar secrets** no Base44 para desenvolvimento
4. **Implementar migrations** no Supabase
5. **Construir backend** em `backend/`
6. **Reescrever `apiClient.js`** para HTTP fetch
7. **Migrar seed** do `initialData.json`
8. **Testes de venda completa**

O frontend permanece visualmente idêntico. Apenas a camada de dados (`apiClient.js`) muda de stub/localStorage para chamadas HTTP reais.
