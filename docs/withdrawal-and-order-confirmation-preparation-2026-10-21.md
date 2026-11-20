# Preparação local: arrependimento e confirmação do pedido

Base publicada na PR #3: `286f3ea`. As alterações descritas aqui são **posteriores e somente locais**. Não foram enviadas, implantadas, nem habilitadas em produção.

## Fluxo preparado

1. A cliente autenticada pode registrar, na página do próprio pedido, uma manifestação de arrependimento sem indicar motivo e sem esperar a expedição. O backend confirma imediatamente o recebimento com data e protocolo persistidos em `order_events`. Repetir o pedido devolve o mesmo protocolo. O registro não cancela pedido, não estorna, não altera estoque, não compra/cancela etiqueta e não aciona provedor.
2. A rota `POST /api/orders/:id/withdrawal-request` e o botão da conta dependem de `WITHDRAWAL_REQUESTS_ENABLED=true`; o padrão é **desativado**. Se desativada, a conta indica o canal de contato existente. Nenhuma variável foi criada ou alterada.
3. Com a rota habilitada, a solicitação bloqueia **novas** tentativas Pix/cartão, troca do método de pagamento, avanço administrativo de expedição e operações de etiqueta. O registro usa a mesma trava de tentativa de pagamento e a trava da linha do pedido. Tentativas já iniciadas e webhooks posteriores exigem conciliação humana.
4. Depois da criação do pedido, a tela informa separadamente que o pedido foi recebido e que o pagamento segue pendente. Ela oferece um arquivo texto com itens, valores, entrega e endereço do pedido. A página autenticada do pedido também permite salvar o comprovante a partir dos dados persistidos. O arquivo não afirma pagamento aprovado nem substitui o contrato ou as políticas definitivas.

## Provas locais

- `backend/test/withdrawal-request.test.js`: propriedade do pedido, idempotência, ausência de ações financeiras e bloqueio de nova operação após o registro.
- `src/lib/orderReceipt.test.js`: total e itens fictícios no comprovante, sem falsa confirmação de pagamento.
- `npm test` em `backend/`: 466/466 testes aprovados. `npm run lint`, `npm run typecheck`, `npm run build` e `npm run test:static`: aprovados.
- Nenhuma chamada a Mercado Pago, Melhor Envio, Resend ou banco produtivo foi feita nestes testes.

## Pendências antes de habilitar

- **Advogada:** aprovar textos definitivos, prazo/marco do arrependimento, conteúdo do contrato disponibilizado em meio conservável e mensagens de atendimento. O código não fixa uma janela de sete dias nem rejeita automaticamente pedidos tardios, evitando negar um direito com data de entrega incerta. A equipe deve analisar cada solicitação.
- **Operação:** definir fila com responsável, alerta e SLA para tratar pedidos recebidos, inclusive pagamento em andamento, etiqueta já comprada, postagem e comunicação imediata ao provedor financeiro quando cabível. Hoje o registro fica na linha do tempo do pedido; não há alerta automático nem execução de estorno.
- **E-mail e contrato:** homologar SMTP/Resend e a entrega durável da confirmação/contrato com conteúdo jurídico aprovado. Notificações automáticas permanecem OFF. O comprovante baixável é um apoio local, não demonstra sozinho o cumprimento integral do Decreto 7.962/2013.
- **Staging:** testar Auth, banco/RLS, conta, concorrência, webhooks, pagamentos simulados e logística simulada com a flag habilitada, mantendo dados fictícios. Confirmar que pedidos legados e scripts de segurança permitem a consulta a `order_events`.
- **Produção:** só em autorização separada, publicar e homologar o código, configurar a flag e monitorar solicitações. Se for necessário suspender novas solicitações, desativar a flag; registros já recebidos devem continuar preservados e tratados.

Referências para a revisão jurídica: [CDC, art. 49](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm) e [Decreto 7.962/2013, arts. 4º e 5º](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm).
