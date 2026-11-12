# Seleção de contexto com assinatura compartilhada — 13/10/2026

Base: `b09d5cb` e [verificação privada das credenciais](mercado-pago-credentials-readiness-2026-10-13.md). Escopo autorizado: corrigir exclusivamente a seleção TEST/produção quando ambos utilizam a mesma assinatura. Nenhuma variável, credencial, assinatura, URL/evento, migration ou configuração do Supabase foi alterada. Não houve cobrança, reembolso, envio de notificação à produção ou conciliação de pedido real.

## Causa e correção

Antes, `authenticateOrderDelivery()` exigia exatamente um contexto com HMAC válido. Como o valor real é compartilhado pelos dois modos, instalar ambos os conjuntos faria uma entrega legítima ser recusada com 401. A implementação agora mantém a verificação HMAC e persiste a entrega autenticada com os candidatos, sem escolher token/ambiente a partir do corpo.

No processador, o ID assinado precisa corresponder exatamente a uma única order local. O snapshot da tentativa, gravado anteriormente pelo backend, deve conter credencial, ambiente, aplicação e recurso vinculados. Esse vínculo seleciona o contexto entre os candidatos autenticados. Somente o token desse contexto consulta a identidade do vendedor e o recurso oficial. Antes de processar financeiramente, continuam obrigatórias as verificações de ambiente oficial, vendedor, aplicação, recurso, referência, BRL, valores, pagamento único e estados financeiros. Aplicação e `live_mode` recebidos servem apenas para conferir consistência após a seleção; não autorizam pagamento nem escolhem credencial.

Novas entregas compartilhadas usam um envelope versionado e selado (v2) na tabela existente. O fluxo atual com um único contexto continua produzindo v1; filas v1 existentes permanecem compatíveis, sem conversão, migration ou limpeza. Ordenar os candidatos mantém a identidade da entrega estável quando a ordem das configurações muda. Payloads contraditórios recebem reservas distintas da entrega legítima com os mesmos campos assinados, evitando que uma alteração maliciosa do corpo bloqueie sua recuperação. `body.id`, status e valores recebidos não comandam deduplicação ou processamento financeiro.

Sem vínculo confiável ou com mais de uma order local, não há consulta sob uma credencial escolhida por hipótese e não há alteração financeira. O evento fica preservado com `processed=false`, bloqueado para análise. Ausência temporária da order/credencial vinculada e falhas de rede continuam pendentes com backoff, permitindo recuperação quando a situação se resolver. Não há fallback para o token do modo ativo ou de outro contexto.

Recepção após commit, prazo HTTP, rollback, locks da fila/order, conclusão transacional, deduplicação financeira e regras de estoque/cupons existentes foram mantidos. Nenhuma tentativa histórica recebe novo ambiente por inferência.

## Verificação

- **392 testes do backend aprovados**, incluindo **27 novos testes** sobre assinatura compartilhada. A suíte da fila soma 66 testes.
- TEST e produção sintética utilizam segredo compartilhado, tokens/aplicações distintos e seleção pela tentativa. Os testes HTTP exercitam ambos com o modo ativo ainda TEST.
- Cobertura de HMAC inválido, tipo não suportado, aplicação/ambiente/recurso alterados, vendedor oficial divergente, ausência de metadados, adulteração do envelope, ambiguidade local, credencial vinculada indisponível, duplicatas, concorrência, payload que tenta bloquear a reserva legítima, timeout, falha de commit e recuperação por novo processador.
- As duas formas de tentativa legada pendente (vinculada e ainda reservada), além de notificação histórica, foram representadas por mocks e preservadas integralmente, sem UPDATE de pedidos. Não foram consultadas nem reconciliadas novamente na produção.
- Lint, typecheck, build com `VITE_API_URL=https://api.dhelenas.com`, checagem de sintaxe e `git diff --check` aprovados. O build conserva o aviso anterior de chunk acima de 500 kB.

Todos os recursos/segredos dos novos testes são sintéticos. Não houve consulta ao Mercado Pago nem ao Supabase durante esses testes. Isso valida o código localmente, sem declarar a integração financeiramente homologada.

## Próxima etapa

O impedimento de código identificado no relatório anterior está corrigido. A instalação dos dois conjuntos no Railway continua dependente de autorização específica. Manter completos os três campos de cada contexto; usar a aplicação TEST confirmada, distinta da produtiva; conservar token/segredo TEST e a chave pública genérica TEST. Não rotacionar a assinatura nem mudar o modo para viabilizar a instalação.

A inclusão do contexto produtivo permitirá recepção isolada naquele ambiente mesmo com criação de pagamentos em TEST; portanto não será feita nesta entrega. As duas tentativas financeiras antigas continuam exigindo análise/conciliação autorizada própria. Homologação real, mudança de modo/chave pública ativa e ativação comercial permanecem etapas separadas.

Manutenção ON, Data API OFF, Mercado Pago TEST e desconto Pix OFF preservados; main intacta e PR #3 sem merge.
