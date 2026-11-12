# Validação do plano RLS — 11/10/2026

**Escopo:** somente os arquivos desta pasta e testes locais. Produção não foi alterada; Data API de produção continua ligada; manutenção continua ligada. Nenhum pagamento, pedido real, e-mail, merge ou migration 014 foi executado.

## Resultado medido

| Critério | Estado | Evidência e limite |
| --- | --- | --- |
| Backup e restauração de produção | **NOT TESTED / pendente** | Plano Free sem backup gerenciado; não foi extraída cópia real. Falta armazenamento criptografado aprovado, cliente PostgreSQL compatível e restauração protegida. |
| Dump e restauração sintéticos | **PASS** | `pg_dump -Fc` do staging local e `pg_restore -1` em outro banco local; 29/29 tabelas com RLS, grants diretos zero, defaults `postgres` zero, 3 perfis sintéticos, 1 produto e 2 categorias. O dump sintético tinha 76.869 bytes e SHA-256 `9E7CE907518C20DEBFC1207BCCED07A8A2B9D10DE81E6F026FC45A39DF883056`. Isso não comprova a recuperação de produção. |
| Staging PostgreSQL isolado | **PASS para SQL** | Serviço PostgreSQL 16 local já existente; banco novo `dhelenas_rls_stage_20261011`, estrutura gerada de [snapshot](snapshot-public-2026-10-11.json) e somente [dados sintéticos](synthetic_staging_data.sql). Bancos antigos não foram modificados. O isolamento é por banco, no mesmo cluster local; os quatro papéis de teste `NOLOGIN` são globais nesse cluster. Não é um projeto Supabase completo nem reproduz índices não incluídos no snapshot. Docker Desktop está instalado, mas o serviço não pôde ser iniciado por falta de permissão; a tentativa de abrir o app não deixou o daemon ativo. |
| Fase 1 | **PASS** | Executada só no staging. Pós-teste: 29 tabelas; grants diretos/públicos zero; acesso efetivo por coluna zero; defaults de `postgres` zero. Antes eram 406 entradas de ACL diretas e 33 de defaults `postgres` no PostgreSQL 16 local. |
| Fase 2 | **PASS** | Executada só no staging. Pós-teste: RLS ligado 29/29, sem `FORCE` e sem políticas. `anon` e `authenticated` receberam SQLSTATE `42501` em leituras e escritas; `postgres` leu e atualizou; `service_role` leu com `BYPASSRLS` simulado. |
| Recuperação limitada | **PASS** | Desligou RLS em 29 tabelas no staging após conferir ausência de grants; `anon`/`authenticated` continuaram bloqueados. Fase 2 foi reaplicada e o estado protegido, 29/29, foi confirmado. |
| Cadastro e `profiles` — Express local | **PASS** | Cadastro sintético via HTTP criou perfil; login e `/auth/me` funcionaram. |
| Cadastro e `profiles` — Supabase Auth | **NOT TESTED / bloqueador** | O staging não inclui GoTrue. No código, `signUp` não grava `profiles`; o cadastro Express retorna 404 em produção e não havia trigger em `auth.users` no snapshot. O provisionamento real precisa de solução e ensaio isolado. |
| Backend, catálogo, prévia de carrinho/cupom e administração | **PASS local** | Express apontado somente ao banco sintético: health, produtos, categorias, coleções, prévia de cupom, listagem de pedidos vazia, controle de acesso admin, leitura/escrita admin e upload em disco local. A interface completa do carrinho e Supabase Storage não foram ensaiados. |
| Pedidos sintéticos/estoque | **PASS parcial** | `couponConcurrency.mjs` passou no banco local protegido: idempotência, cupom, rollback, primeira compra e estoque. Não houve chamada a provedor, e as notificações estavam sem destinatários. O teste separado `postgresConcurrency.mjs` passou reserva e rollback, mas **FAIL** na expectativa da segunda reposição concorrente (`409` em vez de `false`); o banco registrou uma reposição e um movimento, sem duplicação. A falha do teste exige triagem separada; o backend é proprietário e contorna RLS, logo ela não demonstra falha de permissão. |
| Supabase Storage | **NOT TESTED** | Upload local passou; Storage real exige staging Supabase isolado. |
| Data API | **NOT TESTED no staging** | PostgreSQL local não inclui PostgREST. No projeto de produção, PostgREST registrou zero eventos na janela acessível de 24 h; Edge Functions implantadas: zero. Isso não exclui consumidores externos esporádicos. Data API de produção não foi alterada. |
| Privilégios padrão | **FAIL para cobertura futura completa** | O default ACL de `postgres` foi removido no staging e uma tabela nova sua ficou privada. O default ACL de `supabase_admin` manteve 33 concessões no pós-teste; uma tabela local criada por esse papel recebeu `SELECT` para `anon`. Em produção, `postgres` não é membro de `supabase_admin`, portanto não pode remover esse default diretamente. |

Os scripts originais das fases 1, 2, pós-teste e recuperação não precisaram de alteração. [Gerador de esquema local](build_local_fixture.py), [verificador de privilégios](verify_local_postgres.mjs) e [smoke HTTP local](verify_local_backend.mjs) são artefatos de teste. O `npm test` do backend havia passado com **201/201** testes mockados; esse resultado é distinto dos testes efetivos acima.

## Backup real: procedimento antes de qualquer aplicação

1. Confirmar um volume de destino **criptografado**, com acesso restrito e cópia externa protegida. Não usar repositório, pasta sincronizada sem criptografia verificada, logs, chat ou staging com dados pessoais. Definir retenção e responsável pela chave antes do dump.
2. Usar cliente `pg_dump` **17 ou mais novo**: produção informou PostgreSQL **17.6**. O cliente 16 instalado localmente recusa servidores de versão principal mais nova. A alternativa sem custo é habilitar o Docker Desktop já instalado com permissão adequada e usar ferramentas PostgreSQL 17/Supabase CLI, ou instalar somente o cliente PostgreSQL 17 de fonte oficial. Nenhuma delas foi configurada para a produção nesta execução. [Restrição do `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html).
3. Obter a conexão de **session pooler** pelo painel Supabase e disponibilizar suas partes ao processo de dump por mecanismo de segredo protegido. Não colocar URL completa ou senha em argumento de comando, histórico de shell, arquivo do projeto ou saída de ferramenta. Se usar libpq, fornecer `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` e `PGPASSWORD` apenas no ambiente efêmero do processo; limpar após a execução. Não registrar seus valores.
4. Seguir o [procedimento oficial Supabase CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) para **roles, schema e dados**; guardar todos os arquivos no volume criptografado. Fazer também cópia dos objetos Storage por procedimento próprio: dump de banco contém metadados, não os arquivos. [Limite do backup de banco](https://supabase.com/docs/guides/platform/backups).
5. Calcular hash SHA-256 e tamanhos sem abrir ou imprimir conteúdo. Restaurar em projeto Supabase **separado e protegido**, sem envio de e-mails, integrações financeiras ou exposição pública; verificar contagens, constraints, ACLs, Auth/Storage e operações críticas. Se não houver ambiente adequado para restaurar dados reais, manter **backup real não comprovado** e não aplicar em produção. O ensaio sintético não substitui esse requisito.

## Portões para um corte futuro autorizado

1. Confirmar backup real **restaurado**, staging Supabase com Auth/Storage/Data API testados e cadastro que cria `profiles`. Resolver a falha do teste de reposição ou classificá-la com evidência. Confirmar consumidores externos por inventário dos responsáveis; 24 h de logs não bastam.
2. Manter manutenção ON e congelar DDL/deploys. Executar [pós-teste](2026-10-11_public_rls_postcheck.sql) somente para leitura, comparar inventário de 29 tabelas e defaults com o snapshot. Qualquer drift interrompe o corte.
3. Na janela aprovada, desabilitar Data API e exposição automática no painel, verificando Auth, Storage e backend. Essa ação **não foi feita**. Enquanto `supabase_admin` conceder defaults, a Data API desligada é a barreira para objetos futuros; não religá-la sem revisão de grants.
4. Executar [fase 1](2026-10-11_01_revoke_direct_access.sql) e conferir: 29 tabelas, grants diretos/públicos zero, acesso efetivo por coluna zero, defaults `postgres` zero. Verificar catálogo, perfil existente e administração. Se falhar, manter Data API desligada e manutenção ON; não reabrir grants.
5. Executar [fase 2](2026-10-11_02_enable_rls.sql) e conferir RLS 29/29, zero políticas públicas, proprietário/backend `postgres` operacional. Testar Auth, Storage, catálogo, carrinho/cupom, admin e pedidos **somente com mocks**; observar `42501`, 403 e erros de aplicação.
6. Se a fase 2 causar falha comprovada, usar [recuperação limitada](2026-10-11_03_safe_rls_recovery.sql) **somente com nova autorização**; ela não devolve grants a `anon`/`authenticated`. Manter Data API desligada. Para perda de dados, restaurar em projeto separado e planejar corte sem sobrescrever escritas posteriores.
7. Manter manutenção até validação operacional e autorização independente para inauguração. Nenhum passo deste procedimento autoriza aplicação automática.

## Riscos ainda abertos

- Exposição de produção continua até aplicação autorizada; `supabase_admin` conserva defaults e o projeto ainda expõe a Data API.
- Backup real/restauração, Supabase Auth, Storage e PostgREST não foram ensaiados em ambiente completo.
- Consumidores externos fora do repositório ou dos logs de 24 h continuam desconhecidos.
- Cadastro Supabase pode não provisionar `profiles`; isso precisa de correção/teste próprio, separado da migration 014.
- A falha do teste de reposição concorrente deve ser triada antes de afirmar regressão de estoque totalmente limpa.
- `postgres` continua um papel poderoso que contorna RLS como proprietário; o controle de acesso no backend segue indispensável.
