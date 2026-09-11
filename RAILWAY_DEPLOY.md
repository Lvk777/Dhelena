# Railway Deploy Guide — D'Helenas

## Pré-requisitos

- Conta no [Railway](https://railway.app)
- Repositório GitHub: `Lvk777/Dhelena`
- Projeto Supabase: `huxwnoxqtmpvxrapmyz` (já configurado)
- Branch de deploy: `main` (ou a branch estável escolhida)

---

## 1. Criar projeto no Railway

1. Acesse [railway.app](https://railway.app) → **New Project**
2. Selecione **Deploy from GitHub repo**
3. Autorize Railway a acessar o repositório `Lvk777/Dhelena`
4. Selecione o repositório

## 2. Configurar o serviço Backend

1. **New Service** → **GitHub Repo** → selecione `Dhelena`
2. **Settings** do serviço:

| Configuração | Valor |
|---|---|
| **Root Directory** | `backend` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |

3. **Networking** → **Generate Domain** → anote a URL (ex: `dhelenas-api.up.railway.app`)

## 3. Variáveis de Ambiente (Backend)

Configure em **Variables** → **New Variable**:

### Obrigatórias (definir antes do primeiro deploy)

| Variável | Descrição |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Connection string do Supabase (Supabase Dashboard → Settings → Database → Connection string) |
| `SUPABASE_URL` | `https://huxwnoxqtmpvxrapmyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key (Supabase Dashboard → Settings → API) |
| `STORE_ASSETS_BUCKET` | `store-assets` |
| `ADMIN_PASSWORD` | Senha do admin (definir valor seguro) |
| `INTEGRATION_ENCRYPTION_KEY` | Chave de criptografia (32 bytes hex) |
| `JWT_SECRET` | Secret para JWT (string aleatória longa) |
| `CORS_ORIGIN` | URL do frontend (ex: `https://dhelenas.com`) — **NUNCA usar `*` em produção** |

### Futuras (opcionais — deixar vazio até ter as credenciais)

| Variável | Descrição |
|---|---|
| `MERCADO_PAGO_ACCESS_TOKEN` | Token do Mercado Pago |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Secret do webhook MP |
| `MELHOR_ENVIO_TOKEN` | Token do Melhor Envio |
| `RESEND_API_KEY` | API key do Resend |
| `EMAIL_FROM` | Email remetente (ex: `contato@dhelenas.com`) |
| `WHATSAPP_ACCESS_TOKEN` | Token do WhatsApp Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID do WhatsApp |
| `WHATSAPP_WEBHOOK_SECRET` | Secret do webhook WhatsApp |

## 4. Variáveis de Ambiente (Frontend)

O frontend (Vite) deve ser deployado separadamente (Vercel, Netlify, ou Cloudflare Pages).

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL do backend no Railway (ex: `https://dhelenas-api.up.railway.app/api`) |
| `VITE_SUPABASE_URL` | `https://huxwnoxqtmpvxrapmyz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Anon Key (Supabase Dashboard → Settings → API) |

> ⚠️ **NUNCA** usar prefixo `VITE_` para: service role, database password, JWT secret, encryption key, ou qualquer API key privada. Apenas `VITE_API_URL`, `VITE_SUPABASE_URL`, e `VITE_SUPABASE_ANON_KEY` são públicas.

## 5. Testar o deploy

Após o primeiro deploy:

1. **Health check**: Acesse `https://<sua-url>.up.railway.app/health`
   - Deve retornar: `{"status":"ok","database":"connected"}`

2. **Login Admin**: 
   ```
   POST https://<sua-url>.up.railway.app/api/auth/login
   Body: { "email": "admin@dhelenas.com", "password": "<ADMIN_PASSWORD>" }
   ```
   - Deve retornar token com `role: admin`

3. **Produtos**:
   ```
   GET https://<sua-url>.up.railway.app/api/products
   ```

4. **Sitemap**:
   ```
   GET https://<sua-url>.up.railway.app/api/sitemap.xml
   ```

## 6. CORS

Quando o domínio final do frontend estiver definido:

1. Atualize `CORS_ORIGIN` no Railway para o domínio do frontend
   - Ex: `https://dhelenas.com` ou `https://dhelenas.vercel.app`
2. O backend já rejeita `*` em produção automaticamente
3. Reinicie o serviço no Railway

## 7. Migrations em Produção

As migrations **NÃO rodam automaticamente** quando o schema já existe.

- **Schema já provisionado** (Supabase): migrations são puladas automaticamente
- **Schema novo**: rodar manualmente:
  ```bash
  railway run npm run migrate
  ```
- **Seed**: NUNCA roda em produção (`NODE_ENV=production`). Para popular manualmente:
  ```bash
  railway run npm run seed
  ```

## 8. Supabase

- **Banco**: PostgreSQL provisionado e conectado via `DATABASE_URL`
- **Storage**: Bucket `store-assets` com folders: `banners`, `products`, `collections`, `categories`, `promotions`, `branding/logo`, `branding/favicon`, `branding/og`, `misc`
- **Auth**: Funcionando com Supabase Auth + Express JWT fallback
- **Service Role**: Usada apenas no backend (NUNCA no frontend)

## 9. Dependências Base44

### PODE PERMANECER TEMPORARIAMENTE

| Item | Local | Motivo |
|---|---|---|
| `base44Client.js` | `src/api/base44Client.js` | Apenas re-exporta `apiClient` — não é SDK Base44 |
| `image-helpers.js` | `src/components/ui/image-helpers.js` | Utility para URL transformation — não depende de runtime Base44 |
| Imagens `media.base44.com` | `src/data/products.js` | URLs de imagens de produtos seed — funcionais mas devem ser migradas para Supabase Storage |

### PRECISA SER REMOVIDO ANTES DA PRODUÇÃO

| Item | Ação |
|---|---|
| `media.base44.com` em `products.js` | Migrar imagens para Supabase Storage e atualizar URLs |
| `IMG_BASE` constante | Remover após migrar todas as imagens |

> As imagens `media.base44.com` NÃO quebram o funcionamento agora, mas devem ser migradas para não depender de infraestrutura Base44.

## 10. Checklist Final

- [ ] `NODE_ENV=production` configurado
- [ ] `DATABASE_URL` aponta para Supabase
- [ ] `CORS_ORIGIN` definido (não `*`)
- [ ] `JWT_SECRET` definido (string aleatória)
- [ ] `ADMIN_PASSWORD` definido (senha segura)
- [ ] `INTEGRATION_ENCRYPTION_KEY` definido
- [ ] Health check retorna 200
- [ ] Login admin funciona
- [ ] Produtos carregam
- [ ] Sitemap XML válido
- [ ] Frontend deployado com `VITE_API_URL` apontando para Railway
