# Pós-venda D’Helenas

## Política implementada

| Situação | Operação financeira | Situação física / estoque |
|---|---|---|
| Sem cobrança MP e sem tentativa em aberto | Cancelamento do pedido | Reposição transacional uma vez por item |
| MP pendente | Admin cancela a order MP somente se ela estiver `created` ou `action_required`; confirma por GET antes de cancelar localmente | Reposição somente após confirmação da order cancelada/sem pagamento aprovado |
| MP pago, não expedido | Reembolso total confirmado primeiro; admin cancela o pedido depois | Reposição no cancelamento, nunca no reembolso |
| Enviado ou entregue | Não cancelar o pedido | Solicitação de devolução; repor apenas item recebido e classificado como revendável |
| Reembolso de cortesia sem retorno físico | Registrar e confirmar no MP | Sem reposição |
| Reembolso parcial | Valor calculado dos itens persistidos, com desconto proporcional; não inclui frete | Sem reposição automática; devolução física é independente |
| Troca | Não há operação de troca no modelo atual | Exige fluxo próprio de reserva, diferença de valor e novo envio; proposta abaixo, sem implementação |

As reservas de pagamento que tiveram resposta ambígua ficam bloqueadas para cancelamento. É necessária conciliação manual no Mercado Pago; não repetir cobrança ou reembolso com uma chave nova. A reposição tem ledger `stock_restorations` com unicidade por item cancelado ou item devolvido e limite acumulado igual à quantidade comprada. `order_events` e `audit_logs` registram transições. O status financeiro não pode ser alterado na rota administrativa genérica.

## Reembolso Mercado Pago

Usa a [Orders API oficial](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/refund-order/post): `POST /v1/orders/{order_id}/refund` com `X-Idempotency-Key`. O reembolso total, quando ainda não há parciais, não envia body; o parcial e o saldo remanescente após parciais enviam `transactions: [{ id: payment_id, amount }]`. A aplicação calcula o valor a partir do pedido e valida order ID, transação, `external_reference`, total e BRL por GET antes de reservar a operação. Após o POST, consulta a order novamente e só registra `processed` quando identifica o `refund_id`, a transação e o valor exatos no provedor. Estados incertos exigem conciliação por GET, sem repetição automática do POST. Operações financeiras permanecem desabilitadas até `AFTER_SALES_REFUNDS_ENABLED=true`; cancelamento de pagamento pendente fica desabilitado até `AFTER_SALES_CANCELLATIONS_ENABLED=true`.

A migration `011_after_sales.sql` foi aplicada e validada no Supabase da D’Helenas em 2026-09-22. Em produção, não habilitar essas flags até homologação formal, política de devolução aprovada, permissões administrativas revisadas e reconciliação financeira ensaiada.

## Homologação financeira encerrada — DH-2026-000006

Estado final informado e validado: pagamento R$ 50,00, dois refunds no provedor e dois no ledger local somando R$ 50,00, saldo reembolsável zero, `payment_status=refunded`, estoque 7, nenhuma reposição e nenhuma devolução física. Mercado Pago TEST e manutenção permanecem ativos. `AFTER_SALES_REFUNDS_ENABLED=false`. Esse pedido é evidência congelada: nenhuma nova mutação financeira, física, de estoque ou auditoria nele. A API de devoluções também recusa novas solicitações e transições para esse número.

O código de refund TEST ainda contém a liberação histórica do saldo restante, mas saldo zero e a flag desabilitada impedem novo refund. Sua remoção completa depende de uma revisão financeira separada; esta homologação não executa chamadas financeiras.

## Devolução física implementada

Transições: `solicitada → autorizada → aguardando_postagem → em_transito_retorno → recebida`. `solicitada` pode ir para `recusada` ou `cancelada`; `autorizada` e `aguardando_postagem` podem ir para `cancelada`. `recebida`, `recusada`, `cancelada` e o estado legado `reembolso_processado` são terminais. Novas transições para `reembolso_processado` estão desativadas: resultado financeiro é consultado no ledger de refunds, não codificado no status físico.

Cliente autenticada solicita itens e quantidades do próprio pedido expedido ou entregue; o servidor valida posse, pagamento, item e quantidade ainda disponível. Só admin muda status, fornece instruções/código/rastreio reverso e classifica cada item recebido com descrição da condição. A transição para `recebida` exige classificação de todos os itens. O estoque só retorna para item `restockable=true`, na mesma transação do recebimento. A restrição única de `stock_restorations.return_item_id`, o bloqueio do pedido com `FOR UPDATE` e o limite acumulado pela quantidade comprada impedem reposição repetida e concorrente. Nenhum reembolso é criado ao receber, e refund não altera estoque.

A migration `012_return_physical_tracking.sql` adiciona marcos de data, instruções, código e rastreio reversos, ID de envio reverso para integração futura, e nota de condição por item. Deve ser aplicada conscientemente antes de habilitar novas devoluções físicas; não há migração automática em produção. Até sua aplicação, a API mantém o histórico anterior legível e devolve `physical_schema_ready=false`, bloqueando novas solicitações e transições com HTTP 503. Dados históricos não ganham datas retroativas. O rastreio é informado manualmente pelo admin nesta etapa.

## Proposta de troca — ainda não implementada

1. Cliente solicita **troca** vinculada ao pedido e às quantidades originais, indicando variante desejada e motivo. Registrar operação própria `exchange_requests`, distinta de `order_returns` e `order_refunds`.
2. Admin aprova ou recusa após verificar prazo, elegibilidade e disponibilidade. A aprovação não movimenta estoque nem dinheiro.
3. Cliente devolve o item com rastreio reverso. Admin confirma recebimento e condição por item; somente unidade revendável retorna ao estoque original uma vez, com ledger de reposição.
4. Reservar a nova variante em ledger próprio com unicidade por troca e expiração; a reserva reduz disponibilidade vendável uma única vez. Falha na reserva deixa a troca aguardando escolha alternativa.
5. Calcular diferença de valor e frete do novo envio no backend. Cobrança complementar ou crédito/reembolso exigem autorização e confirmação em fluxo financeiro separado. Nunca inferir pagamento da confirmação física.
6. Criar expedição vinculada à troca, com cotação, custo, etiqueta e rastreio de ida novos; só comprar etiqueta após aprovação de custo. Cancelamento/expiração libera a reserva de modo idempotente.
7. Guardar eventos e chaves de idempotência por transição. Testar concorrência entre duas trocas para a última unidade, retorno não revendável, falha financeira e repetição de webhooks antes da implementação.

## Logística reversa Melhor Envio — mapeamento, sem execução

A [API oficial](https://docs.melhorenvio.com.br/reference/inserir-logistica-reversa-no-carrinho) oferece `POST /api/v2/me/cart/reverse`. Usa Correios PAC (`service: 1`) ou SEDEX (`service: 2`). Quando o envio original passou pelo Melhor Envio, requer o `order_id` do envio, contato do cliente que será o novo remetente, valor segurado, peso/dimensões de um pacote e informação de DC-e conforme o caso. Para envio original fora do Melhor Envio, requer também remetente, destinatário e produtos completos. O `Authorization: Bearer` OAuth e `User-Agent` da aplicação são necessários; dados de cliente devem permanecer privados. A [orientação de logística reversa](https://docs.melhorenvio.com.br/docs/logistica-reversa-carrinho) limita a um volume por requisição e informa que o código de devolução dispensa impressão física, mas depende da geração da etiqueta.

Fluxo futuro: autorização administrativa → confirmação dos dados e custo → inclusão no carrinho reverso → checkout/compra com saldo → solicitação da geração do código → comunicação ao cliente → rastreio do retorno → recebimento e inspeção → reposição seletiva → decisão financeira separada. A [compra do frete](https://docs.melhorenvio.com.br/reference/compra-de-fretes-1) usa saldo da carteira; portanto, não presumir custo zero nem preço fixo. O [status da etiqueta](https://docs.melhorenvio.com.br/reference/rastreio-de-envios) usa `POST /api/v2/me/shipment/tracking` com array `orders` de IDs de etiquetas; é necessário vincular o ID reverso, separado do rastreio de ida. A [pesquisa de etiqueta](https://docs.melhorenvio.com.br/reference/pesquisar-etiqueta) admite código de autorização, protocolo, rastreio ou ID. A logística reversa exige uma requisição por volume e postagem em agência dos Correios.

**Limite atual do Sandbox:** a [referência oficial de logística reversa](https://docs.melhorenvio.com.br/reference/inserir-logistica-reversa-no-carrinho) diz que ele aceita inclusão no carrinho e compra simulada, mas **não gera etiqueta nem código de devolução**. Nenhum fluxo reverso foi chamado ou comprado nesta etapa. A implementação da compra/geração reversa permanece fora de escopo até existir ambiente verificável e decisão explícita de custo.
