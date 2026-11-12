# D'Helenas — porta de identidade, backup e contenção do Supabase

Preparação local em 21/10/2026. Nenhuma operação de escrita, exportação de dados,
mudança de configuração ou deploy de produção foi realizada. Reutiliza os ensaios
em `backend/supabase/security/VALIDATION-2026-10-12.md` e o estado registrado em
`backend/docs/launch-control-2026-10-21.md`; não substitui nova leitura de
metadados imediatamente antes da janela autorizada.

## 1. Comprovar a conta da Juliane sem credenciais compartilhadas

1. O responsável comercial confirma a identidade da Juliane por contato já
   conhecido (presencial ou chamada previamente combinada), nunca por e-mail
   recém-fornecido ou pelo mesmo endereço que está no perfil legado.
2. Em sessão privada, Juliane faz um **novo login normal** em D'Helenas com o
   provedor Supabase que controla. Ela própria digita senha, usa Google ou recebe
   eventual código. Ninguém pede ou copia senha, token, código ou cookie.
3. Antes e depois desse login, um operador autorizado consulta **somente leitura**
   no Supabase Auth o UUID imutável e o horário de último login do candidato.
   A nova sessão deve corresponder ao UUID observado. Se houver ambiguidade,
   o operador pode confirmar `auth.getUser()` na própria sessão autenticada,
   mostrando apenas `user.id` localmente e sem registrar o access token.
4. O responsável confere privadamente o UUID do perfil legado, seu papel admin,
   a inexistência de outro vínculo e a continuidade histórica dos pedidos por
   contagens agregadas. E-mail coincidente ou confirmado é só teste de
   consistência, **nunca prova suficiente**. Juliane e o responsável registram
   aprovação específica dos dois UUIDs em registro protegido, fora do chat e
   do repositório. Se a prova independente não estiver disponível, parar.

Estado lido: um perfil admin, zero Auth com o mesmo UUID, um Auth com e-mail
coincidente e UUID distinto, confirmado e com login anterior. Nenhuma conta foi
vinculada. O código rejeita a reivindicação automática do admin legado.

## 2. Destino de backup e restauração exigidos

**Destino preferido:** SSD externo dedicado, criptografado integralmente com
BitLocker To Go, montado apenas na janela aprovada e sob guarda da Juliane.
Confirmar `ProtectionStatus=On`, capacidade após inventário, ACL restrita ao
operador e chave de recuperação guardada separadamente no cofre da responsável.
Uma segunda cópia, também criptografada e separada fisicamente, evita que a
falha do único SSD destrua o ponto de recuperação. Não usar repositório, pasta
sincronizada, downloads, disco temporário nem o `C:` atual: a criptografia deste
computador não pôde ser verificada (`Get-BitLockerVolume` negou acesso).

**Alternativa sem SSD:** dois discos externos já disponíveis, com criptografia
integral verificável e guarda em locais separados. Se a organização já possuir
armazenamento de objetos empresarial, ele pode substituir a segunda cópia
somente após confirmar criptografia no cliente antes do upload, chave separada,
MFA, acesso mínimo, retenção/versionamento, região, capacidade e custo efetivo.
Uma pasta local criptografada no mesmo computador serve apenas para ensaio;
não constitui backup de recuperação contra perda desse computador. Nenhum
destino online ou pago deve ser criado nesta preparação.

**Restauração de prova:** stack Supabase local isolada, em volume criptografado,
sem egress para SMTP, pagamentos, webhooks ou clientes e com acesso restrito.
O Docker/stack local precisa estar operacional antes do ensaio; se não estiver,
obter outro destino isolado e criptografado aprovado. Dados reais restaurados
não entram no staging funcional comum. Descartar o volume de prova somente
depois da validação e por descarte da chave criptográfica.

Procedimento, após autorização específica do destino e da operação:

1. Registrar versões das ferramentas PostgreSQL 17+ e Supabase CLI, estimar
   tamanho do banco e bytes do Storage por metadados, reservar espaço para
   exportação, segunda cópia e restauração. Confirmar janela sem gravações:
   manutenção ON, e também controle dos escritores de webhooks/jobs/uploads;
   manutenção visual isolada não congela esses escritores.
2. Obter conexão e acesso Storage por gerenciador de segredos/sessão privada,
   sem URI com senha em argumentos, histórico, logs, documento ou chat. Gerar
   dump de roles, esquema e dados segundo o guia oficial Supabase, incluindo
   Auth e metadados de Storage. Usar `pg_dump` 17+ em formato custom como
   artefato adicional quando permitido. Não gravar intermediários fora do
   volume criptografado.
3. Copiar **todos os bytes dos objetos** de cada bucket separadamente por
   API/CLI autorizada. Produzir manifesto privado de bucket, caminho, tamanho,
   versão/ETag quando disponível e SHA-256. Registrar hashes SHA-256, tamanhos,
   contagens por tabela/bucket, assinatura do esquema e ACLs; não imprimir nomes
   de objetos ou dados pessoais nos logs. Verificar que o inventário não mudou
   durante a cópia; se mudou, reconciliar o delta ou refazer com escrita parada.
4. Restaurar roles, esquema e dados no ambiente isolado. Restaurar os objetos
   para o Storage isolado, sem envio de e-mail. Comparar contagens e checksums
   do dump, constraints, IDs/referências de pedidos, Auth, buckets e **todos**
   os hashes de objetos. Verificar leitura de uma amostra de cada bucket e o
   inventário integral. Testar apenas restauração/integridade, sem usar dados
   reais em testes funcionais. Registrar sucesso/falha e plano de retenção.
5. Se restauração, hashes ou consistência falharem, não iniciar SQL de
   segurança em produção. Uma restauração futura é feita primeiro em destino
   separado; jamais sobrescrever produção automaticamente, pois escritas após
   o backup precisariam ser preservadas.

O backup SQL contém metadados de Storage, mas não os arquivos. Referências:
[backups](https://supabase.com/docs/guides/platform/backups),
[backup/restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[download de objetos](https://supabase.com/docs/guides/storage/management/download-objects).

## 3. Ordem preparada para a janela de segurança, sem execução agora

1. Backup real restaurado e verificado; prova de identidade registrada;
   inventário dos consumidores externos da Data API confirmado. Manutenção ON,
   Data API OFF, auto deploy OFF. Congelar DDL/deploys. Comparar fingerprint
   atual do esquema e ACLs com o inventário esperado de 29 tabelas. Qualquer
   drift interrompe o corte; migration 014 já existente deve ser preservada.
2. Executar somente após autorização a fase 1
   `2026-10-11_01_revoke_direct_access.sql`. Confirmar 29 tabelas, zero grants
   diretos/PUBLIC, zero acesso efetivo por coluna e zero defaults de `postgres`.
   Verificar GETs públicos e backend. A fase é transacional; falha pré-commit
   reverte só essa fase.
3. Executar a fase 2 `2026-10-11_02_enable_rls.sql`; confirmar 29/29 com
   RLS, sem FORCE e sem políticas públicas, e repetir Auth, catálogo, Storage,
   backend e fluxos isolados. Se a fase 2 falhar, manter a fase 1 aplicada e
   Data API OFF. O script de recuperação limitada não repõe grants públicos.
4. Aplicar `backend/migrations/016_profile_auth_links.sql` **depois** das fases
   sobre 29 tabelas. Ela cria a 30ª tabela privada, com RLS e sem grants a
   `anon`, `authenticated` ou `service_role`; não vincula ninguém. Migration
   015 é independente deste vínculo; migration 017 e privilégio `owner` exigem
   autorização distinta. Não habilitar gestão de colaboradores nesta janela.
5. Com os UUIDs comprovados, substituir privadamente os dois valores sentinela
   do template `2026-10-21_verified_admin_link_TEMPLATE.sql`. Conferir a
   prévia e aprovar **essa inserção exata**; executá-la uma vez. Guardas exigem
   executor `postgres`, Auth confirmado, perfil legado admin, e-mails
   consistentes e inexistência de perfil/vínculo conflitante. A operação insere
   só `(auth_user_id, profile_id)`: não modifica UUIDs, papel, pedidos ou
   histórico. Nenhum UUID real entra no repositório ou chat.
6. Na sessão normal da Juliane, conferir `GET /api/auth/me` com o UUID do
   perfil legado e `role=admin`; abrir painel em leitura, catálogo, métricas
   agregadas e pedidos por contagem, sem expor compradores. Confirmar 401/403
   para conta fictícia não admin no ambiente isolado. Monitorar erros 409,
   403/42501 e Storage, sem registrar payloads. Se o vínculo falhar após
   commit, manter manutenção e aprovar reversão de **apenas aquele par** após
   releitura; nunca reescrever IDs de Auth, perfil ou pedidos.

Ensaios já aceitos: PostgreSQL 17 com dados sintéticos, restore de 29 tabelas,
fases 1/2 e recuperação, autenticação/checkout/concorrência locais; ensaio
pós-014 com migrations 015–017 em transação revertida. Eles não comprovam
restauração de dados reais nem integração hospedada completa Auth/Storage.

## Decisões pendentes

- Juliane e responsável: canal de confirmação independente e sessão de login
  normal; assinatura protegida do par de UUIDs verificados.
- Responsável: fornecer dois destinos criptografados ou aprovar equivalente,
  comprovar proteção/capacidade/retenção/chave e habilitar ambiente de
  restauração isolado; autorizar a exportação e cópia dos objetos separadamente.
- Responsável: confirmar com os operadores se há automações, BI, Edge Functions
  ou clientes externos da Data API fora do repositório; logs curtos não provam
  ausência de uso esporádico.
- Responsável: depois das evidências acima, autorizar por escrito a janela de
  fases 1/2, migration 016 e inserção do vínculo, cada uma com pós-teste.
