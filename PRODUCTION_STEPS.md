# Procedimento operacional de produção

Este roteiro é para a janela de amanhã. Não cole segredos neste arquivo, em
commits, no terminal compartilhado ou em screenshots. Cada etapa tem um ponto
de parada: se o resultado esperado não ocorrer, não avance.

## A. SUPABASE

### Migration 009

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Registrar estado antes da migration |
| ONDE | Supabase Dashboard → projeto correto → SQL Editor |
| AÇÃO | Confirmar que a sessão tem permissão de DDL e registrar somente contagens. |
| COMANDO | `SELECT count(*) AS profiles_total, count(*) FILTER (WHERE cpf IS NOT NULL) AS cpf_preenchido, count(*) FILTER (WHERE birth_date IS NOT NULL) AS nascimento_preenchido FROM profiles;` |
| RESULTADO ESPERADO | Uma linha de contagens; nenhum dado pessoal precisa ser copiado. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Aplicar migration não destrutiva |
| ONDE | Mesmo SQL Editor |
| AÇÃO | Executar exatamente o conteúdo de `backend/migrations/009_profile_contact_fields.sql`. |
| COMANDO | `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cpf text, ADD COLUMN IF NOT EXISTS birth_date date;` |
| RESULTADO ESPERADO | Sucesso. Não há `DROP`, alteração de tipo, default nem backfill. Erro de permissão deve interromper a etapa sem alteração parcial. |

| Campo | Instrução |
| --- | --- |
| PASSO | 3 — Validar schema e preservação |
| ONDE | Mesmo SQL Editor |
| AÇÃO | Conferir tipo, nulidade e contagens pós-execução. |
| COMANDO | `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('cpf','birth_date');` e repetir a consulta de contagens do passo 1. |
| RESULTADO ESPERADO | `cpf` = `text`, `birth_date` = `date`, ambas anuláveis; totais anteriores preservados. |

Não faça rollback com `DROP COLUMN` após qualquer escrita nesses campos: isso
perderia dados. Em caso de necessidade, pare, exporte os valores afetados e
prepare uma reversão aprovada.

## B. RAILWAY BACKEND

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Criar/configurar serviço de backend |
| ONDE | Railway → serviço do repositório → Settings |
| AÇÃO | Apontar o serviço para a branch aprovada da PR, sem merge automático. |
| COMANDO | Root Directory: `backend`; Start Command: `node src/index.js`; Health Check Path: `/health`. |
| RESULTADO ESPERADO | Build inicia e Railway marca o deployment saudável. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Definir variáveis obrigatórias |
| ONDE | Railway → Variables |
| AÇÃO | Cadastrar secretos no dashboard, nunca no repositório. |
| COMANDO | Nomes: `NODE_ENV`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORE_ASSETS_BUCKET`, `ADMIN_PASSWORD`, `INTEGRATION_ENCRYPTION_KEY`, `JWT_SECRET`, `CORS_ORIGIN`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_MODE`, `MELHOR_ENVIO_WEBHOOK_SECRET`. Use `CORS_ORIGIN=https://dhelenas.com,https://www.dhelenas.com`. |
| RESULTADO ESPERADO | O processo inicia sem aceitar `CORS_ORIGIN=*`; nenhuma variável aparece em logs. |

| Campo | Instrução |
| --- | --- |
| PASSO | 3 — Validar domínio provisório, se criado |
| ONDE | Railway → Settings → Networking; navegador/terminal local |
| AÇÃO | Somente após o deployment saudável, testar o domínio provisório que o Railway exibir. |
| COMANDO | `curl -i https://<dominio-provisorio-exato>/health` |
| RESULTADO ESPERADO | HTTP 200 e JSON de saúde sem segredos. Não use esse domínio no frontend público. |

## C. RAILWAY FRONTEND

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Configurar build público |
| ONDE | Serviço/host que publica o frontend → Environment Variables |
| AÇÃO | Definir somente variáveis públicas de build. |
| COMANDO | `VITE_API_URL=https://api.dhelenas.com`, `VITE_SUPABASE_URL=<url-publica-supabase>`, `VITE_SUPABASE_ANON_KEY=<anon-key-publica>`. |
| RESULTADO ESPERADO | Novo build; nenhum secret de backend usa prefixo `VITE_`. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Verificar bundle |
| ONDE | Browser DevTools → Network/Sources |
| AÇÃO | Abrir o site e conferir requisições de API. |
| COMANDO | Filtrar por `api.dhelenas.com`; não use fallback local. |
| RESULTADO ESPERADO | Requisições apontam para o domínio final da API e não para localhost ou domínio provisório. |

## D. CLOUDFLARE

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Adicionar domínio da API quando o Railway liberar o plano |
| ONDE | Railway → Settings → Networking → Custom Domain; depois Cloudflare → DNS |
| AÇÃO | No Railway, adicionar `api.dhelenas.com`; copiar o target exibido. No Cloudflare, criar o DNS sem inventar o target. |
| COMANDO | `TYPE=CNAME`; `NAME=api`; `TARGET=<target exato do Railway>`; `PROXY=ON`; `TTL=Auto`. |
| RESULTADO ESPERADO | `api.dhelenas.com` resolve e `GET /health` retorna 200 via Cloudflare. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — TLS, cache e WAF |
| ONDE | Cloudflare → SSL/TLS, Cache Rules, Security Rules |
| AÇÃO | Definir SSL `Full (strict)`. Criar bypass de cache para `/api/*`, `/admin/*`, `/checkout/*`, `/login/*`, `/minha-conta/*` e `/webhooks/*`. Aplicar rate limit por IP real na borda; challenge adicional em admin/login sem usar Allow global para webhooks. |
| COMANDO | Criar regras no dashboard; validar com requests reais depois do domínio responder. |
| RESULTADO ESPERADO | Conteúdo autenticado/dinâmico não é cacheado; webhooks assinados não recebem CAPTCHA; admin/login continuam utilizáveis. |

## E. MERCADO PAGO TEST

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Liberar teste somente com ambiente de teste |
| ONDE | Railway Variables e painel Mercado Pago |
| AÇÃO | Confirmar que o access token começa com `TEST-` antes de habilitar qualquer fluxo. |
| COMANDO | Verificação visual do prefixo no dashboard; não exibir o token. |
| RESULTADO ESPERADO | Ambiente identificado como teste; se o prefixo não for `TEST-`, interromper. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Executar matriz E2E |
| ONDE | Staging/API final e painel Mercado Pago Test |
| AÇÃO | Testar cartão aprovado, recusado, pendente, parcelamento, Pix se habilitado, webhook válido/inválido/duplicado, referência externa, valor e moeda divergentes. |
| COMANDO | Usar apenas cartões e fixtures oficiais de teste; repetir entrega de webhook com o mesmo evento. |
| RESULTADO ESPERADO | Nenhuma cobrança real; um evento duplicado não duplica pagamento/pedido; divergências não aprovam pedido. |

## F. MELHOR ENVIO SANDBOX

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Confirmar sandbox |
| ONDE | Railway Variables e painel Melhor Envio |
| AÇÃO | Configurar token sandbox e `MELHOR_ENVIO_MODE=sandbox`. |
| COMANDO | Conferir o valor no dashboard sem revelar token. |
| RESULTADO ESPERADO | A API usa `sandbox.melhorenvio.com.br`; se estiver em `production`, interromper. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Executar matriz E2E |
| ONDE | Staging/API final |
| AÇÃO | Testar cotação, serviço existente/inexistente, adulteração de custo/peso/dimensões, etiqueta, tracking e webhook válido/inválido/duplicado. |
| COMANDO | Tentar etiqueta antes e depois de pagamento aprovado. |
| RESULTADO ESPERADO | Backend recalcula frete; serviço inexistente falha; etiqueta somente após aprovação; nenhum frete real é comprado. |

## G. AUTH E2E

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Criar contas de teste controladas |
| ONDE | Supabase Auth e banco de staging/produção aprovado |
| AÇÃO | Usar `admin@dhelenas.com` somente se a conta já for autorizada; criar um usuário comum exclusivo de teste. |
| COMANDO | Login via UI/Supabase Auth; não registrar senha ou token em logs. |
| RESULTADO ESPERADO | Login, sessão, refresh, `GET /me`, role admin e logout funcionam. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Autorizações |
| ONDE | Browser/HTTP client autenticado |
| AÇÃO | Usuário comum tenta rota admin e consulta pedido de outro usuário. |
| COMANDO | `GET /api/orders/<id-de-outro-usuario>` e rota administrativa autenticada como usuário comum. |
| RESULTADO ESPERADO | Admin retorna 403 ao usuário comum; pedido alheio retorna 404/sem dados. |

## H. ASSETS BASE44

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Revisar inventário e destino |
| ONDE | Repositório: `BASE44_ASSET_INVENTORY.md`; Supabase Storage |
| AÇÃO | Confirmar bucket e políticas antes de qualquer cópia. |
| COMANDO | Planejar prefixes `products/`, `categories/`, `banners/`, `collections/`, `institutional/`. |
| RESULTADO ESPERADO | Manifesto origem → destino aprovado; URLs Base44 permanecem ativas. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Migrar e validar |
| ONDE | Ambiente controlado com credenciais autorizadas |
| AÇÃO | Copiar, validar hash/tipo, atualizar referências e testar UI antes de retenção/remoção. |
| COMANDO | Usar somente o script de migração após revisão explícita; nunca executá-lo com flags de aplicação sem backup/manifesto. |
| RESULTADO ESPERADO | Nenhum asset é apagado; rollback consiste em manter/restaurar a URL de origem enquanto ela estiver retida. |

## I. GO-LIVE FINAL

| Campo | Instrução |
| --- | --- |
| PASSO | 1 — Evidências finais |
| ONDE | PR #3, GitHub Actions, Railway, Cloudflare e painéis de teste |
| AÇÃO | Reexecutar lint, build, testes backend e todas as matrizes E2E acima. |
| COMANDO | `npm ci && npm run lint && npm run build`; em `backend/`: `npm ci && npm test`. |
| RESULTADO ESPERADO | CI verde e todas as evidências externas registradas sem segredos. |

| Campo | Instrução |
| --- | --- |
| PASSO | 2 — Decisão de merge/go-live |
| ONDE | Revisão da PR |
| AÇÃO | Só aprovar depois de todos os passos externos concluídos e sem bloqueadores. |
| COMANDO | Não há comando automático de merge neste roteiro. |
| RESULTADO ESPERADO | Decisão humana explícita; nenhuma publicação ou merge ocorre por este documento. |
