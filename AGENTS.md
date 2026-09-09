# AGENTS.md

## Contexto do Projeto

D'Helenas — e-commerce de moda feminina em React + Vite.
Backend real em Node.js + Express + PostgreSQL (Docker compose para dev; Railway + Supabase para produção).

## Estrutura

- `src/`: código-fonte do frontend (React + Vite).
- `src/api/apiClient.js`: cliente HTTP real — substitui o antigo stub localStorage. Mantém a mesma interface (entities, auth, functions, integrations, app).
- `src/api/base44Client.js`: reexporta o cliente para compatibilidade.
- `backend/`: API Express com PostgreSQL.
  - `backend/src/index.js`: entry point Express.
  - `backend/src/config/db.js`: pool PostgreSQL.
  - `backend/src/middleware.js`: auth JWT + requireAdmin + errorHandler.
  - `backend/src/services.js`: auditLog, validateCoupon, adjustStock, sendOrderNotifications.
  - `backend/src/orderService.js`: placeOrder (transacional) + cancelOrder.
  - `backend/src/routes/`: auth, catalog, orders, user, admin, upload.
  - `backend/migrations/001_init.sql`: schema completo (15 tabelas).
  - `backend/seed/seed.js`: migra dados de `src/data/initialData.json` para o banco.
- `ARCHITECTURE.md`: documento de arquitetura Railway + Supabase + módulos futuros.

## Comandos

- `npm run dev`: frontend na porta 5551.
- `cd backend && npm run dev`: backend na porta 3001 (nodemon).
- `cd backend && npm run migrate`: roda migrations.
- `cd backend && npm run seed`: roda seed.

## Ambiente Base44 (docker-compose.base44.yml)

Três serviços:
1. **web** (node:22): frontend Vite, porta 3000→5551, proxy `/api` → backend.
2. **backend** (node:22): API Express, porta 3001, nodemon hot-reload. Auto-roda migrations + seed no startup.
3. **postgres** (postgres:17-alpine): banco PostgreSQL, porta 5432.

## Credenciais de Dev

- **Admin**: `admin@dhelenas.com` / `admin123`
- **Banco**: `postgresql://dhelenas:dhelenas@postgres:5432/dhelenas`
- **JWT_SECRET**: `dhelenas-dev-jwt-secret-2026` (inline no compose para dev)

## Verificação

- `curl http://localhost:3000/api/products` → 14 produtos publicados.
- `curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@dhelenas.com","password":"admin123"}'` → JWT token.
- `curl http://localhost:3000/health` → `{ status: 'ok' }` (via proxy).

## Secrets para Produção (Railway)

- `DATABASE_URL` (Supabase PostgreSQL)
- `JWT_SECRET` (valor forte aleatório)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (WhatsApp Cloud API)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`
- `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY`, `MERCADO_PAGO_WEBHOOK_SECRET`
- `MELHOR_ENVIO_TOKEN`
