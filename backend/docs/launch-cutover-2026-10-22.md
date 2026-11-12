# D'Helenas — preparação local de 22/10/2026

Este registro cobre somente os bloqueios encontrados nesta retomada. Nenhuma
alteração em produção foi feita.

## Estado observado

- Backend `resourceful-joy`: deployment ACTIVE no commit
  `a7b991bbb031a8718ee979c59037324a1f19cf8d`; `/health` indicou banco
  conectado. A consulta pública de `settings` retornou manutenção ligada.
- Frontend `Dhelena`: deployment manual ACTIVE no commit
  `a7b991bbb031a8718ee979c59037324a1f19cf8d`. A página `/em-breve`,
  Instagram oficial, consulta pública de manutenção, botões de senha e cache
  de `/assets` foram conferidos. Os commits `d9fc69c` e `f5490db` foram
  enviados à branch com os checks da PR #3 aprovados; `9362978` foi
  incorporado ao checkout local e remove a frase dispensável do cadastro.
- O HTTP 409 visto nos logs saiu de `GET /api/auth/me`. O código o produz
  deliberadamente quando um usuário Auth tenta acessar um perfil admin legado
  de mesmo e-mail, mas outro UUID, sem vínculo explícito. O log não inclui a
  identidade da requisição; a atribuição a uma conta específica segue incerta.
- A titularidade da conta Auth pessoal e a autorização para assumir o perfil
  legado foram confirmadas pelo responsável por contato independente em
  22/10/2026. Auth UUID `37c39827-a18c-4dd7-9309-85cb06cb59a8`, criada
  às 12:54:06 UTC, confirmada às 12:54:40 UTC, último login às 20:29:38 UTC,
  uma sessão em `auth.sessions` e evento auditado `login` para o mesmo UUID.
  O login criou um perfil `customer` com esse UUID e e-mail da conta nova;
  as dez tabelas com chave estrangeira para `profiles` não têm linhas para
  esse perfil. O perfil admin legado `3432984f-e65e-40ab-a286-2f04ceccaded`
  mantém 14 pedidos e 53 auditorias. A migration 016 continua ausente.
- Há 14 produtos publicados entre 15 produtos totais. Os 14 SKUs publicados
  coincidem com a lista da prévia de arquivamento; `operational_start` não
  existe. As 29 tabelas `public` continuam sem RLS. Nenhuma escrita foi feita.
- Data API desligada e auto deploy do backend desligado. Os avisos
  `SecretsUsedInArgOrEnv` apareceram no build Nixpacks já publicado; o log
  não prova por si só quais camadas/artefatos contêm valores, mas o mecanismo
  merece substituição e nova rotação de segredos expostos.
- O processo ACTIVE usa uma chave Supabase com prefixo `sb_secret_` (somente
  comparação booleana, sem ler ou registrar o valor). A consulta de capacidades
  Auth e o banco respondem. Auth, Storage e essa consulta dependem da chave;
  não revogá-la antes de preparar substituta e conferir consumidores externos.
- `MERCADO_PAGO_MODE=production`. O processo ACTIVE contém o trio
  `MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN`, `_WEBHOOK_SECRET` e
  `_APPLICATION_ID`, que tem precedência sobre as variáveis genéricas. O
  inventário atual do serviço Railway mostra esses três nomes e
  `RESEND_API_KEY`. A presença dos nomes foi reconciliada; o valor e o escopo
  efetivos das credenciais novas não foram comparados com o processo ACTIVE.
  Validá-los sem expor segredos antes de qualquer deployment do backend.
- Supabase SMTP está habilitado via Resend. O template de confirmação de
  cadastro em produção continua no padrão inglês com `{{ .ConfirmationURL }}`.
  No teste com conta `logan.e@vectorzeta.com`, Auth confirmou o e-mail às
  21:25:29 UTC, sem criar sessão. O log Auth de 21:25:31 UTC registrou
  `code challenge does not match previously saved code verifier`. O motivo da
  divergência do verificador não foi determinado. Os templates pt-BR locais
  usam `{{ .TokenHash }}` com `verifyOtp` para não depender do verificador PKCE;
  ainda exigem autorização para configurar no Supabase e teste posterior.
- No processo ACTIVE, consultas GET de conexão ao Mercado Pago e Melhor Envio
  retornaram sucesso em produção. Uma cotação com CEPs e pacote fictícios
  retornou 12 opções, sem criar etiqueta. A consulta dos métodos Mercado Pago
  mostrou Pix, crédito e `debelo` para Elo Débito. Nenhum pagamento foi criado.

## Correções locais preparadas

- Dockerfile do backend usa Node 22, dependências de produção e `COPY` apenas
  de `src`; não declara `ARG` ou `ENV` com segredos. `.dockerignore` exclui
  arquivos de ambiente, testes e artefatos. Railway aponta para Dockerfile.
  Após um deploy autorizado, inspecionar o build real para confirmar que a
  configuração foi aplicada e que os avisos desapareceram.
- Produção não inicia migrations automaticamente se faltar o esquema. O
  processo encerra com falha; as migrations continuam a exigir operação
  manual aprovada.
- `multer` atualizado para 2.5.0; upload testado com imagem sintética e limite
  de 10 MB. Em produção, ausência do Storage responde 503 e não grava em disco
  efêmero.
- O SQL específico de vínculo da migration 016 agora exige o perfil `customer`
  provisionado com o UUID Auth, e-mail confirmado e ausência de relacionamentos;
  preserva ambos os perfis. O backend local prioriza o vínculo explícito
  antes do perfil cliente direto. O endereço nunca constitui prova de identidade.
  A operação com os dois UUIDs específicos está em
  `backend/supabase/security/2026-10-22_juliane_admin_link_PENDING_APPROVAL.sql`;
  esse arquivo não foi executado em produção.
- Migration 016 e template foram executados em PostgreSQL 16 local descartável,
  com dois UUIDs e e-mails fictícios distintos: sem sessão, o vínculo foi
  recusado; após sessão sintética, uma única linha ligou os UUIDs esperados.
  O banco de ensaio foi removido. Este teste não substitui a verificação do
  estado Supabase hospedado no instante da autorização.

## Portas ainda fechadas

1. Antes do vínculo, publicar o backend que prioriza o vínculo explícito,
   após reconciliar as variáveis de Mercado Pago, Resend e Supabase no Railway.
   Reconsultar a sessão e os relacionamentos no instante da operação.
2. A migration 016 e o vínculo exigem aprovação específica, após as fases
   de segurança já preparadas e suas pós-verificações. O vínculo muda somente
   a tabela privada `profile_auth_links`. Como já existe um perfil cliente com
   o e-mail Auth, o backend manterá os e-mails armazenados distintos, exibirá
   o e-mail Auth confirmado na sessão e retornará o perfil legado somente
   para o UUID Auth vinculado. Não muda UUIDs nem históricos.
3. O novo Dockerfile já foi enviado à PR #3; um deploy manual do backend ainda
   exige autorização separada. Antes dele, validar os valores e escopos do
   Application ID e dos segredos de produção presentes no inventário do serviço;
   qualquer ajuste deve ser feito diretamente no painel pelo titular.
   As novas correções locais de Auth e foco ainda requerem push, CI e deploy
   manual separados.
   Manter manutenção ligada e Data API desligada. Verificar SHA, healthcheck,
   logs e origem CORS após cada deploy.
4. A rotação de credenciais foi informada pelo responsável, mas os valores novos
   não foram comparados com o processo ACTIVE. Antes de substituir ou revogar
   qualquer chave, conferir os consumidores de Auth, Storage e consulta de
   capacidades sem registrar o valor. Não inserir credenciais no repositório,
   frontend ou logs.
5. Pagamentos, etiquetas, alteração dos templates de Auth, notificações,
   arquivamento dos 14 produtos e `operational_start` permanecem para
   autorizações produtivas próprias. Os
   SQLs guardados e testes sintéticos existentes continuam como base.
