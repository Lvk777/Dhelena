# Preparação das credenciais Mercado Pago — 13/10/2026

Este é o registro histórico da verificação em `b09d5cb`. A correção autorizada posteriormente está em [webhook-shared-signature-fix-2026-10-13.md](webhook-shared-signature-fix-2026-10-13.md). Nenhuma credencial foi instalada durante a correção.

Base: commit `b09d5cb`, branch `codex/production-hardening`, e [plano de transição](webhook-production-transition-2026-10-13.md). Esta etapa fez leituras do painel, GETs oficiais de identidade/recurso e inventário SQL em transação READ ONLY com rollback. Não houve alteração de código executável, variáveis, credenciais, segredos, webhook, pedidos ou dados financeiros; nenhum pagamento/reembolso foi criado. Relatório local, sem commit/push/deploy nesta etapa.

## Resultado

| Verificação | Evidência e resultado |
|---|---|
| Aplicação produtiva | Painel autenticado: aplicação `dhelenas`, Checkout Transparente via Orders, titular correspondente à D’Helenas e Client ID igual ao da aplicação selecionada. Credenciais produtivas já disponíveis. Não foi usado o prefixo do token para deduzir sua origem. |
| Identidade produtiva | GET oficial `/users/me` com a credencial do painel: HTTP 200, ID válido, `tags` como array, ausência de `test_user`, vendedor igual ao User ID dos detalhes da aplicação, país BR e CNPJ da conta coincidente com o informado. Nenhum valor da credencial ou dado integral da resposta foi incluído aqui. Essa leitura não substitui o comprovante cadastral da Receita nem homologa pagamentos. |
| Identidade TEST atual | GET oficial a partir do backend Railway, usando a variável atual sem copiá-la para outro ambiente: HTTP 200, ID válido, `tags` como array, presença de `test_user` e vendedor correspondente ao painel TEST. Compatível com `getWebhookCredentialIdentity()`. |
| Aplicação TEST | GET oficial de uma order já vinculada, somente leitura: recurso `online`, aplicação igual à indicada nos dados das credenciais TEST, vendedor igual à identidade do token. **A aplicação TEST é diferente da produtiva**, embora suas credenciais sejam apresentadas dentro da aplicação principal. Não usar o Client ID produtivo no campo TEST. |
| Chave pública atual | Comparação privada: a chave pública genérica do Railway corresponde à chave pública TEST exibida no painel. Mantida intacta. |
| Assinatura atual | Comparação privada: `MERCADO_PAGO_WEBHOOK_SECRET` atual corresponde à assinatura do painel em TEST **e** em produção. Os dois modos usam o mesmo valor neste cadastro; nenhum valor/hash é registrado aqui. |
| URLs/evento | As URLs TEST e produção apontam para o endpoint já definido; Order selecionado. Nenhum campo foi editado, salvo, redefinido ou simulado. |
| Railway | Variáveis genéricas de token, assinatura e chave pública presentes. `MERCADO_PAGO_MODE=test`. As seis variáveis separadas TEST/produção não estão instaladas; nenhum conjunto parcial foi criado. |
| Controles preservados | Saúde `ok`, banco conectado, manutenção ON confirmada na API; Data API OFF confirmada no painel; desconto Pix OFF confirmado no ambiente em execução. Main permanece no SHA anterior e PR #3 continua aberta sem merge. |

## Inventário somente leitura

Consulta agregada de `webhook_events` para Mercado Pago e tentativas locais relacionadas ao provedor, com `BEGIN TRANSACTION READ ONLY`, limites locais de espera e `ROLLBACK`. Sem exposição de payload, IDs de pagamento, valores monetários ou dados de clientes.

| Notificações | Quantidade |
|---|---:|
| Antigas, sem envelope de ambiente comprovado, `processed=true` | 1 |
| Pendentes, `processed=false` | 0 |
| Bloqueadas pela fila nova | 0 |
| Com envelope novo TEST/produção | 0 |

| Tentativas locais | Pedidos | Com recurso vinculado | Com reserva ainda aberta |
|---|---:|---:|---:|
| Estado pending, sem vínculo novo de ambiente | 2 | 1 | 1 |
| Estado approved, sem vínculo novo de ambiente | 1 | 1 | 0 |
| Estado refunded, sem vínculo novo de ambiente | 1 | 1 | 0 |

Total: quatro registros financeiros locais legados, todos classificados como **ambiente não comprovado no snapshot**, não automaticamente como TEST. Uma leitura pontual comprovou que o recurso consultado pertence ao vendedor TEST; não extrapolamos essa prova aos demais registros. A ausência de pendências na fila não encerra as duas tentativas financeiras pendentes. Nada foi reconciliado, reclassificado, desbloqueado ou marcado como concluído.

## Impedimento de código comprovado — instalação bloqueada

`authenticateOrderDelivery()` em `backend/src/services/mercadoPagoWebhookQueue.js:18` exige exatamente um contexto com HMAC válido. Como a assinatura real é compartilhada, quando ambos os conjuntos forem instalados uma entrega corretamente assinada corresponderá a dois contextos e será recusada com HTTP 401, antes da persistência. O TEST atual, com apenas um contexto, continua funcionando.

O teste local existente de chave compartilhada foi executado isoladamente e passou, confirmando que a recusa é comportamento programado, não inferência sobre um problema de rede. Não houve envio ao endpoint produtivo.

**Correção proposta, sujeita a autorização:** ajustar apenas a seleção do contexto para admitir a assinatura compartilhada legítima. Aplicação/ambiente do corpo podem servir como indicação de roteamento, jamais como prova financeira. Antes de qualquer alteração financeira continuam obrigatórios: assinatura válida, identidade oficial do token selecionado, aplicação/vendedor do recurso oficial, ID exato e ambiente/credencial da tentativa local, valores e estados. Se a identificação permanecer ambígua, falhar de forma segura. Exigir testes com segredo sintético compartilhado, aplicações/vendedores distintos, ambos os ambientes válidos e adulterações de corpo/recurso, preservando fila, retries, histórico e TEST genérico. Não rotacionar a assinatura para contornar a incompatibilidade.

Nenhuma incompatibilidade de formato foi encontrada nas duas respostas oficiais de identidade. A adequação do formato não é homologação da entrega real do webhook ou da operação de pagamento.

## Sequência exata de instalação, sem execução nesta etapa

1. Autorizar separadamente a correção de seleção acima. Publicar somente na branch autorizada após testes pertinentes, lint, typecheck e build; confirmar CI/deploy. Manter o único contexto atual e todos os controles de pré-lançamento durante essa correção.
2. Depois da correção validada, solicitar autorização específica para instalar as variáveis no **backend resourceful-joy**, ambiente Railway production, sem mudar `MERCADO_PAGO_MODE=test`. Realizar a entrada dos valores privadamente; não passar credenciais pelo chat, arquivos de texto, comandos com valores literais ou histórico do terminal.
3. Preparar o conjunto TEST completo em um único lote de alterações pendentes, antes de aplicar/deployar:
   - `MERCADO_PAGO_TEST_ACCESS_TOKEN`: exatamente o token genérico atual, já verificado como da conta TEST; sem rotação.
   - `MERCADO_PAGO_TEST_WEBHOOK_SECRET`: exatamente a assinatura genérica atual, já comparada com o painel; sem rotação.
   - `MERCADO_PAGO_TEST_APPLICATION_ID`: número da aplicação **TEST**, indicado nos dados da credencial e confirmado pelo GET oficial, diferente do Client ID produtivo.
   - Não substituir nem remover as variáveis genéricas nessa etapa. Manter a chave pública genérica TEST e modo TEST.
4. Aplicar/deployar somente com o lote TEST completo. A presença de qualquer variável separada faz o código exigir o conjunto inteiro; um deploy parcial bloquearia o contexto TEST. Conferir saúde, modo, identidade, correspondência da aplicação e conservação da fila/histórico. Copiar os mesmos token/segredo preserva o identificador opaco da credencial, que não inclui a aplicação no cálculo. Não imprimir esse identificador.
5. Em um segundo lote completo, e somente com autorização explícita para habilitar **recepção isolada de notificações produtivas enquanto o checkout continua TEST**, preparar:
   - `MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN`: token existente na aba produtiva da aplicação D’Helenas, cuja identidade foi verificada.
   - `MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET`: assinatura produtiva já cadastrada, que nesta conta é igual à TEST; usar o valor existente após a correção, sem redefinir segredo/webhook.
   - `MERCADO_PAGO_PRODUCTION_APPLICATION_ID`: Client ID da aplicação produtiva selecionada.
   - Não criar variáveis de chave pública separada como se o código já as consumisse. Atualmente o checkout lê `MERCADO_PAGO_PUBLIC_KEY`, que continua TEST.
6. Aplicar/deployar esse segundo lote preservando o modo TEST e conferir identidades/ambientes/aplicações e resposta da API. Os contextos separados permitem recepção/processamento de notificações do respectivo ambiente independentemente do modo ativo de criação; por isso a inclusão produtiva exige autorização própria, não deve ser tratada apenas como armazenamento inerte. Não simular nem reconciliar pedidos reais nesta verificação. Duplicatas/retry/latência com notificações reais exigem um ensaio autorizado posterior.
7. Preservar ambos os contextos e todo o histórico. As duas tentativas financeiras legadas pendentes precisam de diagnóstico/conciliação autorizada antes do corte; não preencher retrospectivamente o snapshot nem alterar `processed` para contornar validação.
8. Uma autorização futura, distinta da instalação, será necessária para mudar o modo ativo e a chave pública genérica para produção. Homologação financeira real, custos/parcelamento, Pix desconto e abertura da manutenção permanecem decisões separadas.

Se a validação após um lote falhar, não avançar para o próximo. Qualquer restauração/remoção de variáveis exige autorização específica; não trocar modo, segredo, URL ou contexto original por hipótese.

## Cuidado com as evidências desta leitura

O relatório não contém tokens, assinaturas, senhas ou hashes. A interface do Mercado Pago expôs dados sensíveis TEST em saídas brutas de acessibilidade (inclusive rótulos de botões e dados da conta de teste). Esses valores não são reproduzidos neste documento; a transcrição deve ser tratada como sensível. Comparações subsequentes e consultas de identidade retornaram apenas resultados sanitizados. Nenhuma credencial foi rotacionada, conforme a restrição desta etapa.

Referências oficiais: [Orders API — recurso, aplicação/vendedor e conta de teste](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/get-order/get), [notificações e chave da aplicação](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications). Resultados privados deste relatório vêm das leituras efetivamente realizadas, não apenas da documentação.
