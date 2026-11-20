# Expedição do pedido pago DH-2026-000019

O pedido permanece pago e `cart_inflight`, sem `melhor_envio_shipment_id`. Não repetir
`/me/cart`, comprar etiqueta ou alterar `shipping_packages` enquanto a conciliação
oficial não estiver completa.

## Evidência de 12/11/2026

- Item comprado: shorts Angel, bege P, uma unidade, R$ 30,00; frete cobrado
  R$ 9,98, total R$ 39,98, SEDEX (serviço 2), produção.
- Medidas do item no registro original: 0,4 × 0,1 × 0,1 cm e 0,3 kg.
  Volume retornado pela cotação e gravado em `snapshot.shipping_packages`:
  0,4 × 8 × 13 cm e 0,3 kg. O código enviava este último volume a `/me/cart`.
- O cadastro atual mostra 5 × 25 × 30 cm e 0,3 kg, sem confirmação de que
  corresponde ao pacote fechado. Não copiar esses valores para o pedido.
- A NFC-e 65 apresentada foi autorizada no portal fiscal. A integração comercial
  atual exige NF-e 55 válida. Confirmar com a contabilidade o documento adequado.
- `GET /me/cart?page=1` retornou HTTP 200, zero itens. Consultas de
  `/me/orders?status=...` com o token existente retornaram HTTP 403. O fluxo
  OAuth configurado solicita `cart-read`, mas não `orders-read`; a documentação
  do Melhor Envio atribui a visualização de etiquetas a `orders-read`. Isso
  explica o bloqueio como hipótese forte, sem demonstrar os escopos do token
  produtivo atual. Não ampliar escopos nem trocar credenciais nesta operação.
  A consulta ao carrinho vazio não comprova ausência de etiqueta.
- O backend anterior descartou o corpo do HTTP 422; a chave efetivamente
  enviada e o campo rejeitado não são recuperáveis dos registros disponíveis.

## Próxima operação, somente após evidência adicional

1. Juliane mede e pesa o **pacote fechado**, informando altura, largura,
   comprimento em centímetros e peso em quilogramas. Para SEDEX via Melhor
   Envio, mínimo 1 × 8 × 13 cm e máximo 100 cm por lado, 200 cm na soma,
   30 kg. As medidas de 5 × 25 × 30 cm são apenas estimativa.
2. Obter confirmação do Melhor Envio de que a conta produtiva não possui
   etiqueta para `DH-2026-000019` no carrinho, pendentes, liberadas, postadas
   ou canceladas; incluir eventual ID e protocolo, com paginação completa.
   Consultar `Meus Envios` na conta oficial, inclusive as abas de aguardando
   pagamento, liberados e postados, pesquisando número do pedido, destinatária
   e data. Se a interface não oferecer evidência completa, abrir ticket de
   suporte com o horário da tentativa e pedir busca nos registros do provedor.
   Consultas API de etiquetas exigirão autorização separada para o escopo
   `orders-read` e nova autorização OAuth. Uma tela vazia do carrinho não basta.
3. Conferir com a contabilidade a NF-e 55 correspondente à venda. Não trocar
   a chave por outra nota sem correspondência fiscal comprovada.
4. Fazer nova **cotação sem compra** com as medidas reais. Comparar o custo
   da etiqueta com os R$ 9,98 já cobrados. Se houver diferença, registrar a
   decisão operacional antes da contratação.
5. Só após essas evidências e autorização específica, executar em transação
   uma atualização condicionada de `snapshot.shipping_packages` e
   `shipping_status`, preservar o volume original em
   `snapshot.shipping_package_amendments`, registrar motivo, operador,
   evidência da conciliação, `order_events` e `audit_logs`. Exigir que
   `payment_status='approved'`, `shipping_status='cart_inflight'`,
   `melhor_envio_shipment_id IS NULL`, pedido e volume original ainda
   coincidam. Abortá-la diante de qualquer divergência.
6. A preparação poderá ocorrer uma única vez após a correção verificada;
   comprar, gerar, imprimir e postar continuam etapas separadas. Conferir
   o custo oficial antes de autorizar qualquer compra de etiqueta.

Nenhum desses passos altera o pagamento, o valor cobrado, os itens, as
quantidades, o estoque ou o histórico da compra.
