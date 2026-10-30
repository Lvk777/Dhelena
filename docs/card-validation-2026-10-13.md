# Validação de cartão e parcelas — 13/10/2026

## Causa reproduzida e correção

Com o componente real e SDK oficial, um número sintético inválido produziu a sequência `create → onReady → onError {type: non_critical, cause: missing_payment_information} → unmount`. O adaptador tratava qualquer `onError` como falha fatal; o React ocultava o container. Esse comportamento explica o desaparecimento relatado no checkout. Nenhum pedido real foi alterado nessa reprodução.

Agora erros de validação deixam o mesmo formulário visível, com as mensagens do SDK. Tokenização e consultas de BIN/emissor/parcelas têm tratamento recuperável separado. Falhas de inicialização/Secure Fields, rejeição da criação e timeout anterior a `onReady` permitem recarregar o formulário. `onReady` encerra o timeout uma única vez; digitação e estados de erro não recriam o Brick. Identificadores exclusivos e substituição do container nas mudanças reais de inicialização evitam interferência de controllers antigos.

Na verificação real após a correção, número inválido, validade inválida, CVV incompleto e cartão Elo Débito inserido no fluxo de crédito mantiveram os Secure Fields visíveis. Corrigir para o Mastercard oficial de teste removeu a validação sem nova criação ou `unmount`. O botão de pagamento não foi acionado; todas as chamadas financeiras da prévia estavam bloqueadas.

## Parcelamento

O backend permanece com `max_installments=1` e `interest_free_approved=false`. O flag comercial não foi ativado. Crédito está à vista; débito e Pix são exclusivamente à vista.

Consulta não financeira com as credenciais atuais de TEST, Mastercard de teste, BIN 54808328 e valor R$ 50,00: 1x com taxa zero; opções de 2x a 6x com juros. A opção 6x retornou taxa 14,32 e total R$ 57,16. Isso não confirma 6x sem juros para produção.

Em uma prévia local com limite 6, após reconhecer o número de cartão o SDK apresentou **Selecione o número de parcelas**, abaixo do documento do titular e antes do e-mail. As opções vieram do provedor, limitadas a 6; a alteração existiu somente na prévia, sem mudar o flag do backend. A ativação comercial exige aprovação explícita e confirmação de planos sem juros na conta.

O backend confere método/bandeira, emissor, quantidade, taxa explicitamente zero e total em centavos igual ao pedido antes de aceitar parcelamento. Plano de outra bandeira/emissor, taxa ausente ou juros são recusados. Valores de pedidos continuam calculados e validados no backend.

## Validação e limites

Regressão automatizada cobre cartão inválido/incompleto, BIN e tipo não aceitos, validade/CVV inválidos, erros recuperáveis de tokenização/comunicação, falha crítica, timeout e controller tardio, além das suites de pagamentos, concorrência, idempotência, estoque, cupons e descontos. Verificação visual usa SDK real; não equivale à homologação financeira em produção.

Manutenção ON, Data API OFF, retirada OFF e desconto Pix OFF preservados. Nenhuma credencial, webhook ou configuração financeira foi alterada. Main e PR #3 preservadas.

Referências oficiais: [Card Payment Brick](https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md), [erros dos Bricks](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/additional-content/possible-errors), [métodos SDK e getInstallments](https://github.com/mercadopago/sdk-js/blob/main/docs/core-methods.md), [cartões de teste Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/cards).
