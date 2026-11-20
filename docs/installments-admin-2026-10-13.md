# Parcelamento e juros administráveis — 13/10/2026

O módulo fica em **Configurações → Pagamentos → Parcelamento e Juros**, com salvamento próprio. A proposta inicial é desativada: até 12x, faixa de até 6x sem juros, juros da cliente acima dessa faixa, mínimo adicional zero (somente opções do provedor). Nenhuma proposta ou aprovação foi gravada em produção nesta implementação.

## Controles e aprovação

Administradores autenticados pelo Supabase podem salvar propostas, simular, registrar aprovação explícita dos custos/homologação e ativar separadamente. Faixa, responsabilidade pelo financiamento e ambiente delimitam a aprovação. TEST não aprova produção. Mudanças nesses limites exigem nova aprovação no painel; não exigem código ou Railway. Ajustes de mínimo e mensagem são validados no backend. Ativação consulta novamente o provedor e exige uma faixa completa para a mesma bandeira/emissor no valor de referência. Cada cartão/valor continua sujeito à validação no checkout.

O estado é armazenado no JSONB existente de `settings`, chave privada `credit_installments`. A rota genérica de settings não pode escrever essa chave. Alterações usam versão esperada, trava transacional e auditoria no backend. Não há migration nem mudança de RLS. Sem cadastro/aprovação, permanecem as proteções anteriores e limite efetivo 1x. O gate legado não foi ativado; o módulo usa uma aprovação específica em banco para a homologação futura.

## Simulação e valores

O simulador consulta `/v1/payment_methods/installments`, sem criar orders, tokens ou pagamentos. Juros da cliente = total retornado em `payer_costs.total_amount` menos valor original, em centavos. A taxa e o valor por parcela também vêm do provedor. Não se multiplica a parcela arredondada para substituir o total: ajustes residuais de centavos seguem o provedor.

Financiamento assumido pela boutique exige planos com taxa zero para a cliente na conta; não se envia `installments_cost`, parâmetro do Point, na integração online. Taxa de processamento, custo de financiamento da boutique e líquido estimado aparecem como **Não disponível / depende das condições da conta**, pois esta consulta não fornece esses custos com confiabilidade.

Consulta visual real com SDK, chave pública atual de TEST, Mastercard oficial de teste e compra R$ 500,00: 12x disponíveis com taxa informada 22,11%, total R$ 610,55 e parcela exibida R$ 50,88. As opções 2x–6x têm juros; não confirmam 6x sem juros. Essa observação vale para o cartão/valor/ambiente consultados, não comprova produção ou outros emissores. A consulta administrativa no backend é validada novamente após o deploy.

## Checkout e tentativa financeira

O `cardPayment` existente e seus Secure Fields são preservados. Limite nativo agora suporta até 12; débito continua 1. Como o SDK documenta apenas intervalo min/max, um adaptador da opção nativa desabilita/oculta quantidades fora das ofertas retornadas pelo backend e não toca nos Secure Fields. Nenhuma remontagem por digitação foi introduzida. Seleção/total da cliente são apresentados antes da confirmação; ausência de oferta válida impede parcelamento. Se a estrutura do SDK não permitir reconhecer a seleção, a confirmação parcelada falha antes da chamada financeira.

O backend consulta novamente cartão/bandeira/emissor/valor e compara todos os campos da oferta esperada. Dentro da reserva, serializa mudanças das condições e verifica novamente a configuração e o método habilitado. A oferta é gravada em `orders.snapshot.card_installment_offer`, sem BIN, PAN, CVV ou token. A criação continua usando o valor original da compra, sem somar juros do provedor duas vezes; Orders recebe original e quantidade de parcelas. A leitura oficial posterior exige valor original, moeda, método, quantidade e valor da parcela compatíveis. Emissor divergente, quando informado no retorno, é rejeitado. Ausência de dados necessários ou divergência exige conciliação; não aprova nem abre outra tentativa.

Tentativas iniciadas usam a oferta gravada e não a configuração posterior. A idempotência/trava por pedido permanece. Estoque, descontos, frete e cupons não são recalculados por regras de financiamento. Pix e débito não usam esta configuração. Erro de oferta anterior à reserva é identificável como `attempt_started=false`; erro financeiro ambíguo mantém a tentativa bloqueada.

## Homologação pendente

É necessário configurar na conta as modalidades/custos desejados, obter aprovação explícita da Juliane e homologar financeiramente no ambiente correspondente, incluindo os campos de retorno exigidos. Depois, a aprovação e a ativação podem ser feitas no módulo. Os testes usam mocks para qualquer operação financeira; consultas e renderização reais não equivalem à homologação financeira.

Manutenção ON, Data API OFF, retirada OFF, desconto Pix OFF e Mercado Pago TEST preservados. Credenciais e webhook não foram alterados; nenhum pagamento, pedido ou reembolso real foi criado. Main e PR #3 permanecem intactas.

Referências: [Card Payment e intervalo nativo](https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md), [cartões na Orders API online](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/cards), [referência de criação Orders](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post), [configuração de financiamento Point — produto distinto](https://www.mercadopago.com.br/developers/pt/docs/mp-point/payment-processing).
