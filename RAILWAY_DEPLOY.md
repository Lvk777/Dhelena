# Railway — estado e operação da D'Helenas

Revisão documental: 4 de outubro de 2026. Este guia descreve a implantação existente; não é um roteiro para criar outro projeto ou trocar credenciais. Qualquer valor privado indicado abaixo deve ser **confirmado no ambiente** por quem tem acesso ao serviço, sem copiá-lo para este arquivo.

## Estado atual e fontes de verificação

| Item | Estado |
|---|---|
| Repositório | `Lvk777/Dhelena` |
| Branch de trabalho | `codex/production-hardening`; PR [#3](https://github.com/Lvk777/Dhelena/pull/3) aberta contra `base44/setup-d4d01bd6`. O conteúdo da PR não deve ser descrito como já promovido a `main` ou implantado. Confirmar no ambiente o commit efetivamente implantado em cada serviço. |
| Frontend | Serviço Railway `Dhelena`, domínio público `https://dhelenas.com`. Nome do serviço informado no estado operacional; confirmar no painel Railway, pois o CLI disponível nesta revisão não tinha acesso ao projeto D'Helenas. |
| Backend | Serviço Railway `resourceful-joy`, API `https://api.dhelenas.com/api`, health `https://api.dhelenas.com/health`. Nome do serviço informado no estado operacional; confirmar no painel Railway. |
| Supabase ativo no frontend publicado | Project ref `huxwnoxkqtmpvxrapmyz`; URL `https://huxwnoxkqtmpvxrapmyz.supabase.co`, confirmada no bundle servido por `dhelenas.com`. A variável privada do backend deve ser conferida no Railway sem revelar chaves. |
| Manutenção | Ligada: `GET /api/settings` retornou `maintenance.maintenance_mode=true` nesta revisão. Preservar o estado até decisão operacional separada. |
| Integrações | Mercado Pago em **TEST** e Melhor Envio em **Sandbox**, conforme estado operacional informado e registro de homologação. Confirmar `MERCADO_PAGO_MODE` e `MELHOR_ENVIO_MODE` no serviço antes de qualquer operação; não usar credenciais de produção na homologação. |

O frontend publicado contém `https://api.dhelenas.com` como base da API. `GET /health` e `GET /api/products?limit=1` responderam HTTP 200 nesta revisão. Isso não confirma a versão implantada da PR #3 nem o valor de variáveis privadas.

## Frontend e backend no Railway

O frontend é React + Vite e está no Railway; não apontá-lo para um domínio Railway provisório. No build de produção, `VITE_API_URL` é obrigatória e deve ser **`https://api.dhelenas.com`**, sem `/api` no valor: o cliente acrescenta os caminhos `/api/...`. Sem essa variável, o build deve falhar; não há fallback para `/api` do host do SPA.

O backend usa Node 22 (`backend/package.json` exige `>=22 <23`; o CI também usa Node 22). O `backend/railway.json` define `node src/index.js` como start e `/health` como health check. Diretório raiz, comandos e commit configurados nos dois serviços: **confirmar no ambiente** antes de qualquer alteração. Não usar este documento para recriar os serviços.

### Variáveis de referência, sem valores privados

| Serviço | Variável | Referência segura |
|---|---|---|
| Frontend | `VITE_API_URL` | `https://api.dhelenas.com` — valor observado no bundle público. |
| Frontend | `VITE_SUPABASE_URL` | `https://huxwnoxkqtmpvxrapmyz.supabase.co` — valor observado no bundle público. |
| Frontend | `VITE_SUPABASE_ANON_KEY` | Chave pública do **mesmo** projeto Supabase; confirmar correspondência no ambiente, sem registrar o valor aqui. |
| Backend | `NODE_ENV` | `production`; confirmar no ambiente. |
| Backend | `DATABASE_URL` | Conexão PostgreSQL do projeto Supabase correto; confirmar no ambiente, sem imprimir a connection string. |
| Backend | `SUPABASE_URL` | `https://huxwnoxkqtmpvxrapmyz.supabase.co` é a URL de referência do projeto ativo. Confirmar o valor efetivo do backend no ambiente; não presumir que a variável privada já coincide. |
| Backend | `SUPABASE_SERVICE_ROLE_KEY` | Chave privada do mesmo projeto; confirmar correspondência no ambiente. Nunca colocar em `VITE_*`, logs ou documentação. |
| Backend | `STORE_ASSETS_BUCKET` | `store-assets`; uploads usam esse bucket por padrão em `backend/src/routes/upload.js`. Confirmar bucket e políticas no ambiente. |
| Backend | `CORS_ORIGIN` | `https://dhelenas.com,https://www.dhelenas.com`; ambas as origens receberam o cabeçalho CORS esperado nesta revisão. `*` é recusado na inicialização em produção. |
| Backend | `INTEGRATION_ENCRYPTION_KEY` | Confirmar apenas presença e continuidade no ambiente; não copiar nem girar por esta revisão. |

`VITE_*` entra no bundle público. Chaves privadas do Supabase, banco, pagamentos, frete e criptografia pertencem somente ao backend. `ADMIN_PASSWORD` e `JWT_SECRET` são legados do fluxo local de seed/JWT Express; **não são pré-requisitos de autenticação de produção**, não devem ser solicitados ou expostos para validar o deploy. Não executar seed em produção.

## Autenticação e CORS

Em produção, o backend exige `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` na inicialização. O frontend autentica com Supabase Auth; o backend valida o access token via `getUser()` e busca o perfil correspondente. A compatibilidade por e-mail para um perfil legado só ocorre após validação do token Supabase e quando existe exatamente um perfil. Um token JWT Express não é aceito em produção, mesmo se o Supabase estiver indisponível. `POST /api/auth/login` e `/register` do Express retornam 404 em produção; o login administrativo usa Supabase Auth.

O backend aceita a lista de origens em `CORS_ORIGIN` e usa `credentials: true`. Nesta revisão, `https://dhelenas.com` e `https://www.dhelenas.com` foram aceitas e uma origem externa não recebeu `Access-Control-Allow-Origin`. Se a configuração for revista, conferir primeiro o domínio público efetivo e preservar a restrição; não adicionar `*`.

## Banco e migrations

O schema de produção já existe. **Migrations são aplicadas manualmente, após revisão da migration específica, backup e aprovação operacional.** Não executar `npm run migrate` ou `railway run npm run migrate` às cegas: `backend/src/runMigrations.js` percorre todos os arquivos SQL, sem controle de versões aplicadas. A migration `009_profile_contact_fields.sql` e as posteriores devem ser consideradas individualmente conforme o estado real do banco; a lista local vai até `013_return_physical_tracking.sql`, mas isso não comprova o que já foi aplicado em produção.

O código atual de inicialização (`backend/src/index.js`) pula migrations quando encontra `public.products` e desativa seed automático em produção. Se o schema estiver ausente, esse mesmo código ainda tenta executar SQL no primeiro start. **Não usar esse caminho como processo de provisionamento de produção**; confirmar o schema antes de qualquer deploy. Nunca executar `npm run seed` em produção. Esta revisão não consulta nem altera o banco.

## Pagamentos, frete e webhooks

O estado operacional atual é Mercado Pago **TEST** e Melhor Envio **Sandbox** no backend existente. Confirmar no Railway os modos, a origem das credenciais e os segredos correspondentes antes de qualquer homologação. `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_CLIENT_SECRET`, `MELHOR_ENVIO_WEBHOOK_SECRET` e `INTEGRATION_ENCRYPTION_KEY` nunca devem aparecer em documentação, logs ou comandos compartilhados. Um token fixo do Melhor Envio só é utilizável quando `MELHOR_ENVIO_TOKEN_MODE` coincide com `MELHOR_ENVIO_MODE`; o OAuth Sandbox pode usar token guardado em `integration_configs`.

Endpoints implementados no backend:

- `POST https://api.dhelenas.com/api/webhooks/mercado-pago` — assinatura validada com `MERCADO_PAGO_WEBHOOK_SECRET` e eventos deduplicados.
- `POST https://api.dhelenas.com/api/webhooks/melhor-envio` — HMAC validado com `MELHOR_ENVIO_WEBHOOK_SECRET` e eventos deduplicados; esse segredo não é o token OAuth.
- `GET https://api.dhelenas.com/api/integrations/melhor-envio/oauth/callback` — callback do OAuth Sandbox, com URL exata configurada no ambiente.

Não há rota `/api/webhooks/whatsapp` em `backend/src/routes/webhooks.js` nesta revisão; não a cadastrar com base em documentação antiga. Confirmar as URLs e assinaturas configuradas nos painéis dos provedores antes de qualquer mudança. Esta revisão não envia eventos, pedidos, pagamentos, devoluções ou reembolsos.

## Storage e ativos Base44

Uploads Supabase usam `store-assets`. Há URLs `media.base44.com` em dados de seed/fallback e imagens institucionais; `src/api/base44Client.js` é apenas um reexport do cliente próprio. O [inventário de ativos](BASE44_ASSET_INVENTORY.md) registra origem, dependências e plano de migração. A permanência dessas URLs **não autoriza** copiar, substituir ou excluir ativos Base44, alterar referências no banco ou remover o helper de imagens. Qualquer migração de mídia requer decisão e autorização próprias.

## Verificações somente leitura

- Conferir o estado da PR #3 e os commits dos serviços Railway sem presumir que `main` ou a PR estejam implantadas.
- Conferir no painel Railway a correspondência entre URLs do Supabase, banco, chaves e serviços, sem exibir valores privados.
- Conferir `https://api.dhelenas.com/health`, o catálogo público e `https://api.dhelenas.com/api/sitemap.xml` por GET.
- Conferir o modo de manutenção pela configuração pública; não desligá-lo como parte da verificação.
- Conferir modos TEST/Sandbox e endpoints dos provedores apenas por configuração e leituras autorizadas.
