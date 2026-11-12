# Pagamentos — conclusão técnica de 13/10/2026

## Implementação e validação

- O Card Payment Brick usa `cardPayment`, idioma pt-BR, IDs próprios por instância, carregamento com tempo limite, nova tentativa de carregamento e descarte de controladores atrasados. O formulário **renderizou no navegador com o SDK real**, para crédito e débito, incluindo iframes de número, validade e código de segurança. Uma prévia local utilizou o componente real com chamadas financeiras bloqueadas; nenhum dado de cartão foi preenchido ou tokenizado.
- Crédito usa `credit_card`; Elo Débito usa `debit_card`, exclusivamente à vista. O backend valida o tipo retornado pelo SDK contra o método do pedido e a lista atual da conta, incluindo limites de valor. O emissor agora é repassado corretamente. O navegador não define valores cobrados.
- Parcelamento fica à vista até aprovação comercial explícita (`CREDIT_INSTALLMENTS_APPROVED=true` mais limite configurado de parcelas sem juros). O máximo é 6; cada opção exige confirmação do provedor com taxa zero e total igual ao pedido. Esse flag não foi ativado nesta etapa.
- Pix mantém o fluxo Orders API e a confirmação pelo provedor. O desconto de 5% permanece desativado. Os testes cobrem a oferta futura apenas sobre os produtos, sem acúmulo com cupom/promoção e sem desconto sobre o frete.
- “Alterar método de pagamento” preserva o mesmo pedido, preços comprados, frete registrado, reservas de estoque e uso de cupom. Exige prévia do backend e confirmação do total. Aplica-se somente a pedidos recebidos, pendentes e sem tentativa financeira, provedor, identificadores ou histórico financeiro. Pedidos com Pix emitido, tentativa ambígua, recusa já registrada ou pagamento em análise exigem conciliação; não são resetados para outra cobrança.
- Crédito, débito, Pix e troca de método compartilham a trava do pedido. A reserva financeira confere novamente método e total após a trava. Reserva e persistência utilizam a conexão que detém a trava, evitando esgotamento do pool por concorrência. Repetições usam chave idempotente; timeout não libera nova tentativa.
- Respostas `failed`, `canceled` e `expired` da Orders API são tratadas como não aprovadas. Um desafio 3DS permanece pendente e só um GET verificado pode aprovar. O iframe aceita apenas o caminho HTTPS oficial de autenticação do Mercado Pago brasileiro. O flag `CARD_3DS_ENABLED` continua sem ativação automática e exige homologação específica.

## Evidência e limites de homologação

A consulta não financeira de métodos respondeu com as credenciais atuais em ambiente **Teste**: crédito e **Elo Débito (`debelo`)** disponíveis. A chave pública carregou o SDK real; isso valida a renderização e o acesso à listagem, sem comprovar autorização de uma transação ou a correspondência operacional em produção. A listagem auxiliar não é uma prova de Pix na Orders API: o fluxo também depende da configuração da conta e da chave Pix.

Os testes automatizados usam mocks de PostgreSQL, SDK e Mercado Pago. Cobrem aprovação, recusa, análise, desafio, timeout, divergência de valor, dono do pedido, parcelas, concorrência, idempotência, centavos, descontos, estoque e cupons. Não foram criadas cobranças reais nem novas transações de teste externas.

Verificação local final: **293/293 testes**, lint, typecheck e build aprovados.

Ainda falta homologação transacional de crédito e Elo Débito, incluindo 3DS quando aplicável, validação de Pix na conta de produção e aprovação comercial/operacional do parcelamento sem juros. A oferta Pix de 5% exige homologação e aprovação da Juliane antes de ativar. Mocks e renderização não equivalem à homologação financeira.

Manutenção permanece ON, Data API e desconto Pix OFF. Nenhuma credencial de produção, migration, RLS ou webhook foi alterado. Main e PR #3 permanecem sem alterações/merge.

Fontes oficiais consultadas:

- [Cartões via Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/cards)
- [Tipos e parcelas no Card Payment](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/additional-settings/websites/behavior-customizations)
- [Pix via Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix)
- [Meios disponíveis na conta](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/payment-methods/get)
- [3DS via Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/integrate-3ds)
