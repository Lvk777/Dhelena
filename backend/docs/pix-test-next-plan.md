# Próxima homologação Pix TEST — pré-execução (2026-10-05)

**Estado:** planejamento somente leitura. Nenhum pedido, cupom, Order Pix, QR, cobrança, movimento de estoque ou webhook foi criado ou simulado nesta etapa. Manutenção publicada: ligada. O pedido `DH-2026-000006` está encerrado e não integra este teste. Branch de trabalho: `codex/production-hardening`; `main` e PR #3 não foram alterados.

## Cenário controlado

| Campo | Prévia |
| --- | --- |
| PRODUCT | Blusa Serena, `e6dfe65b-f491-41e2-b54d-5c4499a69be7` |
| VARIANT | Off-white (`off_white`), M |
| STOCK BEFORE | 5 unidades no catálogo publicado em 2026-10-05 07:53 UTC; reler imediatamente antes do teste |
| UNIT PRICE | R$ 189,90; `sale_price` ausente |
| QUANTITY | 1 |
| DISCOUNT | R$ 139,90 planejados via cupom TEST temporário, ainda inexistente |
| SHIPPING | Retirada na boutique, R$ 0,00; opção publicada como habilitada |
| FINAL TOTAL | R$ 50,00 **projetados**: 189,90 − 139,90 + 0,00; confirmar cálculo do backend antes de criar a Order Pix |
| CHECKOUT IDEMPOTENCY KEY | Nova chave exclusiva, gerada pela sessão de checkout e persistida no pedido; não gerar/reutilizar agora |
| PIX IDEMPOTENCY KEY | `pix-{novo order.id}`, gerada somente após a criação do novo pedido; não existe agora |
| MERCADO_PAGO_MODE | `test`, inferido da resposta publicada `environment: Teste`; reconfirmar no servidor antes do teste |
| PIX ENABLED | Sim, resposta publicada `/api/payments/methods`: `enabled.pix=true` |
| PIX READINESS | Configuração básica passa pela API publicada (`available.pix=true`, `pix_capability.reason=null`); entrega real do webhook ainda não comprovada |
| WEBHOOK CONFIGURED | A API infere segredo presente; URL/tópico e correspondência do segredo no painel Mercado Pago TEST não foram verificados |
| EXPECTED ORDER STATUS BEFORE PAYMENT | `recebido` após criar o pedido, antes do POST Pix |
| EXPECTED PAYMENT STATUS BEFORE PAYMENT | `pending` |
| EXPECTED STOCK MOVEMENT | Um movimento `sale` de −1 e variante M de 5 para 4, na transação de criação; retry com mesma chave não repete |
| EXPECTED COUPON USAGE | Um registro em `coupon_usages` para o novo pedido; zero antes da criação |

Pagador TEST planejado: `payer.email=test_user_br@testuser.com`, `payer.first_name=APRO`; preencher `customer.name` começando por `APRO` e `customer.email` com o endereço indicado, pois a rota Pix deriva esses campos do snapshot do pedido. O cenário oficial do Mercado Pago especifica R$ 50,00 e esses campos, com resposta inicial `action_required` e atualização posterior automática. QR e copia-e-cola devem ser capturados da resposta real se estiverem presentes; aprovação imediata pode encurtar a janela de observação. Fonte: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix

## Preparação do cupom, sem criar agora

Criar **somente na futura execução autorizada** um código novo e imprevisível com prefixo `TEST-PIX-20261005-`, desconto fixo de R$ 139,90, `min_order_value=189.90`, `max_uses=1`, `max_uses_per_customer=1`, `first_purchase_only=false`, validade curta e `active=false` inicialmente. Validar ausência de promoções ativas e preço R$ 189,90. Ativar apenas durante o único checkout controlado; desativar imediatamente após a criação do pedido, mantendo o registro e seu uso para auditoria. Não reutilizar o cupom de 01/10.

**Bloqueio de segurança:** o código atual valida contagem de usos por `pool.query` fora da transação do checkout e não bloqueia a linha do cupom; a restrição SQL é somente `(coupon_id, order_id)`. Duas requisições com chaves diferentes podem ultrapassar `max_uses=1`. Corrigir validação/consumo atômicos ou comprovar isolamento operacional efetivo antes de declarar `COUPON SAFETY=SIM`.

## Contratos e observabilidade

- `placeOrder` lê produto e preço do banco com `FOR UPDATE`, valida estoque, calcula desconto e frete no backend, grava pedido, estoque e uso do cupom em uma transação. O corpo do frontend não contém total financeiro. A idempotência do checkout usa chave por usuário, advisory lock, fingerprint e índice único.
- O POST Pix usa `order.total` persistido, `external_reference=order.order_number`, `X-Idempotency-Key=pix-{order.id}` e Orders API `/v1/orders`. Reserva `payment_attempt_started_at` antes da chamada. Após criação consulta `GET /v1/orders/{id}` e valida referência, total, valor da transação, BRL, uma transação e estados. O código não usa SQL de estoque/cupom nessa etapa.
- O webhook exige HMAC válido antes de reservar evento ou consultar o provedor. Logs técnicos sanitizados incluem `data_id`, `x_request_id`, `signature_present`, `signature_valid`, `provider_resource_fetch`, `local_order_number`, `deduplication_result` e `processing_result`. Nenhuma entrega real do novo pedido existe ainda. Rejeições 401 de 01/10 impedem presumir que o painel e o segredo atual estão alinhados.
- Um webhook válido deve buscar o recurso oficial, validar o novo pedido, deduplicar o evento e conciliar via bloqueio de linha. Conferir um único evento de aprovação e uma única entrada de auditoria apesar de retries; não enviar webhook simulado.
- O checkout atual monta `PixPaymentScreen` imediatamente após criar o pedido; a tela dispara o POST Pix automaticamente. Portanto, **clicar em “Confirmar pedido” já inicia a etapa financeira**. Registrar toda a baseline antes desse clique.
- Logs de pagamento e webhook usam campos técnicos delimitados e evitam credenciais, cabeçalhos completos, corpo do provedor e dados do pagador. Confirmar essa política no deployment antes do teste.

## Gates antes de uma única execução futura

1. Reconfirmar catálogo (produto publicado, Off-white/M, preço e estoque), retirada, zero promoções elegíveis e manutenção ligada; obter baseline administrativo de `stock_movements`, cupom, auditoria e timeline.
2. Confirmar no ambiente publicado `MERCADO_PAGO_MODE=test`, credencial TEST, Pix habilitado e tipo textual da coluna `mercado_pago_payment_id`. Verificar URL `https://api.dhelenas.com/api/webhooks/mercado-pago`, tópico **order** e secret TEST correspondente no painel Mercado Pago, sem copiar o segredo para logs.
3. Resolver a concorrência do limite do cupom; criar o cupom inativo e verificar zero usos. Preparar sessão TEST com `APRO` e `test_user_br@testuser.com`; assegurar que nenhuma outra sessão usa o cupom.
4. Ativar o cupom apenas na janela controlada. Antes do único clique, conferir projeção de R$ 50,00, frete zero e chave de checkout nova. Após criar, conferir pedido novo, snapshot, total calculado, um movimento −1 e um uso. Se qualquer campo divergir, **não chamar POST Pix**.
5. Só então observar uma criação de Order Pix, GET oficial, QR/copia-e-cola quando disponíveis, webhook real, conciliação, idempotência e contagens de estoque/cupom/auditoria. Se o checkout pela UI for usado, o passo 4 e o POST Pix acontecem em sequência automática; para uma parada entre eles, usar o fluxo autenticado de API com o mesmo contrato e validar a UI separadamente.

**Decisão nesta etapa: SAFE TO EXECUTE ONE CONTROLLED PIX TEST = NÃO.** Pendências: cupom ainda não existe, limite concorrente não é atômico; entrega real do webhook TEST não comprovada; estado financeiro/configuração e baseline administrativo devem ser relidos imediatamente antes da futura execução. Nenhuma chamada mutável foi feita nesta preparação.

## Atualização pré-Pix — 2026-10-05, correção de concorrência

O bloqueio de concorrência no código foi corrigido nesta branch: o checkout usa o mesmo cliente PostgreSQL e a mesma transação para `SELECT ... FOR UPDATE` da linha do cupom, contagens global e por usuário, reserva de estoque, criação do pedido, inserção em `coupon_usages` e gravação da chave de idempotência. Um segundo checkout disputa a linha e só reconta depois do commit ou rollback do primeiro. O perfil do cliente também fica bloqueado para serializar a regra de primeira compra, inclusive entre cupons diferentes. A numeração de pedidos ganhou bloqueio transacional global; retries com a mesma chave retornam o pedido persistido sem nova notificação de criação. O endpoint público de pré-validação continua apenas indicativo; o checkout recalcula desconto e disponibilidade.

**Evidência local isolada:** `backend/integration/couponConcurrency.mjs`, executado no PostgreSQL local `dhelenas_audit_coupon_20261005` com `TEST_DATABASE_URL` restrito a localhost e prefixo `dhelenas_audit_`. Dois checkouts com chaves e usuários diferentes disputaram o último uso (`max_uses=1`): exatamente um pedido, um uso, um movimento de estoque e uma rejeição `Cupom esgotado`; estoque de 2 para 1. Duas chamadas simultâneas com a mesma chave retornaram o mesmo pedido e um único uso. Uma exceção injetada no insert de uso reverteu pedido, movimento e estoque (2 para 2). Cupom já esgotado rejeitou nova tentativa sem segunda reserva. A regra de primeira compra também aceitou somente um checkout simultâneo do mesmo usuário. Nenhuma chamada ao Mercado Pago foi feita no script.

**Verificação publicada somente leitura:** `/health` retornou `ok` com banco conectado; `/api/payments/methods` retornou ambiente `Teste` e Pix disponível, o que implica token, modo explícito e secret do webhook presentes pela implementação atual. O endpoint público `/api/webhooks/mercado-pago` respondeu HTTP 401 a um POST `{}` sem assinatura, antes de consultar provedor ou alterar pedido. O catálogo publicado mostrou Blusa Serena Off-white/M com 5 unidades, preço R$ 189,90 sem preço promocional; retirada ativa; manutenção ligada. O total projetado permanece R$ 50,00 após o desconto futuro de R$ 139,90, sujeito ao recálculo do backend no futuro ensaio.

**Gate de webhook ainda pendente:** o painel Mercado Pago solicitou login nesta sessão, e o responsável informou que não possui acesso à conta da cliente. Portanto URL, tópico `Order (Mercado Pago)` e correspondência do secret com a mesma aplicação TEST não foram confirmados no painel. A presença do secret no backend e o teste HMAC local não provam essa correspondência. Não exigir entrega real do novo Pix antes de criá-lo; essa entrega será validada durante o ensaio. Nenhum cupom TEST, pedido ou cobrança foi criado no ambiente publicado nesta rodada. A correção foi publicada no Railway após o commit `70937d0`; CI, status de deploy de `resourceful-joy` e `/health` passaram. Manter `SAFE TO EXECUTE ONE CONTROLLED PIX TEST = NÃO` até um operador autorizado confirmar a configuração no painel e reler a baseline imediatamente antes do ensaio.
