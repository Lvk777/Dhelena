# Preparação automática de envios — D'Helenas

## Fluxo para pedidos futuros

1. O pedido é pago e guarda a modalidade, a cotação, o destinatário e o volume original no banco.
2. Juliane importa o XML **modelo 55** da NF-e (ou registra os dados fiscais pelo fluxo administrativo aplicável); a aplicação concilia cliente, itens, quantidades, valores e emitente. **A importação, por si, não libera o envio.**
3. Juliane confere o protocolo, a autorização atual e os dados completos no portal fiscal oficial e registra as duas confirmações. A atualização fiscal e o evento `shipping_auto_prepare_requested` são confirmados na **mesma transação**.
4. O worker, quando habilitado, consome **apenas eventos novos**, verifica novamente o pagamento e a NF-e oficial, preserva a cotação e chama a ação existente `prepare`, que insere **uma etiqueta não paga** no carrinho do Melhor Envio.
5. O painel mostra a preparação em andamento e, quando confirmada, o ID e o valor da etiqueta. Comprar (com confirmação explícita de preço), gerar e imprimir continuam **etapas manuais**, dependentes das permissões operacionais existentes.

## Proteções

- `AUTO_SHIPPING_PREPARE_ENABLED=false` por padrão; nunca reprocessa pedidos anteriores por varredura histórica.
- `FISCAL_XML_IMPORT_ENABLED=true` é pré-requisito; o estado fiscal precisa estar `verified`, com fonte oficial, conferente e sem diferenças.
- Somente pedidos pagos, não cancelados, de modalidade Melhor Envio e ambiente comprovado de produção podem entrar na fila. Um pedido com etiqueta existente ou resultado incerto não entra.
- Bloqueio por endereço físico idêntico, destinatário incompleto, dimensões inválidas, chave incompatível ou revisão fiscal faltante permanece obrigatório.
- A operação durável registra `cart_inflight` antes da chamada externa. Em timeout/422 ou resultado duvidoso, **não** repete automaticamente a criação; o evento fica bloqueado para revisão, com dados de erro sanitizados.
- Não modifica catálogo, variantes, produtos, preços, quantidade, reservas ou estoque. Não paga, gera, imprime ou posta uma etiqueta.

## Implantação controlada

1. Revisar o diff, testes e migrar apenas pelo processo aprovado. Não são necessárias novas migrations para este recurso; utiliza `order_events` já existente.
2. Verificar que a importação fiscal já esteja homologada e ativada, que o remetente e os dados da loja Melhor Envio estejam corretos, e que a conta OAuth produtiva permita `POST /me/cart`.
3. Publicar backend e frontend juntos. **Só depois**, habilitar `AUTO_SHIPPING_PREPARE_ENABLED=true` no backend para pedidos futuros.
4. Testar **um pedido legítimo novo**, pago, destinatário diferente do remetente, documento fiscal correspondente e embalagem realmente medida. Conferir `cart_created` e ID no painel e item no carrinho do provedor, sem débito ou etiqueta comprada.
5. Caso surja erro, desabilitar `AUTO_SHIPPING_PREPARE_ENABLED` e conciliar o histórico no provedor antes de qualquer nova tentativa. Não resetar `cart_inflight`/`cart_uncertain` por conta própria.

**Pedido DH-2026-000019:** não é migrado ou reprocessado por esta funcionalidade, nem seu estoque ou destinatário são alterados.
