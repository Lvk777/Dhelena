# D’Helenas — ensaio de inauguração (18/11/2026)

## Worker Mercado Pago

O deployment anterior do backend registrou `mp_webhook_worker_failed` em 15–17/11, com `http_status=500`, `error_type=Error` e `error_code=null`. A mensagem e a etapa não eram registradas para proteger dados privados. Houve também uma queda comprovada por erro de cliente PostgreSQL ocioso; o listener do pool já está publicado no SHA `132ca59336faf02d1c57d21d54576ca63e729886`.

Em 18/11, a seleção SQL do worker foi executada dentro de `BEGIN READ ONLY` no banco de produção: esquema `payload=jsonb`, seleção válida e zero eventos Mercado Pago pendentes. Havia um evento Mercado Pago processado. A causa de cada 500 histórico não é recuperável dos registros antigos. O worker agora registra uma etapa fixa (`credentials`, `db_connect`, `db_begin`, `queue_select`, `event_processing` ou `retry_checkpoint`) e o SQLSTATE de cinco caracteres, sem mensagem, consulta ou dados pessoais. Falha temporária de conexão é repetida no tick seguinte; os testes verificam ausência de chamadas ao provedor e de gravações quando a fila não foi selecionada.

Após o deploy, monitorar `mp_webhook_worker_failed`, `db_idle_client_error` e `api_request_failed` por pelo menos um ciclo operacional. Se surgir novo 500, usar etapa e código para isolar a operação. Não reprocessar eventos antigos apenas pela presença de um erro de worker.

Até 08:25 UTC de 18/11, aproximadamente cinco horas após o backend `ad004467d39ff20a9098ece3bac054087b61f38d` iniciar, seus logs continham apenas sete registros de inicialização e nenhum novo erro. Isso ainda não comprova que a falha periódica histórica cessou; o monitoramento deve cobrir ao menos um período em que ela costumava reaparecer.

## Pedido DH-2026-000019 / Melhor Envio

Leitura em 18/11: pagamento `approved`, status `pagamento_aprovado`, envio `cart_inflight`, ID Melhor Envio ausente, SEDEX, mercadorias R$ 30,00, frete R$ 9,98, total R$ 39,98. Há apenas eventos de criação e pagamento; não há evento de etiqueta preparada ou comprada. O endpoint de leitura `/me/cart` respondeu 200 e lista vazia. A busca histórica `/me/orders/search?q=DH-2026-000019` respondeu 403 com o escopo atual. Carrinho vazio não prova que não houve envio. O checkpoint `cart_inflight` é deliberado: preserva a incerteza se a chamada externa terminou sem resposta ou se houve interrupção antes de gravar o ID. O código bloqueia repetição da preparação e compra.

Recuperação segura, ainda **não executada**:

1. Obter no painel/suporte Melhor Envio o histórico completo de carrinho, pedidos e etiquetas por número/tag `DH-2026-000019`, data da tentativa e conta de produção; registrar IDs, estado, preço e prova de inexistência ou existência de compra/geração. O 403 exige acesso apropriado ou resposta formal do provedor, sem ampliar escopos automaticamente.
2. Conciliar a NF-e modelo 55 já emitida com a contabilidade. A nota conhecida tem mercadorias e frete divergentes do pedido; não emitir outra nem associar a chave enquanto houver divergência.
3. Sob autorização operacional específica, travar o pedido, comparar estado e `updated_at` com o registro lido, anexar evidência do provedor à auditoria e somente então decidir entre vincular o ID oficial já existente ou liberar uma única nova preparação. Não avançar por inferência de carrinho vazio. Nunca comprar etiqueta sem confirmação específica e preço atual.

Nova leitura confirmou que o checkpoint do pedido 19 tem apenas `shipping_operation.version`, sem horário da tentativa, e `updated_at=2026-11-03T14:42:25Z`. Não é possível atribuir retrospectivamente a falha a timeout, rejeição ou interrupção do processo sem histórico do provedor.

## Estoque publicado e pedido 18

O único produto publicado é `shorts Angel` (SKU `2026@`), cor Bege, tamanhos PP, P, M, G e GG. Todos têm disponibilidade zero. A reserva ativa de uma unidade PP pertence ao pedido `DH-2026-000018`, pendente desde 28/10; uma unidade P foi vendida no pedido 19. Assim, o resumo do modelo atual é físico 1, reservado 1, disponível 0 e vendido confirmado 1. Juliane precisa confirmar a quantidade física antes de ajustar o catálogo.

O pedido 18 tem tentativa de cartão iniciada, contexto de pagamento gravado e nenhum ID de order ou pagamento Mercado Pago associado. Não possui marcador de expiração. A regra de expiração intencionalmente não libera estoque após qualquer indício de tentativa financeira, mesmo sem ID local, para evitar vender a mesma peça antes de uma conciliação oficial. Não foi feita liberação, cancelamento ou mudança de estoque. Para resolver essa reserva, obter evidência oficial de que não há cobrança pendente/aprovada para a tentativa e definir uma recuperação auditada e autorizada; a idade do pedido isoladamente não é prova suficiente.

## Compra completa e notificações

Os testes de backend cobrem seleção/variação, preço, desconto, frete, pedido, estados de pagamento, webhook duplicado, timeout, estoque/reserva, expedição, rastreamento e políticas de cancelamento. A integração PostgreSQL 17 de operações, estoque, autenticação, segurança e e-mail roda no CI. O painel e a loja exigem ensaio final de compra real controlada **após** remover manutenção, com valor pequeno aprovado pelo responsável, confirmação de pagamento e conciliação de estoque, e-mail e envio; nenhuma transação real foi criada nesta revisão.

E-mails continuam desligados. Na futura ativação, definir `TRANSACTIONAL_EMAIL_ADMIN_RECIPIENT=pedidos@dhelenas.com`, manter remetente `D’Helenas Boutique <pedidos@dhelenas.com>` e resposta `pedidos@dhelenas.com`, verificar domínio/Resend e escolher `TRANSACTIONAL_EMAIL_START_AT` em UTC imediatamente antes da ativação. Sem destinatário administrativo explícito e válido, a fila e o worker não iniciam, mesmo se a flag for ligada; a lista legada de pessoas nunca é usada como fallback. A fila só descobre eventos com marcador de versão, ambiente e horário posterior ao corte; o worker usa payload e chave idempotente congelados e abandona tentativas após a janela de idempotência. Os testes simulados cobrem pedido recebido, pagamento aprovado, cancelamento, envio e entrega. Ligar `TRANSACTIONAL_EMAIL_ENABLED=true` somente com autorização separada; não enviar retroativamente.

Para reverter uma ativação futura, definir `TRANSACTIONAL_EMAIL_ENABLED=false`, confirmar o worker parado e inspecionar a fila antes de qualquer nova tentativa. Não apagar marcadores de eventos nem criar um corte retroativo: um envio que já foi aceito pelo provedor pode estar em trânsito, e a mesma chave deve ser preservada para conciliação.

## NF-e e manutenção

A migration 022 permanece fora de produção e `FISCAL_XML_IMPORT_ENABLED=false`. O ensaio PostgreSQL 17 cria papéis `anon` e `authenticated`, reaplica 022, verifica RLS e revogação de leitura/escrita, tenta leitura efetiva sob ambos os papéis e disputa duas inserções simultâneas da mesma nota, das quais somente uma pode persistir. O importador mantém XML em `BYTEA` privado, bloqueia XML estruturalmente inválido, compara emitente, destinatário, itens, quantidade, mercadorias, frete e total, e só permite uso da chave após conferência oficial administrativa. XML sozinho não prova autorização vigente. Não aplicar 022 nem ligar a flag sem autorização específica e XML real compatível.

Manutenção, Data API, login por código, proteção administrativa adicional, notificações transacionais, deploy automático e compra de etiquetas permanecem nos estados protegidos atuais. A abertura depende de ausência de falha crítica em pagamento/estoque/checkout/expedição, conciliação do pedido 19 e homologação controlada do fluxo real.
