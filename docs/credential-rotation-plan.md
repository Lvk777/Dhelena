# Plano de rotação de credenciais — D'Helenas

Estado: plano somente. Nenhuma credencial foi alterada, revogada, copiada ou publicada nesta sprint. Executar apenas com autorização da proprietária e operadores com acesso ao cofre e painéis correspondentes. Nunca registrar valores, hashes ou URL de conexão integral em tickets, commits ou relatórios.

## Escopo e prioridade

| Prioridade | Categoria potencialmente exposta em saídas anteriores | Dependência para rotação segura |
|---|---|---|
| P0 | Supabase `service_role` e senha/URL de banco | Inventariar usos no Railway, jobs e conexões; preparar substitutos e janela de validação. A chave `service_role` contorna RLS. |
| P0 | Mercado Pago TEST access token e webhook secret | Identificar a aplicação/conta correta e a configuração de assinatura da entrega pendente antes de substituir o secret. Planejar credenciais TEST novas por ambiente e validar sem criar pagamentos nesta sprint. |
| P0 | Melhor Envio access/refresh token, client secret e webhook secret | Inventariar aplicação Sandbox e fluxo OAuth; revogar token antigo só depois de confirmar novo fluxo e webhooks. Preservar separação Sandbox/Produção. |
| P0 | `INTEGRATION_ENCRYPTION_KEY` | Mapear linhas OAuth criptografadas e criar procedimento de descriptografia/recriptografia em transação e backup. Trocar a chave isoladamente inutilizaria tokens armazenados. |
| P1 | Outras credenciais eventualmente presentes em transcripts/logs, como Resend e WhatsApp | Confirmar exposição por inventário restrito, sem imprimir valores; rotacionar se confirmado. |

## Sequência operacional proposta

1. Autorizar explicitamente a janela de rotação, responsáveis e rollback. Congelar novos dumps de ferramentas e restringir acesso aos transcripts já existentes.
2. Verificar, em canal seguro, onde cada segredo é usado; criar substitutos no provedor correto. Registrar apenas categoria, ambiente, data e responsável.
3. Atualizar consumidores por ambiente, validar saúde, autenticação e webhooks com testes seguros autorizados. Não misturar TEST, Sandbox e Produção.
4. Para a chave de criptografia, executar uma migração planejada das linhas OAuth: backup criptografado, leitura com chave antiga, gravação com chave nova, verificação de capacidade de leitura e rollback pronto. Nunca escrever token ou chave em logs.
5. Revogar os valores antigos depois de todos os consumidores confirmarem o novo segredo; revisar sessões, falhas de autenticação e filas de notificações.
6. Rever retenção e acesso a transcripts, ferramentas, CI e logs; remover material sensível somente mediante procedimento autorizado e auditável. Confirmar que repositório e artefatos de build não contêm segredos.

## Critério de encerramento

Cada categoria precisa de evidência de substituição no ambiente certo, validação funcional, revogação antiga, ausência de vazamento em logs e plano de recuperação testado. A pendência do HMAC Mercado Pago permanece independente; trocar um secret por hipótese não prova a assinatura da aplicação correta.
