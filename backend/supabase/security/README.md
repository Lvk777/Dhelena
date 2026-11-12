# D'Helenas: preparação da contenção do `public` no Supabase

**Estado: validado em PostgreSQL 17 local com dados sintéticos, não aplicado em produção.** A migração 014, o `schema.sql` antigo e os dados da loja ficam fora deste trabalho. Não executar este SQL na produção antes dos critérios abaixo. Manter manutenção ligada. O [relatório atual](VALIDATION-2026-10-12.md) registra as correções, testes e bloqueadores; o [relatório anterior](VALIDATION-2026-10-11.md) fica preservado como histórico.

## Repetir o ensaio sem dados de produção

Criar um banco **vazio**, em PostgreSQL local, com nome `dhelenas_audit_security_<identificador>`. Disponibilizar sua conexão em `TEST_DATABASE_URL` somente no ambiente do processo e executar `npm run test:security-postgres` dentro de `backend`. O runner recusa hosts remotos, nomes fora desse padrão e bancos com tabelas em `public`; não apaga nem recria bancos existentes. Requer Python 3 e dependências Node instaladas. O CI executa o mesmo ensaio com PostgreSQL 17 e Node 22.

O gerador preserva as 29 tabelas do snapshot e agora inclui os índices das migrations existentes, sem executar essas migrations. Índices parciais não constavam do snapshot anterior. Não usar esse gerador para restaurar produção. O ensaio testa PostgreSQL, backend HTTP e um substituto HTTP local de Auth; não reproduz GoTrue, PostgREST ou Supabase Storage hospedados.

## Evidência de origem (11/10/2026)

- [Snapshot de metadados](snapshot-public-2026-10-11.json): 29 tabelas `public`, 400 colunas, 94 constraints (29 chaves primárias, 15 únicas, 30 estrangeiras e 20 verificações), zero políticas, zero funções/views/triggers públicos relevantes; RLS desligado nas 29. O snapshot contém estrutura e ACLs, sem linhas de clientes.
- As 29 tabelas pertencem a `postgres`. A consulta `current_user, session_user` executada pela conexão real do serviço Railway retornou `postgres, postgres`. Esse usuário proprietário contorna RLS sem `FORCE ROW LEVEL SECURITY`; não é o papel `service_role`.
- As 400 colunas foram verificadas quanto a ACL própria: zero concessões explícitas por coluna. A migração aborta se isso mudar, e o pós-teste confere privilégios efetivos por coluna.
- `anon` e `authenticated` têm privilégios amplos nas 29 tabelas. `service_role` tem concessões existentes, que esta migração preserva. Há privilégios padrão para objetos criados por `postgres` **e** por `supabase_admin`.
- O editor SQL acessível opera como `postgres`; `pg_has_role(current_user, 'supabase_admin', 'MEMBER')` retornou `false`. Portanto, ele não pode corrigir os defaults de `supabase_admin`.
- Supabase Auth (`auth.users`) e Storage (`storage.objects`, `storage.buckets`) já têm RLS, e o SQL proposto não toca seus esquemas. O bucket de mídia é público para leitura de imagens, por decisão funcional separada.
- No código atual, o navegador usa Supabase Auth, sem `supabase.from(...)` nem `/rest/v1` para entidades; operações da loja usam a API Express e conexão PostgreSQL. Upload usa o serviço de Storage pelo backend. Não apareceu uso direto de tabelas por `service_role` no código.
- Logs PostgREST do período disponível (24 h no plano Free) mostraram zero eventos. Isso **não prova** inexistência de consumidores externos fora da janela nem de integrações não presentes no repositório.
- O painel de Backups do projeto Free informa que não há backup gerenciado disponível. Não foi confirmado backup lógico recuperável da produção. O PostgreSQL 16 local foi usado como staging sintético; o banco de produção é PostgreSQL 17.6, e o `pg_dump` 16 local não pode produzir seu dump. Docker Desktop continua sem daemon ativo: iniciar o serviço exigiu permissão indisponível nesta sessão.

### Verificações locais concluídas

- Os arquivos SQL de fases 1/2, recuperação e pós-teste foram analisados por `pglast` sem erro de sintaxe. A lista explícita da fase 1 coincide com as 29 tabelas do snapshot; a fase 2 contém os mesmos 29 nomes.
- `cd backend && npm test`: **201 testes aprovados, zero falhas**. Eles usam mocks e não executaram pagamentos ou pedidos reais. Essa regressão valida o código atual, mas **não** comprova o comportamento da migração no PostgreSQL.
- As fases 1 e 2, os testes efetivos de privilégios e a recuperação limitada passaram no PostgreSQL local isolado. O backend Express no modo local passou com dados sintéticos. Supabase Auth, Storage e Data API não existem nesse staging e continuam sem teste integrado após a alteração.

## Mudança preparada

[Fase 1, revogação](2026-10-11_01_revoke_direct_access.sql), [fase 2, RLS](2026-10-11_02_enable_rls.sql) e [recuperação limitada](2026-10-11_03_safe_rls_recovery.sql):

1. Confere papel executor, inventário exato, proprietários, estado inicial de RLS e ausência de políticas. Falha antes de alterações se houver divergência.
2. **Fase 1, transacional:** revoga `ALL PRIVILEGES` de `anon` e `authenticated` nas 29 tabelas nomeadas. Retira concessões padrão de `postgres` a `anon`, `authenticated` e `service_role` para futuras tabelas, sequências e funções no `public`. Preserva os grants atuais de `service_role` nas 29 tabelas. A verificação final impede commit se permanecer ACL direto ou público nas tabelas.
3. **Fase 2, transacional:** ativa RLS nas mesmas 29 tabelas, sem `FORCE` e sem políticas. Confere 29/29 antes do commit. A fase 1 continua bloqueando acesso direto caso a fase 2 falhe.
4. Em operação autorizada separada, desligar **Enable Data API** e **Automatically expose new tables and functions** no painel, após ensaio isolado. O frontend de Auth e o backend direto devem continuar funcionando, mas isso requer teste. Não fazer mudança de painel agora.

Nenhuma política RLS é necessária para o fluxo atual, porque nenhum cliente deve acessar as tabelas diretamente. Para um futuro consumidor da Data API, criar uma superfície explícita e revisada, com `GRANT` mínimo e política por usuário; nunca conceder acesso geral às tabelas privadas. Não usar política genérica `USING (true)`.

O default ACL de `supabase_admin` permanece como dependência da plataforma. O teste PostgreSQL local demonstrou que uma tabela nova criada por esse papel ainda concede `SELECT` a `anon`. Após desligar a exposição automática em um **staging Supabase completo**, repetir o postcheck para ver se a plataforma o corrige; se persistir, manter a Data API desligada e solicitar orientação do Supabase antes de declarar cobertura definitiva de objetos futuros. Funções PostgreSQL também herdam `EXECUTE` de `PUBLIC` em nível global salvo revisão específica; não há funções `public` hoje, e a migração evita alterar o default global para não afetar Auth/Storage.

## Dependências antes da autorização de produção

1. Complementar o staging PostgreSQL local já validado com um **staging Supabase completo** para Auth, Storage e Data API, usando somente dados sintéticos; ou restaurar backup real em projeto separado com proteção adequada e serviços externos desativados. Nenhum dado pessoal real deve entrar em staging desprotegido.
2. Criar backup lógico completo com cliente PostgreSQL **17 ou superior** ou Supabase CLI compatível, em armazenamento criptografado fora do repositório. Injetar credenciais por mecanismo protegido, sem colocá-las na linha de comando, logs ou histórico. Conferir hashes, tamanhos, contagens e **restaurar em projeto isolado e protegido** antes da janela de produção. O plano Free não fornece backup gerenciado; [a documentação recomenda dump próprio e cópia externa](https://supabase.com/docs/guides/platform/backups). Ver [procedimento detalhado](VALIDATION-2026-10-11.md).
3. Fazer inventário de consumidores externos da Data API com responsáveis pelas integrações. Janela de logs de 24 h é insuficiente para excluir clientes esporádicos. Validar que não há Edge Functions, automações, BI ou scripts fora deste repositório.
4. Confirmar a forma de provisionamento de `profiles` após Supabase Auth `signUp`: não há trigger ativo em `auth.users` no snapshot. Esse fluxo precisa passar no staging, pois o cadastro do Express é desabilitado em produção.
5. Verificar mecanismo de backup dos **objetos** de Storage separadamente, se recuperação integral do projeto for exigida; dump SQL inclui metadados, não os arquivos.

## Ensaio isolado e evidências exigidas

- Antes/depois: executar [postcheck de metadados](2026-10-11_public_rls_postcheck.sql). Após a fase 1: 29 tabelas, `direct_or_public_table_grants=0`, `effective_column_access_tables=0`, `postgres_public_default_grants=0`; após a fase 2: `rls_enabled_no_force=29`, `public_policies=0`. O contador de defaults de `supabase_admin` pode continuar positivo e deve ser registrado.
- Usando chaves **somente de staging**, chamar uma tabela privada pela Data API como `anon` e `authenticated`: leitura e escrita devem falhar sem revelar linhas. Acesso à linha de outro usuário também deve falhar. Repetir com Data API desligada: endpoints REST de dados indisponíveis.
- Exercitar login, cadastro e perfil; catálogo/categorias; carrinho/cupom; administração; upload e leitura de mídia; pedido apenas com mocks; concorrência e integridade de estoque. Confirmar que as chamadas de backend, feitas como `postgres`, continuam funcionando. Não criar pedido/pagamento real.
- Executar regressão do backend e verificar logs de autorização (403/42501 inesperados), erros de Auth/Storage, consultas do Express e estado do Advisor. Registrar resultados e aprovar janela somente se tudo passar.

## Execução autorizada em etapas

1. Manutenção ON; congelar DDL e deploys; verificar backup restaurado e snapshot atualizado. Reconciliar a lista de 29 tabelas e consumidores externos. Se houver drift, **não executar**.
2. Em staging, desligar Data API/exposição automática e rodar todo o ensaio. Em produção, após autorização explícita, desligar Data API/exposição automática e verificar Auth/Storage e backend.
3. Executar o arquivo da fase 1; conferir [postcheck](2026-10-11_public_rls_postcheck.sql) e smoke tests. Executar o arquivo da fase 2; conferir novamente e repetir smoke tests.
4. Observar logs e Advisor; manter manutenção até validação da loja e autorização operacional independente para abertura.

## Recuperação sem reabrir dados privados

- Antes de cada `COMMIT`, erro ou `ROLLBACK` desfaz a transação daquela fase. Não executar o `schema.sql` antigo nem restaurar grants `anon`/`authenticated` para "voltar ao normal".
- Se a fase 2 falhar após a fase 1, deixar fase 1 aplicada: backend `postgres` continua proprietário, acesso direto continua revogado. Corrigir a causa e reaplicar apenas a fase 2 após revisão.
- Se uma função da loja falhar após commit, manter manutenção, identificar a consulta e reparar o papel/objeto específico do backend. Caso o problema seja comprovadamente causado pela fase 2, a [recuperação limitada](2026-10-11_03_safe_rls_recovery.sql) pode desligar RLS das 29 tabelas **somente após** verificar que grants públicos e privilégios efetivos por coluna continuam ausentes; a fase 1 permanece aplicada. Não religar Data API nem restaurar grants sem diagnóstico e autorização.
- Para perda/corrupção de dados, restaurar o backup **em projeto separado** e validar consistência antes de qualquer corte. O snapshot JSON não é backup de dados. Guardar eventuais dados escritos após o dump antes de troca de projeto; restaurar dump antigo diretamente sobre produção pode perdê-los.

## Riscos remanescentes

- Apesar do ensaio PostgreSQL local, sem backup **real** restaurado e sem ensaio integrado de Auth, Storage e Data API, a proteção **não está pronta para aplicação**.
- Consumidor externo da Data API fora dos logs de 24 h pode parar de funcionar.
- `supabase_admin` conserva default ACL interno; objetos futuros requerem controle da plataforma, Data API desligada e revisão de cada DDL.
- `postgres` é papel poderoso e contorna RLS como proprietário. O backend continua dependendo da proteção da conexão e da autorização na API; uma futura migração para papel restrito exigirá políticas e testes próprios.
- Não se verificou o fluxo completo de cadastro/perfil nem Storage em staging; ausência de trigger de perfil é risco funcional independente.

Fontes: [segurança da API](https://supabase.com/docs/guides/api/securing-your-api), [segurança dos dados](https://supabase.com/docs/guides/database/secure-data), [backups](https://supabase.com/docs/guides/platform/backups), [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
