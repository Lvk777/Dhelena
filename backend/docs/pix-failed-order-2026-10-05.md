# Auditoria Pix TEST — DH-2026-000009

## Evidência preservada

- Pedido `DH-2026-000009`, ID `0418e31c-e332-4405-a2dc-b386048894ee`, R$ 50,00. O relato do ensaio registra uma tentativa de POST ao provedor, HTTP 400, `payment_status=pending`, estoque 5 → 4 e uso de cupom 1. Os IDs MP foram relatados como nulos.
- Em 2026-10-06 UTC, uma nova consulta **somente GET** a `GET /v1/orders`, com `external_reference=DH-2026-000009`, intervalo de 2026-10-01 até o instante da consulta, `type=online`, página 1 e tamanho 10, respondeu HTTP 200, `paging.total=0` e zero registros correspondentes. A primeira tentativa de GET com intervalo de setembro a outubro e tamanho 100 recebeu HTTP 400 e não serve como evidência de ausência. A credencial dessa busca veio do arquivo local `run/base44/app.env`; ainda é preciso conferir sua equivalência com a credencial TEST do backend implantado antes de cancelar. Nenhum POST foi feito ao Mercado Pago nesta auditoria.
- Consultas `SELECT` no SQL Editor do projeto Supabase da D'Helenas confirmaram o pedido `recebido / pending`, `mercado_pago_order_id=NULL`, `mercado_pago_payment_id=NULL`, `payment_attempt_started_at=2026-10-06 00:33:13.935339+00`, um uso do cupom, uma Blusa Serena tamanho M com estoque atual 4 e zero restaurações de cancelamento. Nenhum `UPDATE`, `DELETE` ou operação financeira foi executado.

## Causa e política

Antes da correção, a rota criava `identification: { type: 'CPF', number: '' }` quando o snapshot não tinha CPF. `JSON.stringify` preserva a string vazia. Esse payload diverge do [exemplo oficial Pix TEST](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix), que usa R$ 50,00, `test_user_br@testuser.com` e `APRO` sem `identification`. O payload exato do POST antigo não foi capturado; a implementação demonstra o que teria sido enviado com CPF vazio, mas a resposta 400 original não prova sozinha que esse campo foi a única causa.

O `payment_attempt_started_at` é gravado antes do POST. O `catch` do Pix não limpa o campo após HTTP 400; o pedido fica bloqueado para outro pagamento e para cancelamento simples. A mudança mantém esse bloqueio. O diagnóstico novo marca HTTP 400 como **candidato a rejeição antes da criação, dependente de conciliação**. Timeout, erro de rede, 5xx, parse de resposta e falha após receber ID MP são ambíguos. Nenhuma categoria libera retry automaticamente. Nenhuma tentativa pode reutilizar este pedido.

## Plano de limpeza futuro — não executado

1. Repetir a busca oficial por referência **com a credencial TEST efetivamente implantada no backend** imediatamente antes da ação e obter zero Orders em todas as páginas pertinentes. Confirmar com GET administrativo ou SQL somente leitura que `mercado_pago_order_id` e `mercado_pago_payment_id` continuam nulos, `payment_status=pending`, `payment_attempt_started_at` presente, estoque 4, uso de cupom 1 e ausência de outras tentativas ou eventos financeiros. Confirmar também que não há pagamento em conciliação nem expedição.
2. Com aprovação operacional separada, implementar uma ação administrativa exclusiva para encerrar **esta** tentativa falha. Dentro de uma transação, bloquear a linha do pedido, reconfirmar os campos locais e registrar decisão e evidência da consulta ao provedor em auditoria. Limpar apenas o marcador de tentativa depois da prova de ausência. Executar a lógica normal de cancelamento de pedido não pago na mesma transação, com `restoreStock` e sua proteção de idempotência. Não fazer `UPDATE` direto do estoque.
3. Confirmar `status=cancelado`, uma única restauração de 4 → 5, zero refund, nenhuma reativação automática do cupom e histórico completo preservado. Se surgir qualquer Order ou ID MP, interromper esse plano e conciliar manualmente.

Até a etapa 2, o pedido **não está liberado para cancelamento** pelo fluxo atual porque o marcador bloqueia `canCancelWithoutRefund`. A ação futura jamais deverá iniciar novo Pix para `DH-2026-000009`.
