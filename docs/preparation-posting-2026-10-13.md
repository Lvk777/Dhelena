# Preparação e postagem — aprovação de 13/10/2026

O responsável aprovou até **2 dias úteis após a confirmação do pagamento**, incluindo a entrega efetiva à transportadora dentro do horário de corte. A configuração autorizada é `shipping.melhor_envio_extra_days=2` com `SHIPPING_PREPARATION_ENABLED=true` no backend.

## Comportamento

- A cotação, a prévia e a confirmação somam a preparação ao prazo conservador da transportadora. Exemplo: 2 + 3 = até 5 dias úteis.
- Carrinho, checkout e detalhes do pedido usam o mesmo formato. O pedido mantém o prazo comprado no snapshot; configurações posteriores não alteram pedidos antigos.
- Um prazo que muda ou desaparece na confirmação gera 409 e exige nova prévia antes da compra.
- A contagem começa no primeiro dia útil seguinte à confirmação; sábados, domingos e feriados aplicáveis não contam. A aplicação apresenta uma duração em dias úteis, sem inventar uma data de chegada. Não há cálculo de calendário de feriados municipais/transportadora nem homologação de datas exatas.
- Intervalos contraditórios ou durações fracionárias não viram uma promessa por arredondamento. Valores monetários continuam calculados em centavos no backend.
- `shipping.preparation` no GET público de configurações reflete o flag do backend em execução, sem expor origem, remetente ou credenciais.

## Verificação

Os testes com mocks cobrem soma, intervalos, bloqueio de divergência entre prévia/confirmação, snapshot histórico, confirmação em sexta-feira/fim de semana/feriado sem conversão para data corrida, centavos, cupons, frete grátis e estoque. Não criam pedidos ou pagamentos reais.

Somente a Política de Entrega tem publicação autorizada nesta etapa. Trocas e Devoluções, Termos de Uso e Privacidade continuam minutas. O comprovante do CNPJ já foi conferido em fonte oficial; isso não autoriza automaticamente publicar os dados legais.

Manutenção deve continuar ON; Data API, retirada e desconto Pix, OFF. Main permanece intacta e PR #3 sem merge. A aprovação deste prazo não substitui a conclusão das pendências de frete em produção e da inauguração.
