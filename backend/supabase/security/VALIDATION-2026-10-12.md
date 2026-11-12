# Segurança Supabase — execução de 12/10/2026

## Resultado e limite da entrega

**RLS de produção bloqueado para aplicação.** As correções de código e o ensaio PostgreSQL 17 foram executados. Não há backup real restaurado nem projeto Supabase de staging disponível na organização D'Helenas. Nenhuma revogação, alteração de RLS, trigger de Auth ou configuração de Data API foi aplicada em produção. Manutenção confirmada `true` por consulta somente leitura. Migration 014, webhook Mercado Pago e registros existentes permanecem intactos.

### 1. Backup real: bloqueado; incompatibilidade do cliente resolvida

- Instalado cliente **PostgreSQL 17.11** por arquivo oficial EDB, indicado pelo [site PostgreSQL](https://www.postgresql.org/download/windows/), sem Docker ou instalação de serviço Windows.
- Fonte: [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries), download `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616`. SHA-256 calculado do arquivo: `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`. É hash local de integridade, não comparação com assinatura publicada pelo fornecedor.
- Binários: `C:\Users\vitor\AppData\Local\DhelenasTools\postgresql17\pgsql\bin`. `pg_dump --version` e `pg_restore --version`: 17.11.
- O destino criptografado autorizado não foi informado. A resposta à pergunta apenas repetiu o texto da pergunta. `manage-bde -status C:` não conseguiu verificar BitLocker por falta de privilégio administrativo. ACL restrita não comprova criptografia; a pasta OneDrive do projeto não foi usada para dumps.
- Nenhuma credencial de produção foi extraída ou colocada em comando, repositório ou log. A conexão PostgreSQL de produção por session pooler ainda precisa ser disponibilizada por canal protegido ao processo.
- **Não foi feito dump de produção.** Antes dele: destino criptografado confirmado, autorização específica do destino/operação, retenção, responsável pela chave e ambiente de restauração protegido. Usar variáveis libpq efêmeras; nunca URL com senha na linha de comando. Incluir roles, schemas e dados conforme [backup/restore Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### 2. Restauração real: pendente; ferramenta ensaiada com dados sintéticos

- Criado cluster PostgreSQL **17.11**, separado do PostgreSQL 16 já instalado, com bind em `127.0.0.1:55417`, autenticação SCRAM e diretório restrito ao usuário/SYSTEM, fora do repositório e do OneDrive. Contém somente fixtures sintéticas.
- Banco `dhelenas_audit_security_pg17_verified`; dump custom feito com `pg_dump 17.11`; restauração transacional com `pg_restore --exit-on-error --single-transaction` em `dhelenas_audit_security_restore_verified`.
- Dump sintético: **93.071 bytes**, SHA-256 `29AE6D6145DC92B817E8A94FCD9C0EB980A1F14E6D4CC3D0EB97B0AE125C9C96`. As **29 tabelas / 66 linhas** tiveram contagens e hashes de conteúdo comparados entre origem/restauração: iguais. RLS 29/29, grants diretos zero e defaults `postgres` zero após restaurar.
- Isso prova o funcionamento das ferramentas e o ensaio sintético; **não comprova recuperação de dados reais, roles do Supabase, Auth ou Storage**. Os roles de teste já existiam no cluster de restauração.
- Objetos Storage exigem cópia separada dos arquivos, inventário e hashes por objeto/bucket; backup PostgreSQL inclui metadados, não os bytes dos objetos. Essa etapa permanece não executada. [Limitação oficial](https://supabase.com/docs/guides/platform/backups).

### 3. Cadastro e profiles: correção implementada e testada isoladamente

- `signUp` continua no Supabase. Enquanto aguarda confirmação, não se cria um perfil a partir de dados enviados pelo navegador. No primeiro acesso autenticado, `getUser(token)` valida a identidade e o backend cria o perfil ausente com `id = auth.users.id` e papel literal **customer**.
- Confirmação de e-mail exigida; usuários anônimos rejeitados. `role`, ID e permissões vindos de metadados do cliente não são usados. Nome é limitado a 200 caracteres. O marcador de senha não é uma senha/bcrypt válida.
- Transação, advisory lock por e-mail verificado, releitura e `ON CONFLICT DO NOTHING` impedem duplicação e sobrescrita por concorrência/trigger. Perfis existentes mantêm campos e privilégios atribuídos no servidor.
- Compatibilidade já prevista pelo projeto preservada: um único perfil legado associado ao e-mail confirmado mantém seu UUID e referências de pedidos. Não houve backfill nem reatribuição automática de UUIDs. E-mails ambíguos geram 409, sem selecionar arbitrariamente um perfil.
- Falha do banco/timeout gera 503 sem perfil parcial e permite nova tentativa. Frontend não converte falha do Supabase em tentativa de login Express. Backend não aceita JWT Express quando Supabase está configurado.
- **12 testes unitários novos** e **7 cenários HTTP/PostgreSQL** passaram, incluindo 12 primeiras requisições simultâneas, PATCH malicioso, admin existente, perfil legado, identidade inválida/não confirmada, ambiguidade e lock timeout seguido de sucesso.
- O serviço Auth desse ensaio é um servidor HTTP local que simula `getUser`, usando o SDK real. **Cadastro/OTP/GoTrue hospedado ainda não homologado.** Nenhuma configuração de Auth de produção foi modificada.

### 4. Estoque: causa comprovada e ensaio corrigido

- O banco do ensaio anterior `dhelenas_audit_rls_20261011` tinha **zero** dos dois índices únicos parciais de `stock_restorations`. O snapshot continha constraints, mas não índices parciais; o gerador não os criava.
- Produção consultada somente para metadados: ambos os índices estão presentes, com unicidade por item cancelado e por item devolvido, exatamente como migration 011.
- `build_local_fixture.py` agora inclui o DDL de índices das migrations existentes. `postgresConcurrency.mjs` exige ambos os índices antes de começar e usa identificadores sintéticos únicos para permitir novas execuções sem apagar pedidos anteriores.
- Não se alterou a expectativa `[false,true]`: é o contrato correto para a mesma reposição idempotente. O erro com status 409 era a proteção contra quantidade excessiva atingida no esquema incompleto do teste, não evidência de RLS quebrado. Esquemas sem esses índices não podem ser considerados seguros contra duplicações concorrentes.
- **4 cenários de estoque passaram** em PostgreSQL 16 e 17, incluindo apenas uma restauração, um movimento e quantidade final correta. **5 cenários de cupom/pedido sintético** passaram; nenhum provedor financeiro foi chamado. Nenhum pedido/movimento de produção foi alterado.

### 5. Staging Supabase: pendente; staging PostgreSQL 17 validado

- Painel da organização D'Helenas mostra **um projeto**, de produção; não há staging existente nessa organização. Não foi contratado serviço nem criado projeto com novas credenciais.
- `rehearse_local.mjs` recusa host remoto, nome não autorizado e banco não vazio. Usa snapshot e fixtures; remove variáveis de integrações externas do processo filho.
- Fases 1 e 2 originais executadas em banco vazio; `anon` e `authenticated` negados; proprietário/backend e `service_role` simulado operacionais. Recuperação limitada ensaiada e RLS reaplicado, sem reabrir grants.
- Smoke HTTP passou: cadastro/login Express, perfil, catálogo, endereços, administração com 401/403, carrinho/cupom, lista de pedidos e upload/leitura em disco local. Pedidos, estoque e Auth simulado são exercitados nos testes adicionais.
- **PostgREST, Storage remoto, signup/OTP real e interface completa do carrinho não foram validados nesse ambiente.** Não equiparar PostgreSQL + mock Auth a Supabase completo.

### 6. RLS e privilégios padrão: preparado, aplicação bloqueada

- Scripts existentes das fases 1/2/recuperação/pós-teste preservados. Após o ensaio PG17: **29/29 RLS, zero grants diretos/PUBLIC, zero acesso efetivo por coluna, zero defaults postgres, zero políticas**.
- Defaults de `supabase_admin` permanecem: no PG17 sintético, 36 entradas (inclui MAINTAIN). O teste confirma que uma tabela futura desse papel pode ganhar acesso direto. Produção confirma `pg_has_role(current_user,'supabase_admin','MEMBER') = false`.
- Solução operacional preparada: **desativar Data API em produção na janela especificamente autorizada**, manter Auth/Storage nas APIs próprias e exigir revisão antes de religar. Não tentar escalar privilégios para editar role interno. Desativação e isolamento dos defaults precisam ser ensaiados no projeto Supabase separado. [Controles oficiais da Data API](https://supabase.com/docs/guides/api/securing-your-api).
- Inventário do código: entidades via Express; não foram encontrados `supabase.from`, `rpc` ou `channel` no frontend/backend; upload usa Storage no backend. Isso **não exclui consumidores externos**. Confirmação do responsável sobre integrações fora do repositório continua necessária.

#### Comparação do esquema atual com o snapshot

Consultas somente leitura confirmaram produção em PostgreSQL 17.6, 29 tabelas, 400 colunas, 94 constraints, zero políticas, zero views/funções públicas e zero triggers relevantes. RLS permanece 0/29; manutenção `true`.

O snapshot anterior omitia precisão/escala numérica e limites de `varchar`; foram capturados **36 modificadores de tipo**, sem dados de clientes, em `snapshot-type-modifiers-2026-10-12.json`. O gerador passou a preservá-los e a emitir UTF-8 explicitamente no Windows. Após esses ajustes, a assinatura lógica das 400 colunas é **`92e13b0f0ee075b1ade55fe05da60ce2`** e das 94 constraints é **`ebf2a217ce0c61f04bc60b3e39df8350`**, idênticas entre produção e staging PG17. O runner verifica ambas antes do ensaio. As primeiras diferenças eram perda de metadados/encoding do fixture, não alterações aplicadas na loja.

MD5 aqui é apenas identificador de comparação de metadados, não proteção criptográfica do backup. Os dois índices únicos de reposição foram conferidos separadamente em produção. Essa comparação não substitui o pós-teste de ACL/defaults e o inventário completo de índices/objetos que devem ser repetidos imediatamente antes do corte.

### 7. Testes e verificações

| Verificação | Resultado |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `VITE_API_URL=https://api.dhelenas.com npm run build` | PASS |
| Backend `npm test` | **213/213**, zero falhas/skip |
| Concorrência de estoque | **4/4 cenários**, PG16 e PG17 reais |
| Concorrência de cupom/pedido | **5/5 cenários**, PG16 e PG17 reais |
| Perfis HTTP + PostgreSQL + Auth simulado | **7/7 cenários**, PG16 e PG17 reais |
| Revogações/RLS/recuperação | PASS, PG16 e PG17 |
| Smoke HTTP backend/upload local | PASS |
| Dump/restore PG17 sintético | PASS, 29 tabelas/66 linhas e hashes iguais |
| Varredura dos artefatos preparados por padrões de credenciais | PASS; nenhum padrão detectado |
| `git diff --check` | PASS |

Os 16 cenários de integração são adicionais aos 213 testes unitários/HTTP mockados, não contagens de usuários ou operações reais.

### 8. Publicação

Commit/push limitados a `codex/production-hardening`. CI inclui novo job PostgreSQL 17, sem secrets de produção. PR #3 permanece aberta; nenhum merge ou alteração da main foi autorizado. Evidência dos checks/deploys será registrada na entrega pelo SHA publicado.

### 9. Sequência de produção, quando os bloqueadores forem resolvidos

1. Confirmar destino criptografado e autorização do backup; obter conexão por canal protegido. Fazer backup real e objetos Storage separadamente; restaurar e conferir integridade em ambiente protegido.
2. Disponibilizar Supabase staging; configurar integrações sem efeitos externos. Ensaiar signup/OTP, perfis, Auth, Storage, PostgREST e desativação de Data API, além do ensaio já automatizado.
3. Confirmar inventário de consumidores externos. Fixar o SHA aprovado, manutenção ON e congelar DDL/deploys. Repetir fingerprint e pós-teste somente leitura imediatamente antes do corte; interromper diante de drift inesperado.
4. **Pedir uma única autorização específica para o procedimento de produção**: desativar Data API/exposição automática, fase 1, verificações, fase 2, verificações e monitoramento. O commit/push desta entrega não concede essa autorização.
5. Aplicar fase 1 e conferir grants; aplicar fase 2 e conferir 29/29 RLS. Verificar backend/Auth/Storage e fluxos com mocks, sem pedidos reais. Manutenção continua ON.
6. Em falha, manter Data API desativada e grants revogados. Corrigir backend/objeto específico; recuperação limitada somente com autorização própria e sem restaurar grants. Perda de dados exige restauração em projeto separado e preservação de escritas posteriores, nunca sobrescrever produção automaticamente.

**Não solicitar autorização de corte como se os pré-requisitos estivessem cumpridos: backup real restaurável, staging Supabase e consumidores externos ainda bloqueiam o procedimento.**
