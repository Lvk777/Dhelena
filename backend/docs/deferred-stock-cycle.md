# Ciclo de estoque com venda após aprovação

## Modelo

- `products.colors[*].stock` representa unidades **disponíveis** para novas compras.
- `stock_reservations` (migration 018) guarda uma linha única por `order_item_id`: `active` ao iniciar a tentativa financeira, `sold` após aprovação oficial, `released` após rejeição oficial ou cancelamento seguro.
- Estoque físico no painel = disponível + reservas ativas. Vendas líquidas do novo modelo = linhas `sold` menos reposições registradas em `stock_restorations`.
- `products.sold_count` aumenta somente na aprovação do novo modelo e diminui no fluxo de reposição já existente. Seu valor histórico anterior à migration continua misturando reservas e vendas; não é retroativamente reclassificado.
- O pedido novo recebe `snapshot.stock_model = deferred_sale_v1`. Pedidos sem essa marca continuam no fluxo legado, inclusive cancelamento e movimentos `sale` antigos. Nenhum backfill ou restauração histórica é feita.

## Transações e falha segura

1. Prévia de checkout e criação do pedido consultam disponibilidade. O pedido não altera estoque, `sold_count` ou movimentos.
2. A tentativa de Pix/cartão marca a tentativa e reserva os itens na mesma transação. Produtos são bloqueados com `FOR UPDATE`; a chave primária `order_item_id` impede reserva duplicada. Falha de estoque reverte a marca da tentativa antes de contatar o provedor.
3. A conciliação de uma aprovação oficialmente verificada converte todas as reservas ativas em `sold` e aumenta `sold_count` na mesma transação do pagamento. Ausência ou divergência de reserva bloqueia a aprovação local para conciliação manual.
4. Uma rejeição oficialmente verificada libera a reserva uma única vez. Estado pendente, tentativa incerta ou IDs no provedor preservam a reserva até confirmação adequada.
5. A expiração automática permanece desativada por padrão. Se autorizada, cancela somente pedidos novos com prazo marcado e sem tentativa financeira; pedidos legados e tentativas iniciadas ficam fora.

## Reservas após tentativa financeira

- Pix com QR gerado e status `pending` continua reservado. A validade do QR, por si só, não comprova o estado definitivo da Order no Mercado Pago. Uma leitura oficial verificada que resulte em `rejected`/`expired` libera uma vez; aprovação verificada converte a reserva em venda.
- Cartão recusado por resultado oficial verificado libera uma vez. Timeout, falha de comunicação e resultado desconhecido preservam a reserva e a marca de tentativa até conciliação.
- Se houver ID da Order no provedor, o fluxo de status/webhook pode consultar a Order oficial no contexto de credenciais vinculado. O cancelamento de uma Order ainda pendente exige leitura, cancelamento e releitura oficiais pelo fluxo administrativo existente, que permanece desativado por `AFTER_SALES_CANCELLATIONS_ENABLED` até validação operacional.
- Uma tentativa sem ID do provedor não deve ser liberada por tempo decorrido. O procedimento de ausência oficial de Order existente no código é restrito a TEST. Falta uma rotina de conciliação de produção, com prova inequívoca da ausência ou do estado terminal da Order, antes de automatizar a liberação desses casos.
- Política futura recomendada: manter `ORDER_RESERVATION_EXPIRY_ENABLED=false` até validar monitoramento, conciliação e atendimento. Depois, se autorizado, usar prazo inicial de 60 minutos somente para pedidos criados sem tentativa financeira; o worker confere novamente sob bloqueio e nunca alcança tentativas iniciadas ou pedidos legados.

## Publicação controlada

A migration `018_deferred_stock_sale.sql` é necessária **antes** de publicar o backend e o frontend desta mudança. Executá-la não altera pedidos, produtos, movimentos, estoque ou contadores existentes. Não aplicá-la causa falha fechada nas tentativas novas e na leitura do painel administrativo. Publicar somente após autorização, com manutenção ON e `ORDER_RESERVATION_EXPIRY_ENABLED=false`. A liberação do pedido histórico `DH-2026-000016` exige decisão e verificação próprias.

O ensaio local e o check PostgreSQL 17 do CI usam `npm run test:stock-postgres` em `backend/`, com `POSTGRES_ADMIN_URL` apontando para o banco `postgres` em `localhost`. O comando cria e remove dois bancos descartáveis `dhelenas_audit_reservation_*`. Um ensaia a 018 sobre o esquema 017 povoado com pedido e movimento `sale` legados, incluindo reaplicação e leituras equivalentes às do backend publicado; o outro cobre o ciclo transacional de reserva e venda.
