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
| Troca | Não há operação de troca atômica no modelo atual | Tratar como devolução recebida e novo pedido, sem movimentação automática cruzada |

As reservas de pagamento que tiveram resposta ambígua ficam bloqueadas para cancelamento. É necessária conciliação manual no Mercado Pago; não repetir cobrança ou reembolso com uma chave nova. A reposição tem ledger `stock_restorations` com unicidade por item cancelado ou item devolvido e limite acumulado igual à quantidade comprada. `order_events` e `audit_logs` registram transições. O status financeiro não pode ser alterado na rota administrativa genérica.

## Reembolso Mercado Pago

Usa a [Orders API oficial](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/refund-order/post): `POST /v1/orders/{order_id}/refund` com `X-Idempotency-Key`. O reembolso total, quando ainda não há parciais, não envia body; o parcial e o saldo remanescente após parciais enviam `transactions: [{ id: payment_id, amount }]`. A aplicação calcula o valor a partir do pedido e valida order ID, transação, `external_reference`, total e BRL por GET antes de reservar a operação. Após o POST, consulta a order novamente e só registra `processed` quando identifica o `refund_id`, a transação e o valor exatos no provedor. Estados incertos exigem conciliação por GET, sem repetição automática do POST. Operações financeiras permanecem desabilitadas até `AFTER_SALES_REFUNDS_ENABLED=true`; cancelamento de pagamento pendente fica desabilitado até `AFTER_SALES_CANCELLATIONS_ENABLED=true`.

Antes de habilitar, aplicar `011_after_sales.sql` de forma controlada, validar migração e executar testes operacionais somente com conta e credenciais TEST. Em produção, não habilitar essas flags até homologação formal, política de devolução aprovada, permissões administrativas revisadas e reconciliação financeira ensaiada.

## Logística reversa Melhor Envio — mapeamento, sem execução

A [API oficial](https://docs.melhorenvio.com.br/reference/inserir-logistica-reversa-no-carrinho) oferece `POST /api/v2/me/cart/reverse`. Usa Correios PAC (`service: 1`) ou SEDEX (`service: 2`). Quando o envio original passou pelo Melhor Envio, requer o `order_id` do envio, contato do cliente que será o novo remetente, valor segurado, peso/dimensões de um pacote e informação de DC-e conforme o caso. Para envio original fora do Melhor Envio, requer também remetente, destinatário e produtos completos. O `Authorization: Bearer` OAuth e `User-Agent` da aplicação são necessários; dados de cliente devem permanecer privados. A [orientação de logística reversa](https://docs.melhorenvio.com.br/docs/logistica-reversa-carrinho) limita a um volume por requisição e informa que o código de devolução dispensa impressão física, mas depende da geração da etiqueta.

Fluxo futuro: autorização administrativa → confirmação dos dados e custo → inclusão no carrinho reverso → checkout/compra com saldo → geração do código → comunicação ao cliente → rastreio do retorno → recebimento e inspeção → reposição seletiva → reembolso separado. A [compra do frete](https://docs.melhorenvio.com.br/reference/compra-de-fretes-1) usa saldo da carteira; portanto, não presumir custo zero nem preço fixo. O [rastreamento de envios](https://docs.melhorenvio.com.br/reference/rastreio-de-envios) precisará ser vinculado ao ID reverso, separado do rastreio de ida.

**Limite atual do Sandbox:** a [referência oficial de logística reversa](https://docs.melhorenvio.com.br/reference/inserir-logistica-reversa-no-carrinho) diz que ele aceita inclusão no carrinho e compra simulada, mas **não gera etiqueta nem código de devolução**. Nenhum fluxo reverso foi chamado ou comprado nesta etapa. A implementação da compra/geração reversa permanece fora de escopo até existir ambiente verificável e decisão explícita de custo.
