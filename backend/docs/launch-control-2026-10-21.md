# Portas de lançamento — leitura de 21/10/2026

Este documento registra a preparação local. Nenhum deploy, SQL de escrita, backup de dados reais, envio de e-mail, pagamento ou alteração de configuração foi executado.

## Código e Railway

- PR #3 permanece aberta. O remoto `codex/production-hardening` avançou por dois commits de visibilidade de senha até `86addfe022eeaf86008faedc52bf299c78c9aac5`; o worktree foi sincronizado por fast-forward, preservando as mudanças locais. Os checks desse SHA passaram: backend, frontend e os três jobs PostgreSQL 17. Os dois commits locais posteriores ainda exigem CI após eventual push autorizado.
- `resourceful-joy` e `Dhelena` estão online. Auto deploy está desativado nos dois. A interface dos dois ainda informa que deployments estão pausados temporariamente.
- Backend ativo anterior: deployment `dc9617c1-0b65-417c-8448-38b9b97b414b`. Frontend ativo anterior: `204e19d6-cfc4-43c2-af05-1b7101ec9074`. Ambos exibem o commit `7510a15` pela mensagem de commit. Confirmar o SHA nos detalhes antes de usá-los como alvo de recuperação.
- `/health`: `status=ok`, `database=connected`. A API pública confirmou `maintenance_mode=true`. Data API Supabase está desativada. `TRANSACTIONAL_EMAIL_ENABLED=false`; as flags de solicitação de arrependimento, compra de etiqueta, worker de rastreamento e gestão administrativa não constam no serviço backend. A chave Resend consta; as três variáveis de remetente/resposta/lista permitida contêm endereços do domínio `dhelenas.com`, verificados em memória sem registrar os valores.

### Implantação manual preparada, ainda bloqueada

1. Reconfirmar que a pausa Railway terminou, auto deploy continua OFF, manutenção ON, Data API OFF e PR/remoto ainda apontam para o SHA aprovado. Resolver primeiro o vínculo administrativo descrito abaixo; não autorizar o deploy como se o painel estivesse validado.
2. Registrar os IDs e SHAs dos deployments ativos. Após push autorizado e CI aprovado, selecionar no backend somente o novo SHA aprovado, sem mudar variáveis ou executar pre-deploy migrations. Verificar o SHA mostrado na prévia antes da ação final.
3. Aguardar healthcheck `/health` e serviço ACTIVE. Examinar logs por erros de inicialização, banco e rotas sem copiar payloads ou dados pessoais. Fazer GET de catálogo, manutenção, `/api/auth/capabilities` e rotas seguras; não criar pedidos ou cobrar.
4. Só então selecionar o mesmo SHA no frontend. Confirmar ACTIVE, navegação em manutenção, `/assets` com arquivo versionado e cache adequado, catálogo, sacola e painel com conta administrativa validada. Conferir contagens históricas sem abrir dados pessoais nem reprocessar transações.
5. Se um serviço falhar, manter manutenção ON e voltar apenas esse serviço ao deployment anterior registrado, verificando SHA, `/health`, navegação e logs. Não reverter banco por um erro de código. A reversão produtiva também requer ação autorizada.

## Supabase: estado atual e ordem

- `public`: 29 tabelas, zero com RLS, zero políticas, 464 concessões diretas/PUBLIC e acesso efetivo por coluna nas 29 tabelas; grants padrão de `postgres` e `supabase_admin`: 36 cada. Data API permanece OFF.
- O esquema tem 407 colunas e 94 constraints. As sete colunas da migration 014 já existem (2 em `categories`, 5 em `collections`); removendo-as da assinatura, as 400 colunas anteriores mantêm MD5 `92e13b0f0ee075b1ade55fe05da60ce2`. A assinatura das 94 constraints é `ebf2a217ce0c61f04bc60b3e39df8350`.
- Migration 015: zero das quatro colunas. Tabelas 016 e 017: ausentes. A ordem ensaiada com dados sintéticos é 014 já presente → fase 1 de revogação → fase 2 de RLS → 015 → 016 → 017. O ensaio adicional está em `rehearse_post014_local.mjs` e passou em PostgreSQL local 16 UTF-8, com 31/31 tabelas protegidas e zero acesso direto de clientes. Os jobs PostgreSQL 17 da PR também passaram no esquema anterior à 014.
- Há um perfil `admin`, nenhum usuário Auth com o mesmo UUID, e um possível candidato de e-mail com UUID diferente. Essa coincidência **não** autoriza vínculo. O código recusa a reivindicação automática desse perfil. É preciso identificar a sessão Auth da Juliane por prova independente, revisar o perfil e só então inserir vínculo explícito em `profile_auth_links` após a 016 e autorização específica. Não criar autoridade `owner` por inferência.
- `store-assets` é um bucket público, sem políticas próprias listadas. Não foram abertos nem copiados objetos. Teste de upload/recuperação hospedado continua pendente.

### Backup e recuperação antes de SQL produtivo

1. Aprovar destino criptografado e restrito, com chave guardada fora do repositório e do CI, prazo de retenção e responsável pela cópia. A janela deve manter manutenção ON e controlar escritas concorrentes.
2. Exportar roles, esquema e dados do banco, incluindo metadados de Auth e Storage; registrar versões do Postgres/CLI, tamanho, SHA-256 dos artefatos, contagens e assinatura do esquema. Não colocar credenciais em argumentos, logs, chat ou arquivos versionados.
3. Copiar **separadamente os bytes** de todos os objetos do Storage. Guardar manifesto protegido com bucket, caminho, tamanho e SHA-256; conferir cardinalidade e somas. Backup SQL isolado não contém os bytes dos objetos.
4. Restaurar em destino protegido e descartável, com acesso limitado. Verificar roles/grants/RLS, constraints, contagens, Auth, leituras de objetos e hashes do manifesto. Não usar dados reais para testes funcionais em staging comum. Se a restauração integral não puder ser comprovada, não iniciar o corte.
5. Antes de aplicar cada fase, repetir snapshot somente de metadados e comparar com o estado acima. Executar os arquivos SQL exatos em transações separadas, com postcheck entre elas. Erro antes de `COMMIT`: `ROLLBACK`. Depois da fase 1, manter grants revogados mesmo se a fase 2 falhar. Qualquer recuperação pós-commit exige autorização e validação do estado corrente; não restaurar acesso amplo a `anon`/`authenticated`.

Arquivos SQL e SHA-256:

| Fase | Arquivo | SHA-256 |
| --- | --- | --- |
| Revogar grants | `backend/supabase/security/2026-10-11_01_revoke_direct_access.sql` | `acc929e7364884982e477e911af7f2b06f82c991f2f4ec9b7989191b5bece7e0` |
| Ligar RLS | `backend/supabase/security/2026-10-11_02_enable_rls.sql` | `442beece3ac02b25ab8a566bfd06607ba5564e678a35646c1816aed3683b267e` |
| Verificação | `backend/supabase/security/2026-10-11_public_rls_postcheck.sql` | `84c2a1ff3513bd85d3d94a45d6bb0c00d5588e21fa190a59e86325890074dbca` |
| Fila de e-mails | `backend/migrations/015_notification_outbox.sql` | `472822d887a40576dd6e4a0d9b77d2809bac52c6603ae813b043b05cea01a385` |
| Vínculo Auth | `backend/migrations/016_profile_auth_links.sql` | `01a7dd0edb8d58eeede9e36c28f93b4943b42c23007b797acadb0d1495a20615` |
| Autoridades | `backend/migrations/017_admin_authorities.sql` | `ff7e37f031dd0b6be818d52dd64e78505311d977ce2e19ec0c4d7d6b4b4cea30` |

O Supabase ainda bloqueia projeto Free adicional nesta conta (limite de 2 projetos ativos). A alternativa sem assinatura é stack Supabase local com dados fictícios; o Docker Desktop instalado estava sem daemon nesta verificação. Ela pode ensaiar GoTrue, Storage e Mailpit, mas não substitui uma restauração protegida dos dados reais nem a homologação hospedada de SMTP/Google.

## Loja vazia e e-mail/Auth

- A prévia dos 14 SKUs, a transação SQL com guards e a reversão condicionada continuam em `launch-zero-production-preview-2026-10-21.md`. Reconfirmar os 14 IDs e ausência de `operational_start` **depois** do deploy autorizado e antes de qualquer escrita; cancelar se houver divergência. O código preserva registros históricos e apresenta lucro como “A apurar” após venda paga sem custos conciliados.
- Supabase Auth: cadastro e confirmação de e-mail estão ligados, Google está habilitado, Site URL é `https://dhelenas.com`, e o único redirect permitido é `https://dhelenas.com/auth/callback`. SMTP customizado está desligado e os templates são os padrões Supabase; notificações de pedidos no backend seguem OFF. Não houve envio.
- Configuração futura de SMTP, sujeita a autorização: host `smtp.resend.com`, porta TLS/SSL `465`, usuário `resend`, senha de API Resend inserida por canal seguro, remetente de domínio verificado aprovado pela Juliane e nome `D'Helenas`; revisar rate limits, links e templates antes de habilitar. O segredo do Railway não se propaga automaticamente ao Supabase Auth.
- Ensaios de Auth/Storage local, caixas fictícias e envio controlado permanecem separados da produção. Não habilitar SMTP ou notificações até validar remetente, URLs, entrega, recuperação, mudança de e-mail e Google PKCE.

## Autorizações distintas necessárias

1. Destino protegido e operação de backup/restauração verificada, mais janela de segurança Supabase para fases 1/2 e migrations 015–017; vínculo administrativo da Juliane requer identidade comprovada e SQL próprio.
2. Depois de removida a pausa Railway e validado o acesso administrativo, deploy manual backend → frontend do SHA acima, com recuperação pelos deployments anteriores.
3. Depois do deploy, snapshot dos 14 produtos e `operational_start`, seguido de autorização específica da transação de arquivamento/marco.
4. Ativação SMTP, ensaios com caixas autorizadas, pagamentos/etiquetas reais e abertura pública são decisões posteriores separadas.
