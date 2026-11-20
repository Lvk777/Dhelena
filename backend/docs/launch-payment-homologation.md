# Homologação produtiva de pagamentos — roteiro para aprovação

**Estado:** somente planejamento. Nenhum pedido, cobrança, estorno ou alteração de configuração é autorizado por este documento.

## Dados que precisam ser aprovados antes da execução

- SKU, variante, preço, estoque e modalidade de entrega de cada compra de teste, confirmados pela Juliane imediatamente antes do ensaio.
- Pagador autorizado e forma de pagamento para cada cenário: Pix, crédito e Elo Débito. Não registrar dados pessoais nem dados de cartão neste repositório.
- Teto **por transação** e teto **total**, incluindo frete e juros, além de quem arcará com os valores. Não presumir que um produto ou preço atual seja adequado para teste.
- Janela, operador responsável, acesso de leitura aos pedidos e ao Mercado Pago e estratégia aprovada para manutenção. O backend bloqueia criação de pagamentos durante a manutenção; qualquer abertura temporária exige autorização própria.
- Condições comerciais reais do Mercado Pago para crédito até 12x e disponibilidade efetiva do Elo Débito. A configuração de 12x e a oferta de 5% no Pix permanecem desligadas até homologação separada.

## Pré-voo somente leitura

1. Confirmar manutenção ligada, Data API desligada, Mercado Pago em produção, flags de Pix e parcelamento no estado aprovado e ausência de outra operação de teste em andamento.
2. Conferir produto, variante, estoque, peso, preço, cupom e frete pelo catálogo e pela prévia do checkout. A prévia deve bater com o total calculado pelo backend. Não criar cupom produtivo apenas para obter um total baixo.
3. Confirmar credencial, aplicação e vendedor do Mercado Pago sem revelar segredos; verificar assinatura e processamento do webhook, schema, índices de idempotência e capacidade de conciliação por GET.
4. Registrar a linha de base de pedidos, tentativas, eventos, usos de cupom e movimentos de estoque apenas por contagens e IDs técnicos. Não consultar dados de clientes alheios ao ensaio.

## Execução futura, somente após autorizações específicas

1. Fazer **uma** compra controlada por vez. Para cada método, enviar uma chave de idempotência nova; repetir a mesma requisição apenas com a mesma chave. O backend deve persistir um pedido, um débito de estoque e no máximo uma tentativa financeira.
2. Pix: confirmar pedido e valor antes de criar a Order no provedor; obter o QR apenas uma vez; conferir por GET a Order, o total, a referência e o estado. Aguardar webhook real e verificar uma única transição de pedido. Se a resposta for incerta, conciliar por GET e parar.
3. Crédito: testar uma parcela inicialmente. Antes de testar 12x, comparar a oferta oficial da bandeira e emissor com o valor total do comprador e obter aprovação separada das condições reais. Nunca anunciar “sem juros” quando a oferta cobrar juros.
4. Elo Débito: confirmar disponibilidade oficial para a credencial produtiva e enviar como `debit_card`, uma parcela. Um desafio ou recusa fica pendente de confirmação oficial, sem criar segunda cobrança.
5. Cupons e frete: testar em cenário separado apenas se a Juliane aprovar valores e condições. Conferir que total, desconto, frete, estoque e uso do cupom batem com o snapshot persistido.
6. Após cada cenário, conferir webhook assinado, idempotência, status do pedido e conciliação. Registrar recusas ou timeouts como pendência; não repetir, cancelar nem estornar automaticamente.

## Condições de parada

Parar antes da cobrança se preço, estoque, frete, desconto, credencial, aplicação, vendedor ou total divergirem. Depois de uma tentativa ambígua, usar apenas consultas oficiais de leitura; não gerar nova tentativa. Qualquer cancelamento, estorno, etiqueta ou mudança de flag requer autorização separada.

**Resultado exigido para aprovar a abertura pública:** evidência de uma única cobrança por tentativa, total correto, webhook real deduplicado, estado do pedido coerente e reconciliação sem efeito financeiro duplicado. Este roteiro não substitui a etapa bloqueadora de segurança do Supabase.
