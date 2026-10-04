# AGENTS.md

## Contexto do Projeto

D'Helenas — e-commerce de moda feminina em React + Vite.
Backend real em Node.js + Express + PostgreSQL (Docker compose para dev; Railway + Supabase para produção).

## Arquitetura Dual-Mode

O app funciona em dois modos, controlados por variáveis de ambiente:

- **Dev (local)**: Express JWT + Docker PostgreSQL + upload local. Sem Supabase.
- **Produção**: Supabase Auth + Supabase PostgreSQL + Supabase Storage + Railway backend.

A mudança é automática: quando `SUPABASE_URL` está definida, o backend valida tokens do Supabase Auth; caso contrário, valida JWTs do Express. O mesmo princípio aplica-se ao frontend (`VITE_SUPABASE_URL`) e ao upload (`SUPABASE_URL` no backend).

## Estrutura

- `src/`: código-fonte do frontend (React + Vite).
- `src/api/supabaseClient.js`: cliente Supabase para Auth + Storage (null quando não configurado).
- `src/api/apiClient.js`: cliente HTTP — dual-mode (Supabase Auth quando configurado, Express JWT caso contrário). Mantém a mesma interface (entities, auth, functions, integrations, app).
- `src/api/base44Client.js`: reexporta o cliente para compatibilidade.
- `backend/`: API Express com PostgreSQL.
  - `backend/src/index.js`: entry point Express + health check + CORS configurável.
  - `backend/src/config/db.js`: pool PostgreSQL com fallback automático (Supabase → local).
  - `backend/src/middleware.js`: auth dual-mode (Supabase JWT ou Express JWT) + requireAdmin.
  - `backend/src/services.js`: auditLog, validateCoupon, adjustStock, sendOrderNotifications (email via Resend, WhatsApp via Cloud API).
  - `backend/src/orderService.js`: placeOrder (transacional com SELECT FOR UPDATE) + cancelOrder.
  - `backend/src/routes/`: auth, catalog, orders, user, admin, upload.
  - `backend/migrations/001_init.sql`: schema completo (15 tabelas + users).
  - `backend/migrations/002_profiles_rename.sql`: renomeia users → profiles.
  - `backend/supabase/schema.sql`: migration Supabase (tabelas + RLS + triggers + seed). Rodar no SQL Editor do Supabase.
  - `backend/seed/seed.js`: migra dados de `src/data/initialData.json` para o banco.
  - `backend/railway.json`: configuração de deploy Railway.
  - `backend/.env.example`: template de variáveis de ambiente.

## Variáveis de Ambiente

- `.env.base44-defaults`: credenciais locais de dev (DATABASE_URL local, JWT_SECRET). Commitado.
- `/run/base44/app.env`: secrets do usuário (Supabase, Resend, WhatsApp, etc.). Não commitado.
- `docker-compose.base44.yml`: carrega ambos (defaults primeiro, secrets por último).

## Comandos

- `npm run dev`: frontend na porta 5551.
- `cd backend && npm run dev`: backend na porta 3001 (nodemon).
- `cd backend && npm run migrate`: roda migrations.
- `cd backend && npm run seed`: roda seed.

## Verificação

- Frontend: `curl http://localhost:3000/` — deve retornar HTML do Vite.
- API: `curl http://localhost:3000/api/products?limit=2` — deve retornar JSON com produtos.
- Health: `docker compose exec backend node -e "require('http').get('http://localhost:3001/health', r => { let d=''; r.on('data', c => d+=c); r.on('end', () => console.log(d)); })"`
- Console errors: usar `preview_execute_code` com `consoleLogs({ level: 'error' })`.

## Produção — Checklist

1. Criar projeto Supabase (região sa-east-1).
2. Rodar `backend/supabase/schema.sql` no Supabase SQL Editor.
3. Atualizar `DATABASE_URL` para o formato pooler (`aws-0-sa-east-1.pooler.supabase.com:6543`) — o formato direto (`db.xxxx.supabase.co:5432`) usa IPv6 e não funciona em Docker.
4. Deploy backend no Railway (usar `backend/railway.json`).
5. Setar `VITE_API_URL` no frontend para a URL do Railway.
6. Deploy frontend (Vercel/Netlify/GitHub Pages).
7. Promover primeiro usuário a admin: `UPDATE profiles SET role = 'admin' WHERE email = '...'`.

## Invariantes de Produção

- `VITE_API_URL` é obrigatório no build de produção e deve apontar para `https://api.dhelenas.com`; não existe fallback para `/api` do SPA.
- Produção usa apenas tokens Supabase Auth. O fallback JWT Express é exclusivo de desenvolvimento; perfis usam `auth.users.id`, com compatibilidade de e-mail somente após `getUser()` validar o token e quando há exatamente um perfil legado correspondente.
- Valores, dimensões e cotação de frete são recalculados no backend. O navegador pode apenas escolher o serviço retornado pela cotação.
- Webhooks Mercado Pago e Melhor Envio são autenticados por assinatura e deduplicados. O segredo de webhook do Melhor Envio é `MELHOR_ENVIO_WEBHOOK_SECRET`, não o token OAuth.
- Migrations e seed não rodam automaticamente em produção. A migration `009_profile_contact_fields.sql` deve ser aplicada conscientemente antes de usar CPF/data de nascimento.
