# Entrada por código Supabase — execução controlada no projeto atual

Projeto `huxwnoxkqtmpvxrapmyz`, branch `main` de produção. Autorização: 30/10/2026. Não há projeto Supabase separado. Não usar a migration 020 nem ativar `LOGIN_EMAIL_CODE_ENABLED`.

## Estado e backup

- Antes de qualquer mudança de Auth, os seis corpos dos templates produtivos foram comparados por comprimento e checksum com os arquivos em `backend/supabase/auth-email-templates/`; os seis coincidem. Cópias locais: `C:\Users\vitor\.codex\backups\dhelenas-auth-2026-10-30`.
- Magic Link atual usa `{{ .ConfirmationURL }}` e assunto “Seu acesso à D’Helenas”. OTP tem 8 dígitos e expira em 3600 segundos. Email e Google estão habilitados, confirmação de e-mail está ligada.
- MFA TOTP nativo está habilitado, máximo de dez fatores por usuário. O Supabase limita sessões AAL1 de usuários com fatores a 15 minutos.
- SMTP Auth continua com `contato@dhelenas.com`. Não mudar o SMTP nem o remetente de pedidos.

## Ordem de implantação

1. Publicar o backend com `ADMIN_AAL2_REQUIRED=false` e o frontend com `VITE_EMAIL_OTP_LOGIN_ENABLED=false`. Validar senha, Google, cadastro, recuperação, `/api/auth/me` e painel existentes. O formulário de TOTP em `/minha-conta/senha` fica disponível apenas para administradores.
2. Vitor e Juliane, cada um em sua própria sessão, entram em `/minha-conta/senha`, escolhem “Configurar autenticador”, registram a chave manual no próprio aplicativo e digitam o TOTP no site. Não compartilhar chave nem código. Verificar para ambos `mfaStatus.enrolled=true` e `aal2` e testar novo login e desafio em outra sessão.
3. Verificar no banco o conjunto completo de perfis com papel `admin` e os fatores verificados de cada identidade vinculada. Não ativar AAL2 se houver administrador sem fator ou vínculo não resolvido.
4. Ativar `ADMIN_AAL2_REQUIRED=true` no backend e verificar que AAL1 é recusado em toda API administrativa, inclusive acessos por papel em rotas não nomeadas como admin; `/api/auth/me` continua disponível para a etapa de desafio. Confirmar AAL2 de Vitor e Juliane e que clientes não são afetados.
5. Trocar **somente** o corpo do template global Magic Link para `magic-link-otp-proposed.html` com `{{ .Token }}` e ajustar Email OTP length de 8 para 6. Manter expiry = 3600. Isso já habilita OTP diretamente no endpoint público do Supabase, mesmo antes da tela da loja; por isso vem após AAL2. Não enviar e-mail a outras contas.
6. Usar somente `vl.250407@gmail.com` para o primeiro OTP real. O titular solicita o código e o digita no site; não registrar nem visualizar o código. Verificar identidade, sessão, perfil, papel, `/api/auth/me`, desafio TOTP e acesso `/admin`. Testar senha/Google e os templates separados sem criar outras contas ou disparar e-mails não autorizados.
7. Publicar o frontend com `VITE_EMAIL_OTP_LOGIN_ENABLED=true` e confirmar login por código, senha e Google, além de catálogo e checkout sem pedido. Manter manutenção ON, Data API OFF, auto deploy OFF e worker transacional OFF.

## Reversão ensaiável

- Se a etapa 1 falhar, voltar backend/frontend ao SHA anterior com os flags desligados.
- Se AAL2 causar bloqueio, desligar `ADMIN_AAL2_REQUIRED` antes de qualquer outra alteração e verificar as duas contas; não remover fatores por tentativa.
- Se o código global falhar, restaurar o HTML e assunto Magic Link do backup e Email OTP length = 8, mantendo expiry = 3600. Códigos já emitidos podem continuar válidos até expirar; não presumir revogação instantânea.
- Se a interface falhar, republicar frontend com `VITE_EMAIL_OTP_LOGIN_ENABLED=false`. Senha e Google devem continuar disponíveis.

## Limites de segurança

O método é passwordless, não segundo fator. `shouldCreateUser:false` não cria conta, mas a resposta direta de `/auth/v1/otp` distingue e-mail inexistente (`otp_disabled`); texto neutro na interface não elimina a enumeração. AAL2 exige fator TOTP verificado, mesmo após login por senha, Google ou código. O token AAL1 não pode alcançar rotas Express administrativas quando o gate está ligado; a proteção nativa dos endpoints de gerenciamento de conta do Supabase deve ser verificada com a conta autorizada antes da ativação global.
