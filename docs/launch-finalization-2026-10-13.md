# D’Helenas — finalização de 13/10/2026

Este registro complementa o fechamento de 12/10; não repete as auditorias já concluídas.

## Configuração concluída

- Contatos públicos salvos pelo painel: telefone e WhatsApp `(11) 93803-3499`; e-mail `julianeassousa@outlook.com`. API pública confirmou persistência.
- `shipping.pickup_enabled=false`, confirmado na API. O backend já rejeitava retirada desativada; o checkout agora também invalida uma seleção antiga quando a configuração muda. Default administrativo passa a false. Dados de pedidos históricos permanecem preservados.
- A página Contato informa operação exclusivamente on-line e ausência de retirada. O campo de endereço público é identificado como endereço do fornecedor; não recebe automaticamente a origem dos envios.
- Manutenção ON, Data API OFF e oferta Pix OFF preservadas. Nenhuma credencial, configuração financeira, pedido, estoque, RLS ou migration foi alterada neste fechamento.

## Código e prazos

Cotação, preview e criação transacional compartilham o cálculo de duração. O prazo proposto de preparação é de 2 dias úteis, incluindo postagem, somado ao prazo conservador da transportadora. O cálculo não altera preço/frete/desconto e não usa valores de prazo enviados pelo navegador. O snapshot registra a composição e o prazo total; divergência em relação ao preview exige nova confirmação, com rollback da tentativa.

`SHIPPING_PREPARATION_ENABLED` tem default OFF; não foi habilitado no Railway. Enquanto OFF, a preparação proposta não é publicada e o transporte não é apresentado como prazo total. Não há conversão para data de calendário sem calendário de feriados/cortes da transportadora. Durações inválidas ou ausentes não viram promessa de entrega imediata.

A aprovação comercial deve confirmar que os 2 dias úteis incluem postagem efetiva, a partir do próximo dia útil à confirmação do pagamento. Ponto intermediário, horário de corte e feriados precisam ser compatíveis com a operação antes da ativação. Não basta ativar uma variável para homologar logística real.

## Políticas e textos

Quatro minutas em [docs/policies](policies/README.md), sem importação pelo site ou gravação nos campos públicos:

- Trocas: 7 dias de arrependimento separados dos 30 dias de troca comercial. Ajustado o atendimento para não exigir motivo no arrependimento.
- Entrega: proposta de preparação de até 2 dias úteis, transporte em dias úteis, sem retirada, sem promessa fixa independente de CEP.
- Termos: distingue registro do pedido de confirmação do pagamento. Identificação legal precisa ser preenchida antes de publicação.
- Privacidade: Supabase, Railway, Mercado Pago, Melhor Envio/transportadoras, ViaCEP, Outlook e WhatsApp; armazenamento local, finalidades, bases, direitos, retenção, transferências e canal de contato. Serviços em teste e mensageria pendente são registrados nas notas internas, sem alegar conformidade integral.

Revisão de contradições: campos reais continham “Política de troca via API” e política explicitamente de teste; entrega/termos estavam vazios. O código deixa de exibir esses dois placeholders como políticas válidas, preservando os valores do banco. Página de produto e página de política usam o mesmo filtro. Menções administrativas à retirada permanecem apenas para configuração e histórico. Prazos da transportadora na página de produto e no checkout receberam a mesma distinção preparação/transporte.

## Migration e identificação

Migration 014: SELECT em `information_schema.columns` confirmou as sete colunas, tipos e defaults esperados. Nenhuma reaplicação. Original SHA256 `669a9d6402af40b362e3d912fec75b2ea533f423ef887cf580474d9a25ae0a97` preservado.

Data API: painel mostrou o switch desligado e “No schemas can be queried”, sem alteração.

Consulta oficial: formulário da Receita Federal aberto com o CNPJ informado. Apesar do aviso de conclusão do usuário, as abas acessíveis não exibiram comprovante; uma mostrou hCaptcha expirado. Portanto, situação cadastral, razão social e endereço legal **não foram confirmados**. Não foram inventados nem publicados como identificação legal. É necessário obter o comprovante oficial, não apenas concluir o desafio.

## Verificação e limitações

Verificação local final: **lint, typecheck e build passaram; 242/242 testes backend passaram**, sem falhas ou testes pulados. `git diff --check` sem erros. Flag de preparação continua desativado por padrão; nenhum ensaio fez chamadas financeiras reais.

Testes cobrem bloqueio da preparação sem aprovação, intervalos conservadores, dados inválidos, soma em dias úteis, prazo alterado com rollback, retirada antiga invalidada e rejeição da retirada no preview/pedido sem consumo de estoque/cupom. HTTP do fixture local confirmou 2 + 3 = 5 dias úteis, com R$ 20 de frete inalterado; todos os dados eram sintéticos.

A navegação para a aba local de erro foi bloqueada pela política do navegador. Não houve tentativa de contorno; o ensaio HTTP e os testes de código foram usados para o cálculo. Servidores temporários locais encerrados. A inspeção visual da página Contato em produção será feita após o deploy, com a sessão administrativa existente e manutenção ligada.

## Pendências para inauguração

1. Aprovar as quatro políticas, completar a identificação oficial e autorizar sua publicação; confirmar a rotina de atendimento de direitos e retenção dos dados.
2. Aprovar os 2 dias úteis incluindo postagem e homologar o transporte real; só então ativar sua publicação.
3. SMTP/entrega de mensagens do Supabase Auth e canal essencial de pedidos ainda precisam de homologação operacional.
4. Mercado Pago continua TEST e Melhor Envio Sandbox/produção pendente, conforme o fechamento anterior. Nenhuma nova investigação de webhook ou transação financeira nesta tarefa.
5. Confirmar condições comerciais, estoque, medidas e embalagem. Pix continua OFF até aprovação específica.

Branch exclusiva: `codex/production-hardening`. PR #3 aberta, sem merge; main preservada.
