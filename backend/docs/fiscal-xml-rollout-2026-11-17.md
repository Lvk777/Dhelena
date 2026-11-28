# Importação de NF-e XML: preparação de publicação

Estado observado em 2026-11-17, sem escrita em produção:

- Railway backend e frontend: `14fcbaa8b8b1b1c2a77df75f195e76b00e612b5c`; deploy automático desativado nos dois serviços.
- Supabase PostgreSQL 17.6: `stock_reservations` (018) e colunas da fila (015) presentes; `admin_email_credentials` (021) e `fiscal_documents` (022) ausentes. O histórico de migrations do painel está vazio porque as migrations anteriores foram aplicadas fora do Supabase CLI. Confirmar cada mudança pelo esquema, nunca apenas pelo histórico do painel.
- `maintenance_mode=true`, Data API desativada e `TRANSACTIONAL_EMAIL_ENABLED=false` observados. Não alterar essas proteções durante a implantação.
- O plano Free informa que não oferece backups do projeto. **Não aplicar 022 até existir cópia íntegra restaurada e conferida em banco descartável.** Pode ser backup manual; não é necessário contratar plano para isso.
- O responsável adiou a decisão de backup. Nesta etapa, 022 permanece pendente e a importação fiscal fica desativada por padrão: `FISCAL_XML_IMPORT_ENABLED` no backend e `VITE_FISCAL_XML_IMPORT_ENABLED` no build do frontend só podem passar a `true` após a migration, conferência de esquema e autorização específica. Sem as flags, as rotas fiscais respondem 503 sem consultar a tabela e a preparação comercial não inicia. A interface oculta a importação.
- O pedido `DH-2026-000019` permanece `approved`, R$ 30,00 de mercadorias, R$ 9,98 de frete, `cart_inflight` e `melhor_envio_shipment_id=NULL`. Não preparar nem comprar etiqueta enquanto não houver conciliação oficial da tentativa anterior. A nota apresentada com R$ 39,98 em mercadorias e frete zero é divergente e deve permanecer bloqueada.

## Em etapa futura, antes da migration

1. Identificar a instância PostgreSQL efetivamente usada por `resourceful-joy`, sem divulgar a conexão. Confirmar espaço, versão, privilégios e que `public.fiscal_documents` não existe. Confirmar integridade de `orders`, `profiles` e `audit_logs` e ausência de transações DDL concorrentes.
2. Obter backup completo com ferramenta oficial PostgreSQL e restaurá-lo em banco PostgreSQL 17 descartável. Comparar contagens e esquemas das tabelas críticas e executar uma consulta de leitura no banco restaurado. Guardar backup e evidência de restauração em armazenamento privado, com acesso restrito. O painel Free, sozinho, não fornece essa garantia.
3. Ensaiar **somente** `backend/migrations/022_fiscal_documents.sql` no banco restaurado e confirmar RLS, privilégios, índices, chaves estrangeiras e repetição sem erro. Verificar que o esquema privado pode ser lido pelo backend e não por `anon`/`authenticated`.
4. Obter autorização para a etapa de migration. A migration 019, ligada à exclusão de produtos, fica excluída. Não usar `npm run migrate` em produção: o comando percorre todos os arquivos SQL do diretório, inclusive 019/020/021, e não registra versões aplicadas.

## Aplicação e verificação após autorização

1. Manter manutenção ON e flags de e-mail/login/Data API/auto deploy desligadas. Executar o conteúdo revisado de 022 em uma transação dedicada. Registrar horário, responsável e resultado, sem XML ou credenciais nos logs operacionais.
2. Confirmar `to_regclass('public.fiscal_documents')`, colunas, constraints, RLS ativo, ausência de grants a `PUBLIC`, `anon` e `authenticated`, e contagem inicial zero. Não abrir a Data API.
3. Publicar o backend aprovado e verificar `/health`, autenticação administrativa, leitura de documento inexistente, proteção contra acesso de cliente e logs. Só então publicar o frontend aprovado. Fazer importação sintética apenas em ambiente controlado; em produção, usar exclusivamente um documento fiscal real correspondente, após conferência contábil e autorização operacional.
4. Em telas 375, 768, 1024 e 1440 px, conferir recorte com aviso de qualidade, zoom, cancelar/confirmar e várias imagens, sem publicar produto de teste. Conferir importação, divergência e bloqueio da chave no Melhor Envio. Monitorar HTTP 4xx/5xx, fila do Mercado Pago, logs de auditoria e expedição.

## Reversão

- Em falha do backend/frontend, restaurar os dois deploys anteriores (`14fcbaa8b8b1b1c2a77df75f195e76b00e612b5c`) e manter manutenção ON. A tabela 022 é aditiva: **preservá-la no rollback da aplicação**, especialmente se houver documentos ou auditoria.
- Remoção estrutural requer autorização separada, backup restaurável e comprovação de tabela vazia. Nunca usar `CASCADE` nem apagar XML, vínculos ou logs de auditoria para facilitar rollback. Se houver qualquer importação, corrigir pela frente da aplicação e preservar os dados.
- Não repetir `prepare` para `DH-2026-000019` por causa de uma falha de deploy. A conciliação do Melhor Envio é uma operação separada.
