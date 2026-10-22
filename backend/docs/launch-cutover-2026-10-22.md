# D'Helenas — preparação local de 22/10/2026

Este registro cobre somente os bloqueios encontrados nesta retomada. Nenhuma
alteração em produção foi feita.

## Estado observado

- Backend `resourceful-joy`: deployment ACTIVE no commit
  `a7b991bbb031a8718ee979c59037324a1f19cf8d`; `/health` indicou banco
  conectado. A consulta pública de `settings` retornou manutenção ligada.
- Frontend `Dhelena`: deployment ACTIVE no commit antigo
  `7510a1562a7a444ae8ab44d06c29b91e5bc5c811`. A página pública ainda
  exibe “Loja temporariamente indisponível”. O código aprovado mais recente
  consulta a manutenção sem enviar token Auth; com resposta pública sintética
  `maintenance_mode=true`, a navegação local chegou a `/em-breve` e apontou
  para o Instagram oficial.
- O HTTP 409 visto nos logs saiu de `GET /api/auth/me`. O código o produz
  deliberadamente quando um usuário Auth tenta acessar um perfil admin legado
  de mesmo e-mail, mas outro UUID, sem vínculo explícito. O log não inclui a
  identidade da requisição; a atribuição a uma conta específica segue incerta.
- A conta Auth pessoal recém-criada está confirmada, mas ainda sem login ou
  sessão Auth. Não existe perfil com seu UUID, e a migration 016 ainda não foi
  aplicada. O perfil admin legado conserva 14 pedidos. Não há conflito de
  perfil para o e-mail confirmado da conta nova.
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
- `MERCADO_PAGO_MODE=production`. O processo ACTIVE ainda contém o trio
  `MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN`, `_WEBHOOK_SECRET` e
  `_APPLICATION_ID`, que tem precedência sobre as variáveis genéricas. O
  inventário **atual** do serviço não lista esse trio nem qualquer Application
  ID. Assim, a conexão de pagamento está pronta no processo atual, mas um
  novo deployment com o inventário visível pode falhar fechado com 503.
  Também há `RESEND_API_KEY` no processo ativo, ausente do inventário atual.
  Reconciliar variáveis efetivas e futuras antes de publicar o backend.
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
- O template de vínculo da migration 016 aceita a diferença entre e-mail
  pessoal e e-mail legado, exige sessão Auth recente e recusa conflito de
  perfil ou vínculo existente. O endereço nunca constitui prova de identidade.
- Migration 016 e template foram executados em PostgreSQL 16 local descartável,
  com dois UUIDs e e-mails fictícios distintos: sem sessão, o vínculo foi
  recusado; após sessão sintética, uma única linha ligou os UUIDs esperados.
  O banco de ensaio foi removido. Este teste não substitui a verificação do
  estado Supabase hospedado no instante da autorização.

## Portas ainda fechadas

1. A titularidade da conta pessoal e a autorização para assumir o perfil
   legado precisam ser confirmadas por contato independente. A titular deve
   fazer login antes de reconsultar `auth.sessions`; não solicitar senha/token.
2. A migration 016 e o vínculo exigem aprovação específica, após as fases
   de segurança já preparadas e suas pós-verificações. O vínculo muda somente
   a tabela privada `profile_auth_links`. O primeiro login após o vínculo
   sincronizará o e-mail confirmado no perfil legado, sem mudar nenhum UUID
   nem os relacionamentos históricos.
3. O novo Dockerfile precisa de push, CI e deploy manual autorizados
   separadamente. Antes do backend deploy, reconciliar o Application ID e os
   segredos de produção atualmente ausentes no inventário do serviço; inserção
   de novas credenciais deve ser feita diretamente no painel pelo titular.
   O frontend aprovado ainda requer deploy manual no mesmo SHA do backend.
   Manter manutenção ligada e Data API desligada. Verificar SHA, healthcheck,
   logs e origem CORS após cada deploy.
4. A chave `sb_secret_` exposta deve ser substituída em canal seguro. O backend
   usa a variável em Auth, Storage e consulta de capacidades; conferir também
   qualquer consumidor externo antes de revogar a chave antiga. Nunca inserir
   valores no repositório, frontend ou logs. Não alterar chaves legacy/JWT
   sem necessidade comprovada.
5. Pagamentos, etiquetas, SMTP, notificações, arquivamento dos 14 produtos e
   `operational_start` permanecem para autorizações produtivas próprias. Os
   SQLs guardados e testes sintéticos existentes continuam como base.
