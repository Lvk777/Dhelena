# Homologação de etiquetas Melhor Envio — roteiro para aprovação

**Estado:** planejamento somente. A cotação produtiva de leitura já foi homologada; não repeti a consulta. Compra de etiquetas e worker automático permanecem desativados.

## Valor a aprovar

O custo de uma etiqueta não pode ser fixado a partir da cotação anterior: depende de produto, embalagem, destino, serviço e preço oficial no momento da compra. Antes de solicitar autorização, obter o preço atual do envio preparado e apresentar **valor exato em centavos**, transportadora, serviço, pedido fictício/controlado e teto total. O backend exige coincidência exata entre o valor aprovado e o preço oficial imediatamente antes do checkout. Não comprar com preço divergente.

## Procedimento futuro, com autorização separada por ação

1. Escolher pedido controlado autorizado, sem usar pedido de cliente real. Confirmar pagamento, dados fiscais, remetente, destino, peso, dimensões e serviço contratado. Em produção, a preparação exige chave válida de NF-e para o envio comercial. Confirmar o ambiente original do pedido e o vínculo com a cotação persistida.
2. **Preparar** o envio: incluir no carrinho e registrar ID de etiqueta, ambiente e preço. Isso não compra a etiqueta. Se a resposta for incerta, parar e conciliar no painel; não repetir a inclusão automaticamente.
3. **Comprar** apenas após aprovação específica do preço exato e da ativação temporária da flag. A API usa o ID já preparado. Se o resultado for incerto, consultar o provedor no ambiente original; não repetir o checkout.
4. **Gerar** depois da compra confirmada. A geração é assíncrona. Consultar o status antes de **imprimir**; usar apenas link privado HTTPS do Melhor Envio.
5. **Rastrear** no ambiente persistido no pedido, mantendo o worker automático desligado até homologação própria. Conferir eventos duplicados e estados fora de ordem sem regressão do pedido.
6. **Cancelar:** funcionalidade ainda não exposta pelo backend. A API oficial prevê verificação de elegibilidade e cancelamento com motivo; uma etiqueta já gerada ou postada pode não ser cancelável, e eventual estorno depende do provedor. Implementação, testes isolados, motivo comercial e autorização financeira exigem decisão separada. Não cancelar no painel como parte automática deste roteiro.

## Condições de parada

Parar diante de divergência de ambiente, serviço, ID, preço, dados fiscais, status do pagamento, pacote ou identidade do pedido. Não repetir POST de compra, geração ou cancelamento quando a resposta for incerta. Não usar cliente ou pedido real. Não ativar o worker nem abrir a loja para público como consequência deste ensaio.

Referências oficiais: [compra](https://docs.melhorenvio.com.br/reference/compra-de-fretes-1), [geração](https://docs.melhorenvio.com.br/reference/geracao-de-etiquetas), [impressão](https://docs.melhorenvio.com.br/reference/impressao-de-etiquetas), [verificação de cancelamento](https://docs.melhorenvio.com.br/reference/verificar-se-etiqueta-pode-ser-cancelada), [cancelamento](https://docs.melhorenvio.com.br/reference/cancelamento-de-etiquetas).
