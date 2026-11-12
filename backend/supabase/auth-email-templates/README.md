# E-mails de autenticação D’Helenas — aguardando autorização

Cada arquivo HTML corresponde ao corpo de um template no Supabase Authentication → Emails. Nenhum destes arquivos altera o projeto Supabase até a configuração ser autorizada.

| Template | Assunto em português | Arquivo |
| --- | --- | --- |
| Confirm sign up | Confirme seu cadastro na D’Helenas | `confirm-signup.html` |
| Reset password | Redefina sua senha da D’Helenas | `recovery.html` |
| Change email address | Confirme seu novo e-mail na D’Helenas | `email-change.html` |
| Invite user | Seu convite para a D’Helenas | `invite.html` |
| Magic link | Seu acesso à D’Helenas | `magic-link.html` |
| Reauthentication | Seu código de verificação D’Helenas | `reauthentication.html` |

O template de cadastro envia `{{ .TokenHash }}` à rota `/auth/callback` no fragmento da URL, com `type=email`. O fragmento não chega ao servidor HTTP; a rota o remove antes de trocar o hash por uma sessão via `verifyOtp`. Isso corrige a falha observada em 22/10/2026 (`bad_code_verifier`) sem aceitar um token inválido. Recuperação usa o mesmo mecanismo com seu tipo próprio. Convite e acesso mágico mantêm `{{ .ConfirmationURL }}`. Os links são de uso único. Não inserir valores reais de token nos arquivos ou nas capturas.

Antes de configurar, confirmar `Site URL = https://dhelenas.com`, testar cada HTML com o preview do Supabase e verificar que o SMTP mantém `contato@dhelenas.com` como remetente. Após a configuração autorizada do template de cadastro e publicação autorizada do frontend, testar um novo cadastro com caixa de teste autorizada e confirmar tanto `email_confirmed_at` quanto a sessão e o destino `/minha-conta/dados`. Repetir o teste em outro navegador para validar a independência de PKCE. Um link já consumido deve mostrar a opção de reenviar a confirmação.

O envio de autenticação usa o remetente já configurado no Supabase. `pedidos@dhelenas.com` e `suporte@dhelenas.com` não são usados por estes templates.
