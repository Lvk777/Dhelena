# Próxima homologação Pix TEST — plano de execução única (2026-10-05)

**Estado:** planejamento. Nesta atualização não foram criados cupom, pedido, Order Pix, QR, cobrança, movimento de estoque ou webhook. A manutenção estava ligada na última leitura publicada e deve ser reconfirmada. `DH-2026-000006` está encerrado: não reutilizar nem alterar. O próximo ensaio exige pedido TEST novo e dedicado.

## Restrição operacional definitiva

Não há acesso ao painel Mercado Pago da cliente. Não pedir senha, token ou secret; não tentar contornar o login. URL, tópico `Order (Mercado Pago)` e correspondência do secret na aplicação TEST ficam classificados como **UNVERIFIED EXTERNALLY**.

| Campo | Estado |
| --- | --- |
| PANEL ACCESS AVAILABLE | NÃO |
| PANEL WEBHOOK CONFIG VERIFIED | NÃO — UNVERIFIED EXTERNALLY |

Essa limitação não bloqueia, por si só, o único ensaio Pix TEST quando os demais gates prévios estiverem verdes. A entrega real e válida do webhook é **resultado do ensaio**, não pré-requisito. Uma falha de entrega será bloqueio separado para go-live.

## Cenário controlado

| Campo | Valor planejado e conferência obrigatória |
| --- | --- |
| PRODUCT | Blusa Serena, `e6dfe65b-f491-41e2-b54d-5c4499a69be7` |
| VARIANT | Off-white (`off_white`) / M |
| QUANTITY | 1 |
| STOCK | Última leitura: 5 unidades em 2026-10-05 07:53 UTC. Reler imediatamente antes do ensaio. |
| UNIT PRICE | R$ 189,90, sem preço promocional; reler. |
| SHIPPING | Retirada na boutique = R$ 0,00; reler. |
| TEMP COUPON | Desconto fixo de R$ 139,90; `max_uses=1`, `max_uses_per_customer=1`, validade curta. |
| FINAL EXPECTED TOTAL | R$ 50,00 = 189,90 − 139,90 + 0,00. O backend deve recalcular. |
| PAYER | `test_user_br@testuser.com`; `first_name=APRO` no snapshot do cliente. |
| CHECKOUT IDEMPOTENCY KEY | Nova chave exclusiva; retry deve devolver o mesmo pedido. |
| PIX IDEMPOTENCY KEY | `pix-{novo order.id}`; somente um POST de criação. |

O [cenário oficial de Pix TEST da Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix) usa esse e-mail, `APRO`, R$ 50,00 e verificação por `GET /v1/orders/{id}`. A aprovação pode ocorrer rapidamente, inclusive antes de observar o QR.

## PRE-TEST READINESS

Os itens abaixo devem ser relidos no ambiente publicado imediatamente antes da autorização final e da execução. Evidência histórica ou inferida não substitui a nova conferência. Verificação do painel e webhook real não integram esse gate.

| Gate | Critério para SIM | Evidência atual e limite |
| --- | --- | --- |
| MP TEST | `MERCADO_PAGO_MODE=test`, Access Token TEST configurado no backend e Pix habilitado | `/api/payments/methods` publicou `environment: Teste`, `enabled.pix=true` e `available.pix=true`. Isso indica token presente, mas não atesta seu tipo; reconfirmar sem expô-lo. |
| Orders API em TEST | Integração e GET oficial com credencial TEST funcionais, sem POST adicional | Order histórica de 01/10 foi lida por GET oficial; reconfirmar conectividade read-only se disponível. |
| Endpoint público | `/api/webhooks/mercado-pago` acessível por HTTPS | POST sem assinatura recebeu 401 na checagem anterior; reconfirmar. Isso não prova entrega assinada. |
| BACKEND WEBHOOK HMAC READY | Secret presente e assinatura obrigatória antes de consultar provedor ou alterar pedido | Implementado e testado localmente; `available.pix=true` indica secret presente. Painel segue **UNVERIFIED EXTERNALLY**. |
| CHECKOUT IDEMPOTENT | Chave por usuário, fingerprint, bloqueio e índice único; retry não duplica pedido ou baixa | Implementado e coberto por ensaio local. |
| COUPON ATOMIC | Linha do cupom bloqueada na mesma transação que conta usos, cria pedido e grava `coupon_usages` | Correção publicada em `70937d0`; `backend/integration/couponConcurrency.mjs` confirmou um vencedor, um uso e rollback completo em PostgreSQL local. |
| STOCK SAFE | Produto bloqueado; pedido, estoque e um movimento de −1 na mesma transação | Código e ensaio PostgreSQL local registrados; reconfirmar baseline. |
| Backend recalcula total | Preço, promoção, cupom e retirada calculados pelo servidor; total persistido R$ 50,00 | Implementado; conferir o novo pedido antes do POST Pix. |
| PIX IDEMPOTENT | `pix-{order.id}`, reserva de tentativa antes do POST, GET oficial e sem segunda cobrança em caso de incerteza | Implementado; confirmar ausência de tentativa anterior no novo pedido. |
| Manutenção e baseline | Manutenção ligada; produto, estoque, preço, promoções, retirada e cupom conferidos | Última leitura: 5 unidades, R$ 189,90, sem `sale_price`, retirada ativa e manutenção ligada; reler. |

## Preparação e condições de parada

1. Reler produto, variante, estoque, preço, promoções, retirada, manutenção, configuração TEST/Pix e implantação. Registrar horário, pedidos, movimentos de estoque, usos de cupom, auditoria e eventos para comparação.
2. Preparar sessão autenticada TEST com `customer.name` começando por `APRO` e `customer.email=test_user_br@testuser.com`. Confirmar que o snapshot produzirá o pagador esperado. Usar o mesmo contrato do checkout normal.
3. **Somente na execução futura autorizada:** criar cupom TEST novo e imprevisível, inicialmente `active=false`, desconto fixo R$ 139,90, `min_order_value=189.90`, `max_uses=1`, `max_uses_per_customer=1`, `first_purchase_only=false` e validade curta. Confirmar zero usos. Ativar imediatamente antes do checkout único; desativar logo após criar o pedido. Preservar cupom e uso para auditoria.
4. Abortar **antes do Pix** se estoque diferir da baseline esperada, preço mudar, surgir promoção, retirada deixar de custar R$ 0,00, total diferir de R$ 50,00, MP não estiver em `test`, Pix não estiver habilitado, cupom já tiver uso, pedido duplicar, estoque cair mais de 1 ou qualquer valor financeiro divergir. Se a baseline não for mais 5, parar e reavaliar o cenário, sem presumir 5 → 4.

## Sequência após autorização explícita

1. Com gates verdes, ativar cupom e chamar **uma vez** o checkout autenticado de API com chave nova. A UI abre `PixPaymentScreen` após “Confirmar pedido” e dispara POST Pix automaticamente; para este ensaio, preferir a API autenticada com o mesmo contrato, permitindo a parada intermediária.
2. Desativar cupom. **Antes de `POST /api/orders/:id/payment/pix`**, confirmar exatamente um pedido novo, `total=50.00`, `payment_status=pending`, exatamente um uso de cupom, um movimento `sale` de −1 e estoque 5 → 4 quando a baseline reconfirmada for 5. Conferir snapshot do pagador e ausência de tentativa Pix. Se algo divergir, parar sem criar Pix e preservar evidências.
3. Executar **um único POST Pix**. Registrar ID e status retornados. Se a resposta falhar ou ficar incerta, consultar provedor e pedido local; não criar outra cobrança.
4. Pelo `GET /v1/orders/{id}` oficial, confirmar `external_reference` igual ao novo número de pedido, `total_amount=50.00`, `currency_id=BRL`, exatamente uma transação de R$ 50,00 e estados coerentes. Conferir também, pela busca oficial por referência já implementada, que existe apenas uma Order do provedor para esse pedido. Registrar QR/copia-e-cola se retornados. Ausência de QR após aprovação imediata não é, isoladamente, falha do Pix.
5. Observar webhook **real** e conferir logs técnicos, deduplicação, processamento, estado local e auditoria. Não simular webhook nem repetir pagamento para melhorar observação.

## WEBHOOK HOMOLOGATION RESULT

Preencher somente depois do ensaio. **WEBHOOK REAL VALIDATED=SIM** exige entrega real com `signature_present=true`, `signature_valid=true`, `provider_resource_fetch=success`, pedido local encontrado, `external_reference` correta, total e transação de R$ 50,00 em BRL, deduplicação e processamento corretos. Conferir ausência de duplicação de pagamento, auditoria, cupom e estoque. Isso comprova empiricamente URL, tópico e secret funcionais **para esta aplicação TEST naquele momento**, embora `PANEL WEBHOOK CONFIG VERIFIED=NÃO` continue fiel ao fato de que o painel não foi inspecionado.

Se nenhum webhook real chegar após janela razoável (registrar início, fim e logs consultados), **não repetir pagamento, não criar segundo Pix e não simular evento**. Consultar `GET /v1/orders/{id}`, confirmar status no provedor e reconciliar, se necessário, apenas pelo mecanismo seguro existente após sua verificação. Registrar separadamente:

| Resultado | Se criação e GET passam, mas não há webhook real |
| --- | --- |
| PIX CREATION | PASS |
| PROVIDER STATUS | PASS, com status efetivo anotado |
| WEBHOOK DELIVERY | FAIL/UNVERIFIED |
| WEBHOOK REAL VALIDATED | NÃO |
| GO-LIVE WEBHOOK | BLOCKED até resolver e validar a entrega |

Resposta de criação incerta ou GET divergente exige resultado próprio de **conciliação necessária**; não presumir `PIX CREATION=PASS`. O ensaio financeiro não é repetido automaticamente em nenhum ramo.

## Relatório de readiness nesta atualização

| Campo | Estado em 2026-10-05 | Próxima conferência |
| --- | --- | --- |
| PANEL ACCESS AVAILABLE | NÃO | Restrição definitiva desta operação. |
| PANEL WEBHOOK CONFIG VERIFIED | NÃO — UNVERIFIED EXTERNALLY | Não integra o gate pré-teste. |
| PRE-TEST TECHNICAL GATES | NÃO, ainda sem revalidação imediata | SIM somente quando todos os gates prévios forem relidos e aprovados. |
| COUPON ATOMIC | SIM no código publicado e ensaio local | Reconfirmar implantação. |
| STOCK SAFE | SIM no código e ensaio local | Reconfirmar baseline. |
| CHECKOUT IDEMPOTENT | SIM no código e testes locais | Confirmar chave nova. |
| PIX IDEMPOTENT | SIM no código | Confirmar pedido sem tentativa anterior. |
| MP TEST | NÃO comprovado integralmente nesta atualização | A última resposta publicada indica modo `test`, token presente e Pix habilitado; reconfirmar que o token configurado é TEST sem revelá-lo. |
| BACKEND WEBHOOK HMAC READY | SIM no código/teste e secret indicado presente | Reconfirmar implantação, secret presente e rejeição sem assinatura. |
| SAFE TO EXECUTE EXACTLY ONE CONTROLLED PIX TEST | **NÃO nesta atualização** | Pode ser SIM após pré-teste verde; painel e entrega prévia de webhook não são requisitos. SIM não autoriza a execução. |

**NEXT EXACT ACTION:** reler com segurança os gates e a baseline no ambiente publicado e registrar o relatório atualizado. Se tudo passar, apresentar `SAFE TO EXECUTE EXACTLY ONE CONTROLLED PIX TEST=SIM` e **aguardar autorização explícita antes de criar cupom, pedido ou Pix**.

## Pre-flight final somente leitura — 2026-10-05 22:49 UTC

Esta leitura não criou cupom, pedido, Pix ou QR; não alterou estoque, settings, manutenção, Mercado Pago, Railway, Supabase, `main` ou PR #3. O plano local anterior foi preservado. A coluna `PANEL WEBHOOK CONFIG VERIFIED=NÃO — UNVERIFIED EXTERNALLY` permanece uma limitação conhecida, sem bloqueio automático do único ensaio TEST.

| Campo | Baseline relida / evidência |
| --- | --- |
| PRODUCT / VARIANT | Blusa Serena `e6dfe65b-f491-41e2-b54d-5c4499a69be7`, Off-white (`off_white`) / M; produto `published`, variante disponível pelo estoque. Não existe flag própria de ativação da variante no catálogo. |
| UNIT PRICE / SALE PRICE | R$ 189,90 / ausente (`null`) em `GET /api/products/:id` publicado. O backend usa `sale_price || price` da linha bloqueada. |
| STOCK NOW / AVAILABLE | 5 / 5 em `colors[].stock.M`. Não há saldo reservado separado exposto; a criação do pedido baixa esse saldo na transação. |
| AUTOMATIC PROMOTIONS | `GET /api/look-promotions` retornou zero regras ativas. Desconto automático aplicável observado: R$ 0,00. |
| COUPONS / FIRST PURCHASE | A rota de listagem exige admin; cupons ativos não foram enumerados. Pelo código publicado, cupom e regra de primeira compra só entram quando `coupon_code` é enviado. A inexistência de cupom inesperado no banco não foi verificada. |
| BASE PRICE USED BY BACKEND / UNEXPECTED DISCOUNT | R$ 189,90 no cenário sem cupom / nenhum desconto automático encontrado. Confirmar novamente imediatamente antes do ensaio. |
| PICKUP ENABLED / PRICE | `settings.shipping.pickup_enabled=true`; `shipping_method='retirada'` é aceito no backend e fixa `shippingCost=0`. R$ 0,00. |
| MP MODE / PIX ENABLED / PIX AVAILABLE | `environment=Teste`; `enabled.pix=true`; `available.pix=true` em `GET /api/payments/methods`. A rota deriva `Teste` de `MERCADO_PAGO_MODE=test`. |
| PIX CAPABILITY SOURCE | `orders_api_configuration`, `reason=null`. Isso confirma configuração básica; não garante aceitação futura da Orders API. |
| MP TOKEN / WEBHOOK SECRET | PRESENTE / PRESENTE, inferidos da implementação da capacidade Pix publicada; nenhum valor foi exibido. O tipo efetivo do token TEST não foi lido diretamente. |
| PANEL ACCESS / PANEL WEBHOOK CONFIG | NÃO DISPONÍVEL / **UNVERIFIED EXTERNALLY**. Não é blocker automático. |
| PAYMENT ID COLUMN / CHECKOUT IDEMPOTENCY | Migration `012` exige `orders.mercado_pago_payment_id=text`; migrations `001` e `010` definem índice único parcial `(user_id,idempotency_key)`. **Schema de produção não confirmado por SELECT nesta sessão.** |
| COUPON / STOCK / ORDER TABLES | `coupon_usages`, `stock_movements` e `orders` constam das migrations locais; estrutura efetiva de produção não inspecionada. |
| ATOMIC COUPON CODE DEPLOYED | Commit `70937d0` é ancestral do HEAD `a4edd5e`; status de deploy Railway `resourceful-joy` para esse HEAD: `success` em 2026-10-05 18:10 UTC, alvo `api.dhelenas.com`. O código contém `FOR UPDATE`, contagens, pedido, movimento, uso e idempotência na mesma transação. Teste PostgreSQL isolado documentado acima; sem nova concorrência em produção. O binário/runtime não expõe SHA para conferência independente. |
| BACKEND PRICE / TOTAL AUTHORITY | Confirmado pelo fluxo `resolveCatalogLine` e `calculateServerOrderTotal` no commit publicado; nenhum total do navegador é aceito como autoridade. |
| MAINTENANCE / REFUNDS FLAG / ME MODE | `maintenance_mode=true` na API pública / `AFTER_SALES_REFUNDS_ENABLED` não verificável nesta sessão / `settings.shipping.melhor_envio_mode=sandbox`; variável de ambiente `MELHOR_ENVIO_MODE` não verificável. |
| ORDER COUNT BEFORE | Não aferido: requer SELECT no banco/admin. |
| STOCK MOVEMENT COUNT FOR TEST PRODUCT | Não aferido: requer SELECT no banco/admin. |
| COUPON USAGE BASELINE | Não aferido: requer SELECT no banco/admin. Nenhum cupom TEST foi criado nesta leitura. |
| PAYMENT AUDIT BASELINE / WEBHOOK EVENT BASELINE | Não aferidos: requerem SELECT no banco/admin. |
| TARGET TOTAL / REQUIRED TEST DISCOUNT | R$ 50,00 / R$ 139,90 fixos, projetados a partir do preço relido de R$ 189,90, quantidade 1 e retirada R$ 0,00. Nenhum cupom foi criado. |

**PRE-TEST TECHNICAL GATES=INCOMPLETOS. SAFE TO EXECUTE EXACTLY ONE CONTROLLED PIX TEST=NÃO.** Bloqueios desta leitura: schema e índice efetivos não confirmados; contagens de auditoria não registradas; estado efetivo de cupons, tipo da credencial TEST e flags privadas não confirmado. O painel Mercado Pago não integra esta lista de bloqueios. A próxima ação exata é obter acesso read-only autorizado ao banco/admin do ambiente publicado, executar somente SELECTs para schema, índice, cupons e contagens, conferir as flags privadas e o tipo da credencial TEST sem expor valores e reler os campos voláteis antes de decidir. Mesmo se todos os gates passarem depois, parar e aguardar autorização explícita para qualquer cupom, pedido ou Pix.
