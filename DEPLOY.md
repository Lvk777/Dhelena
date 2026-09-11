# D'Helenas — Guia de Deploy Produção (Railway + Cloudflare + Supabase)

## Arquitetura

```
dhelenas.com.br        → Frontend (Vite build estático)
www.dhelenas.com.br    → 301 → dhelenas.com.br
api.dhelenas.com.br    → Backend (Railway)
Banco/Auth/Storage      → Supabase (inalterado)
DNS + SSL + WAF         → Cloudflare
```

---

## 1. RAILWAY — Backend

### O que já está pronto no código

| Item | Status |
|------|--------|
| `process.env.PORT` | ✅ `backend/src/index.js:137` |
| Bind `0.0.0.0` | ✅ `backend/src/index.js:138` |
| `NODE_ENV=production` | ✅ Detectado em `index.js:21` |
| `trust proxy` | ✅ `app.set('trust proxy', true)` em produção |
| Health check `/health` | ✅ Retorna `{ status, database }` |
| `railway.json` | ✅ `backend/railway.json` (NIXPACKS, start: `node src/index.js`) |
| CORS via `CORS_ORIGIN` | ✅ Suporta comma-separated |
| Body limit 100kb | ✅ |
| Helmet + HSTS | ✅ Ativo em produção |
| Seed desativado em produção | ✅ |

### Variáveis de ambiente no Railway

Defina estas variáveis no dashboard do Railway (serviço do backend):

```
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://dhelenas.com.br,https://www.dhelenas.com.br
DATABASE_URL=<sua connection string do Supabase>
SUPABASE_URL=<sua URL do Supabase>
SUPABASE_SERVICE_ROLE_KEY=<sua service role key>
JWT_SECRET=<um secret forte e aleatório>
STORE_ASSETS_BUCKET=store-assets
ADMIN_PASSWORD=<sua senha de admin>
INTEGRATION_ENCRYPTION_KEY=<sua chave de criptografia>
MERCADO_PAGO_ACCESS_TOKEN=<seu token>
MERCADO_PAGO_PUBLIC_KEY=<sua chave pública>
MERCADO_PAGO_WEBHOOK_SECRET=<seu webhook secret>
MELHOR_ENVIO_TOKEN=<seu token>
```

> **NÃO use** `CORS_ORIGIN=*` em produção.

### Deploy no Railway

1. Crie um novo serviço no Railway apontando para o subdiretório `backend/`
2. Railway detecta `railway.json` automaticamente
3. Build: NIXPACKS instala dependências do `package.json`
4. Start: `node src/index.js`
5. Health: Railway monitora `GET /health`

---

## 2. DOMÍNIO DO BACKEND (api.dhelenas.com.br)

### No Railway

1. Vá em **Settings → Networking → Generate Domain**
2. Railway gera um domínio provisório: `xxxx.up.railway.app`
2. Vá em **Settings → Custom Domains**
3. Adicione: `api.dhelenas.com.br`
4. Railway mostra o **CNAME target** (ex: `xxxx.up.railway.app`)

### ⚠️ PARE AQUI — Registro DNS necessário

Anote o CNAME target exato que o Railway mostrar e crie o registro abaixo no Cloudflare:

```
TIPO DO REGISTRO: CNAME
NOME:            api
TARGET:          <copie o target exato mostrado no Railway>
PROXY:           ON (orange cloud)
```

> **Não invente o target.** Copie exatamente o que o Railway mostrar.

---

## 3. CLOUDFLARE — DNS

### Registros DNS

| Tipo | Nome | Target | Proxy |
|------|------|--------|-------|
| CNAME | `api` | `<railway-target>.up.railway.app` | ON (proxied) |
| CNAME | `@` (ou A) | `<frontend-host>` | ON (proxied) |
| CNAME | `www` | `<frontend-host>` | ON (proxied) |

> Para o frontend (`dhelenas.com.br`), o target depende de onde o frontend está hospedado (Vercel, Netlify, Railway, etc.). Defina conforme sua plataforma de frontend.

### WWW → apex (redirecionamento 301)

No Cloudflare:
1. **Rules → Redirect Rules → Create rule**
2. Nome: `www-to-apex`
3. When: `Hostname eq www.dhelenas.com.br`
4. Then: `Static redirect` → `https://dhelenas.com.br${http.request.uri.path}`
5. Status code: `301`
6. Preserve query string: ON

---

## 4. CLOUDFLARE — SSL/TLS

| Configuração | Valor |
|-------------|-------|
| SSL/TLS mode | **Full (strict)** |
| Always Use HTTPS | ON |
| Min TLS Version | 1.2 |
| Opportunistic Encryption | ON |
| TLS 1.3 | ON |
| Automatic HTTPS Rewrites | ON |

> **NÃO use Flexible.** O Railway tem certificado válido (Let's Encrypt). Full (strict) garante ponta-a-ponta.

---

## 5. CLOUDFLARE — Proxy (orange cloud) para API

O proxy do Cloudflare é **compatível** com o backend no Railway para tráfego normal.

**Atenção para webhooks:** O Cloudflare pode aplicar challenge/captcha em tráfego suspeito. Para garantir que webhooks de provedores externos cheguem ao backend, crie exceções (ver seção 10).

---

## 6. CLOUDFLARE — Cache Rules

### Pode cachear (static assets)

| Padrão | TTL |
|--------|-----|
| `*.css`, `*.js` | 30 dias (browser + edge) |
| `*.png`, `*.jpg`, `*.webp`, `*.svg`, `*.ico` | 30 dias |
| `*.woff2`, `*.woff` | 30 dias |
| `/assets/*` | 30 dias |

### NÃO cachear (bypass cache)

Crie uma **Cache Rule** com bypass para:

```
/api/*
/admin/*
/checkout/*
/login/*
/minha-conta/*
```

Configuração:
1. **Caching → Cache Rules → Create rule**
2. When: `URI Path starts with /api/ or /admin/ or /checkout/ or /login/ or /minha-conta/`
3. Then: `Bypass cache`

---

## 7. CLOUDFLARE — Segurança

### WAF + Bot Protection

| Recurso | Configuração |
|---------|-------------|
| Bot Fight Mode | ON |
| Security Level | Medium ou High |
| Challenge Passage | 30 min |
| Browser Integrity Check | ON |

### Proteção de /admin e /login

Crie uma **WAF Custom Rule**:

```
Nome: admin-protection
When: (URI Path starts with "/admin/") or (URI Path starts with "/login/")
Then: Managed Challenge
```

> Isso aplica challenge para bots sem bloquear usuários legítimos.

### Exceções de Webhook (NÃO bloquear)

Crie uma **WAF Custom Rule** com skip para:

```
Nome: webhook-bypass
When: (URI Path starts with "/api/webhooks/")
Then: Skip (all remaining rules)
```

Rotas de webhook que não devem receber challenge:
- `/api/webhooks/mercado-pago`
- `/api/webhooks/melhor-envio`
- `/api/webhooks/whatsapp`

> **Nota:** Estas rotas ainda não existem no código. Quando implementadas, devem validar assinatura/secret do provedor — não exigir login.

### Rate Limiting no Cloudflare

| Regra | Path | Limite |
|-------|------|--------|
| login-bruteforce | `/api/auth/login` | 10 req/min por IP |
| admin-protection | `/admin/*` | 50 req/min por IP |
| api-general | `/api/*` | 200 req/min por IP |

> O backend já tem rate limiting próprio (`globalLimiter`). Cloudflare é camada adicional.

---

## 8. CORS

### Configuração atual (código)

```js
// backend/src/index.js
const corsOrigin = process.env.CORS_ORIGIN || (isProduction ? '' : '*');
app.use(cors({
    origin: corsOrigin === '*' ? true : (corsOrigin ? corsOrigin.split(',').map(s => s.trim()) : false),
    credentials: true,
}));
```

### Para produção

No Railway, defina:

```
CORS_ORIGIN=https://dhelenas.com.br,https://www.dhelenas.com.br
```

> Em produção sem `CORS_ORIGIN`, CORS é desativado (seguro). **Nunca use `*` em produção.**

---

## 9. FRONTEND

### VITE_API_URL

O frontend usa:

```js
const API_BASE = import.meta.env.VITE_API_URL || '/api';
```

### Para produção

Na plataforma de deploy do frontend (Vercel, Netlify, Railway), defina:

```
VITE_API_URL=https://api.dhelenas.com.br
```

> **Não hardcode** a URL no código. Use sempre a env var.

### Build do frontend

```bash
npm run build
```

Output: `dist/` (estático — pode servir de qualquer CDN/hosting).

### Verificação de URLs antigas

Foram verificados todos os arquivos `src/` — **nenhuma URL hardcoded** (localhost, preview, etc.) foi encontrada. ✅

---

## 10. SUPABASE + STORAGE

### Supabase (inalterado)

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já configurados no backend
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no frontend
- Auth, banco e storage continuam no mesmo projeto Supabase

### Storage + Cloudflare

As URLs públicas do Supabase Storage (`*.supabase.co/storage/v1/object/public/...`) **não passam pelo Cloudflare** — são servidas diretamente pelo Supabase CDN. Portanto:

- ✅ URLs públicas continuam funcionando
- ✅ Uploads não são afetados pelo Cloudflare
- ✅ CORS de imagens é controlado pelo Supabase (não pelo Cloudflare)

> Se quiser cachear imagens do Supabase via Cloudflare, adicione uma Cache Rule para `*.supabase.co` — mas isso é opcional.

---

## 11. HEALTH CHECK

### Endpoint

```
GET /health
```

### Resposta (sem expor secrets)

```json
{
  "status": "ok",
  "database": "connected"
}
```

### URL de produção

```
https://api.dhelenas.com.br/health
```

> O `railway.json` já configura este path para healthcheck automático do Railway.

---

## 12. TRUST PROXY

### Configuração (código)

```js
// backend/src/index.js
if (isProduction) {
    app.set('trust proxy', true);
}
```

### Por que `true`

- Cloudflare sanitiza `X-Forwarded-For` (sobrescreve com `CF-Connecting-IP`)
- Railway adiciona um hop de proxy
- `true` confia em todos os hops — seguro nesta arquitetura porque Cloudflare é a borda

### Resultado

- `req.ip` → IP real do cliente (do Cloudflare)
- `req.protocol` → `https`
- `req.secure` → `true`
- Rate limiter e audit logs usam IP correto

---

## 13. CHECKLIST DE DEPLOY

### Railway (backend)

- [ ] Criar serviço no Railway apontando para `backend/`
- [ ] Definir todas as env vars (seção 1)
- [ ] Verificar deploy e health check
- [ ] Gerar domínio provisório
- [ ] Adicionar domínio customizado `api.dhelenas.com.br`
- [ ] Copiar CNAME target

### Cloudflare (DNS)

- [ ] Adicionar domínio `dhelenas.com.br` ao Cloudflare
- [ ] Criar CNAME `api` → target do Railway (proxied)
- [ ] Criar registro para `@` (frontend) (proxied)
- [ ] Criar CNAME `www` → frontend (proxied)
- [ ] Configurar redirect 301 www → apex

### Cloudflare (SSL)

- [ ] SSL/TLS mode: Full (strict)
- [ ] Always Use HTTPS: ON
- [ ] Min TLS: 1.2
- [ ] Automatic HTTPS Rewrites: ON

### Cloudflare (Cache)

- [ ] Cache Rule: static assets (30 dias)
- [ ] Cache Rule: bypass para /api/, /admin/, /checkout/, /login/, /minha-conta/

### Cloudflare (Security)

- [ ] Bot Fight Mode: ON
- [ ] WAF Rule: admin-protection (Managed Challenge)
- [ ] WAF Rule: webhook-bypass (Skip)
- [ ] Rate Limit: /api/auth/login (10/min)
- [ ] Rate Limit: /admin/* (50/min)

### Frontend

- [ ] Definir `VITE_API_URL=https://api.dhelenas.com.br`
- [ ] `npm run build` → `dist/`
- [ ] Deploy no hosting escolhido
- [ ] Configurar domínio `dhelenas.com.br`

### Validação

- [ ] `https://api.dhelenas.com.br/health` → `{ status: ok }`
- [ ] `https://dhelenas.com.br` → Home
- [ ] `https://www.dhelenas.com.br` → 301 → `https://dhelenas.com.br`
- [ ] Login funciona
- [ ] Admin funciona
- [ ] Produtos, coleções, carrinho, checkout
- [ ] Upload de imagem no Admin
- [ ] Supabase Auth + Storage funcionando
