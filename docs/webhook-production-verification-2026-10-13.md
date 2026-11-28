# Verificação do webhook produtivo — 13/10/2026

Relatório histórico sobre `963238e`. As correções posteriores e o plano de corte estão em [webhook-production-transition-2026-10-13.md](webhook-production-transition-2026-10-13.md); não interpretar as falhas abaixo como o estado final do código corrigido.

Escopo: código em `963238e`, metadados mascarados do Railway, testes locais com mocks e leituras públicas. Nenhuma configuração, credencial, webhook cadastrado, pedido ou pagamento de produção foi alterado.

O titular confirmou credenciais produtivas ativadas no Mercado Pago e webhook de produção em `https://api.dhelenas.com/api/webhooks/mercado-pago`, evento **Order (Mercado Pago)**. Essa configuração foi preservada. A ativação no provedor não modifica automaticamente o backend: o Railway foi conferido em `MERCADO_PAGO_MODE=test`.

| Verificação | Resultado |
|---|---|
| Algoritmo de assinatura TEST/produção | HMAC-SHA256 com comparação segura, manifesto de query `data.id`, `x-request-id` e timestamp; compatibilidade com SDK oficial testada. O algoritmo serve aos dois ambientes com o segredo correspondente. |
| Segredo no Railway | Existe `MERCADO_PAGO_WEBHOOK_SECRET`, mascarada no serviço do backend. Não há variantes TEST/produção separadas. Nenhum segredo foi aberto ou copiado; correspondência do valor ativo com a chave produtiva do painel **não comprovada**. Presença da variável não certifica procedência/ambiente. |
| Origem e pagamento | Assinatura inválida recebe 401. Após assinatura válida e identificador ORD, há GET oficial da order; referência, IDs, BRL, valores, status de order/transação e condições gravadas são validados antes de aprovar. Status/valor enviados pelo navegador ou no body não bastam. |
| Isolamento | `live_mode` e `application_id` são apenas metadados de logs; não há barreira explícita de ambiente/aplicação. `type=order` também não é exigido: um evento com outro tipo e identificador ORD válido chega à reserva. `MERCADO_PAGO_MODE=test` não constitui bloqueio de notificações produtivas. |
| Retentativas e corte | Há deduplicação e retorno 503 com liberação da reserva em erros tratados. Porém a duplicata recebe 200 mesmo com registro pendente (`processed=false`). Uma queda após INSERT pode deixar reserva que retries reconhecem sem processar. Não existe recuperação automática desses registros no código atual. Não é possível garantir corte sem perda com essa implementação. |

## Prova local e limites

61 testes pertinentes passaram (assinatura/oráculo, logs, prévia/reconciliação, fluxos de pagamento e contratos selecionados). Nenhuma operação financeira externa foi chamada.

Uma sonda adicional em memória, somente local, com segredo sintético, modo TEST, evento `not_order`, `live_mode=true`, aplicação distinta e registro mockado pendente, retornou `200/already_processed`. A reserva recebeu o tipo não permitido; chamadas externas: zero. A chave sintética correta foi aceita e outra chave sintética foi recusada. Essa prova demonstra as lacunas de filtro e retries, sem consultar ou modificar pedidos reais; não é homologação de origem produtiva.

## Próximo passo seguro

1. Operador conferir privadamente a correspondência do segredo ativo com a chave da notificação produtiva, sem valores/hashes no chat ou logs e sem alterar variáveis. Manter URL/evento cadastrados intactos.
2. Antes de autorizar o corte, preparar e ensaiar fora de produção o isolamento de TEST/produção, a verificação da aplicação esperada e do evento Order, a recuperação de reservas pendentes e a preservação de notificações em deploy/restart. A seleção do ambiente não deve confiar apenas em `live_mode` recebido; deve estar vinculada à autenticação e ao recurso oficial. Registrar ambiente da tentativa e definir tratamento dos pagamentos TEST existentes. Nunca confirmar duplicata pendente como concluída sem recuperação garantida.
3. Somente após nova autorização específica: instalar/ativar o conjunto coerente de token, chave pública, segredo e modo produtivos no backend. Fechar/reconciliar pendências TEST ou preservar recepção isolada durante a transição, sem substituir o único segredo às cegas. Validar entrega, tempo de resposta, retry e replay antes da abertura.
4. Homologação financeira real exige autorização própria: crédito/3DS quando aplicável, Elo Débito à vista e Pix, vínculo com orders locais, valores finais e confirmação oficial. Custos da boutique, disponibilidade produtiva e condições de parcelamento ainda dependem da conta; oferta e desconto Pix continuam OFF.

O [protocolo oficial](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications) prevê confirmação HTTP em até 22 segundos e retentativas. O handler atual realiza consultas externas síncronas; essa janela e a recuperação precisam ser medidas/ensaiadas, sem depender de um 200 antecipado para evento pendente.

Manutenção ON, Data API OFF, Mercado Pago TEST e desconto Pix OFF preservados. Main permanece intacta e PR #3 sem merge. Nenhum código/deploy foi modificado nesta verificação.
