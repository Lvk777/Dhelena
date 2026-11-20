# Correção do webhook e transição TEST → produção — 13/10/2026

Atualização: a [verificação privada](mercado-pago-credentials-readiness-2026-10-13.md) confirmou assinatura compartilhada entre TEST/produção nesta aplicação. A exigência inicial abaixo de assinaturas distintas foi substituída pela [correção de seleção por vínculo e recurso oficial](webhook-shared-signature-fix-2026-10-13.md), sem rotação. O restante do plano e as autorizações de instalação/corte continuam aplicáveis.

Continuação de [webhook-production-verification-2026-10-13.md](webhook-production-verification-2026-10-13.md). As falhas identificadas em `963238e` foram corrigidas no código, sem mudar variáveis, segredos, URL/evento cadastrados, migrations ou políticas do Supabase. Não houve pagamentos, reembolsos ou alterações de pedidos reais. Manutenção ON, Data API OFF, Mercado Pago TEST e desconto Pix OFF permanecem como condições de operação. Main e PR #3 não recebem merge.

## Comportamento entregue

- O HMAC é verificado por contexto de credenciais. Uma chave ambígua entre contextos é recusada; uma chave TEST não autentica produção. O contexto liga token e segredo por identificador opaco, sem armazenar os valores na fila ou nos logs. As variáveis genéricas atuais continuam funcionando no modo TEST.
- Exige `type=order`, query coerente, ID ORD assinado e mesmo ID no corpo, aplicação válida e ambiente compatível. Esses campos do corpo são apenas condições adicionais: não autorizam aprovação financeira.
- Antes de processar, consulta `/users/me` com o token daquele contexto e exige evidência oficial de conta de teste/produção (`tags`), consulta a order oficial com o mesmo token, confere `user_id`, tipo `online`, aplicação e recurso exato vinculado à tentativa local. A Orders API não documenta `live_mode` na resposta GET; não presumimos sua presença. Se vier, também é conferido. Sem identidade comprovada, o evento continua pendente.
- Novas tentativas gravam ambiente e vínculo da credencial antes do POST financeiro. O GET oficial após a criação vincula aplicação e ID da order na mesma transação da persistência financeira. No TEST genérico, a aplicação esperada vem desse retorno oficial de criação, não da notificação. Em produção, `APPLICATION_ID` explícita é obrigatória; configuração incompleta bloqueia criação/recepção.
- O endpoint salva um envelope mínimo autenticado na `webhook_events` existente e responde `200/queued` somente após commit. Repetição ainda pendente responde `200/pending`; `already_processed` exige `processed=true`. O identificador da entrega deriva de campos assinados, não do `body.id` manipulável. Não salva o corpo inteiro nem dados da pagadora.
- Não há GET externo na resposta HTTP. Recepção tem limite de 10 segundos, além de lock timeout de 1 segundo e statement timeout de 5 segundos no banco; indisponibilidade/timeout recebe 503, nunca um falso sucesso. Uma gravação que terminar após o timeout permanece válida e a repetição encontra a reserva.
- Processador inicia com a API e varre a fila a cada 15 segundos, em lotes de até 10. `FOR UPDATE SKIP LOCKED` protege a mesma entrega entre réplicas; bloqueio da order serializa entregas diferentes para o mesmo pagamento. Alteração financeira, trilha e conclusão da notificação fazem commit juntos. Falhas fazem rollback, mantêm a notificação e agendam backoff com jitter até aproximadamente 5 minutos. Interrupção/deploy libera locks e a fila é retomada pelo próximo processo.
- O processador só consulta o provedor: não cria cobrança/reembolso nem altera estoque/cupons. Reutiliza validação de BRL, centavos, referência, pagamento único, estados e oferta de parcelas já gravada. Conciliação de reembolso já reservado usa leitura oficial com o mesmo contexto e a mesma transação, sem emitir reembolso.
- Divergências de origem/valor e pedidos que exigem conciliação manual ficam `processed=false`, com motivo de bloqueio. Não são repetidos automaticamente até correção autorizada. Logs excluem tokens, chaves, assinaturas, identificadores opacos das credenciais e dados pessoais.

## Limite deliberado dos registros existentes

Não existe prova de autenticação/ambiente persistida nas notificações antigas, e as tentativas antigas não tinham o vínculo agora exigido. Não atribuímos ambiente retrospectivamente a partir do corpo. Esses registros continuam intactos e exigem conciliação autorizada antes do corte. Uma nova entrega referente a tentativa antiga é preservada, mas fica bloqueada sem alteração financeira. Notificações novas devidamente vinculadas têm recuperação automática, inclusive sem nova tentativa de envio do Mercado Pago.

## Validação local

365 testes do backend aprovados, incluindo 39 novos testes de fila/contextos: TEST e produção sintética, assinatura/tipo/aplicação, origem oficial, pending duplicado, timeout, falha no commit, reinício, chegada antes do commit da criação, concorrência entre réplicas, parada do processador, isolamento durante o corte, estados pendente/rejeitado/aprovado, proteção de conciliação manual, valores, estoque/cupons e leitura de reembolso. Segredos e recursos são sintéticos; não houve rede financeira externa. Teste HTTP local confirmou resposta após commit, sem chamada ao provedor, em menos de 1 segundo, e 503 quando o banco falha. O limite de recepção também foi exercitado com persistência travada.

Lint, typecheck, build de produção com `VITE_API_URL=https://api.dhelenas.com`, checagem de sintaxe dos módulos e `git diff --check` aprovados. O build mantém o aviso pré-existente de chunk acima de 500 kB. As verificações de concorrência da fila usam mocks, não certificam o tempo de resposta nem o comportamento de locks na infraestrutura produtiva.

## Sequência mínima do corte — requer autorização separada

1. **Sem mutação de produção:** conferir privadamente procedência de token/chave pública/segredo/aplicação e a identidade oficial do vendedor. Confirmar se `/users/me` nessa conta devolve a evidência necessária. Se não, manter o bloqueio e adaptar somente com fonte oficial e novos testes. A presença de variáveis não comprova seus valores. Conferir custos, disponibilidade de crédito/Elo Débito/Pix e condições de parcelamento; flags comerciais continuam OFF.
2. **Inventariar pendências, sem alterar:** contar notificações antigas sem envelope, bloqueadas e pendentes por contexto; identificar tentativas TEST não encerradas. Consultas abaixo não expõem payloads nem identificadores de credenciais. Apresentar cada conciliação histórica para autorização própria; nenhuma conversão de TEST para produção, exclusão ou reset de histórico.
3. **Autorizar instalação coerente:** copiar o conjunto TEST atual para `MERCADO_PAGO_TEST_ACCESS_TOKEN`, `MERCADO_PAGO_TEST_WEBHOOK_SECRET` e `MERCADO_PAGO_TEST_APPLICATION_ID`; instalar o conjunto produtivo separado em `MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN`, `MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET` e `MERCADO_PAGO_PRODUCTION_APPLICATION_ID`. Um conjunto com qualquer campo presente deve ser completo: não há empréstimo de chave/token genérico. Chaves compartilhadas entre contextos são recusadas; confirmar conjuntos distintos das aplicações/contas apropriadas antes de instalá-los. Os nomes são documentação, nenhuma variável foi criada ou alterada nesta entrega.
4. **Ainda sob manutenção:** validar recepção assinada, persistência, aplicação/conta, latência, retry e restart com os contextos corretos. Não apagar a fila. Preservar o conjunto TEST enquanto existirem notificações/tentativas daquele ambiente; cada evento usa sua credencial de origem mesmo se o modo ativo mudar. Rotação de token/segredo muda o vínculo e exige drenagem/conciliação prévia; não substituir às cegas.
5. **Autorizar mudança de modo e chave pública ativa:** trocar `MERCADO_PAGO_MODE` e a chave pública usada no checkout para o conjunto produtivo aprovado; preservar a recepção TEST isolada. Nunca reassociar orders históricas a credenciais novas. A URL e o evento produtivos já cadastrados permanecem intactos.
6. **Autorização financeira específica:** homologar separadamente crédito/3DS, Elo Débito à vista e Pix, confirmação oficial e webhook real, valores finais, duplicatas/retries e conciliação. Testes mockados não homologam a conta nem a operação financeira real. Só depois aprovar flags comerciais e abertura da loja.

Consultas de acompanhamento (somente leitura; execução produtiva não realizada nesta entrega):

```sql
SELECT processed,
       CASE WHEN payload->'mp_webhook'->>'version' = '1'
            THEN payload->'mp_webhook'->>'mode' ELSE 'legacy_unverified' END AS environment,
       COALESCE(payload->'queue'->>'state', 'legacy_or_pending') AS queue_state,
       COUNT(*) AS notifications, MIN(created_at) AS oldest
FROM webhook_events WHERE provider = 'mercado_pago'
GROUP BY 1,2,3;
```

Um bloqueio exige diagnóstico/conciliação: não alterar `processed`, selo, ambiente ou vínculo da tentativa para contornar a validação. Pendência de credencial retirada exige restaurar o contexto original com autorização ou conciliação explícita, preservando o histórico.

Fontes oficiais: [notificações e prazo de 22 segundos](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications), [GET da order, aplicação, vendedor e sandbox com conta de teste](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/get-order/get), [identidade e tag de usuário de teste](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/servico-consulta-de-usuarios).
