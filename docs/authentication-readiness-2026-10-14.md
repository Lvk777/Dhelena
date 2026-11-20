# Autenticação e área da cliente — 14/10/2026

Implementação sobre 5f7c76a, exclusivamente na branch codex/production-hardening. Nenhuma configuração externa, conta real, permissão real ou migration produtiva foi modificada.

## Código concluído

- Supabase Auth em PKCE, com retorno /auth/callback, troca única do código, retorno restrito à mesma origem, tratamento de cancelamento e limpeza da URL antes de chamadas/erros. Tokens implícitos no fragmento não autorizam recuperação.
- Recuperação aceita somente código cujo verificador PKCE do SDK identifica a finalidade recovery, ou token_hash validado oficialmente como recovery. Parâmetro flow recebido não concede autorização. A autorização de redefinição dura no máximo 15 minutos e pertence à mesma identidade/sessão; é consumida após sucesso. Recarregar a página de redefinição exige um novo link. PKCE precisa do navegador que iniciou o fluxo; uma alternativa de token_hash exige template apropriado, ainda não instalado.
- Cadastro e login normais, mensagens genéricas, proteção contra envio concorrente, confirmação via link/código, sem conceder papel administrativo pelo Google ou metadata. Cadastro Auth concluído não é repetido se a atualização do perfil falhar.
- Alteração de senha autenticada com nonce de reautenticação quando solicitado pelo Supabase, incluindo contas Google. Logout global solicita revogação das sessões e limpa estado local mesmo com indisponibilidade do provedor. Tokens JWT já emitidos podem continuar válidos até expirar; revogação de papel administrativo é independente, consultada no banco em cada requisição.
- Alteração de e-mail possui prévia autenticada no servidor e confirmação no Supabase. Perfis vinculados por UUID recebem somente o e-mail confirmado oficial, mantendo UUID, papel, pedidos e demais dados. E-mail pendente não modifica o perfil. Não há cancelamento remoto presumido de solicitações pendentes.
- Perfis legados sem ligação independente mantêm a compatibilidade existente para login e histórico; troca de e-mail fica bloqueada até ligação revisada. Nenhuma ligação ou autoridade é inferida de metadata, domínio ou e-mail do frontend.
- Acesso ao painel aparece somente na área autenticada de administradores reconhecidos pelo backend. Botão administrativo no login e links administrativos públicos removidos. URLs administrativas e endpoints mantêm verificação no servidor.
- Gerenciamento de colaboradores exige Supabase Auth, identidade imutável comprovada e registro independente de proprietária ativa. Transação revalida autoridade, serializa concessões/revogações, impede alterar proprietária e audita a mudança. Não cria novas proprietárias. Repetições não duplicam auditoria. Desativado por padrão.
- Caixas nativas substituídas por diálogos personalizados. Confirmações usam foco inicial seguro, teclado, descrição acessível e proteção contra repetição. Endereço/e-mail preservam alterações antes de descarte confirmado. Formulários têm estados de carregamento, erro e validação; respostas de contas anteriores e caches de favoritos sem identidade não são reaproveitados.
- A área da cliente continua acessível durante manutenção para cadastro/acesso/histórico. Backend e interface bloqueiam novos pagamentos e alteração de método por clientes enquanto manutenção estiver ON; não alteram tentativas antigas.

## Validação

459 testes automatizados aprovados (422 existentes preservados + 37 novos), incluindo OAuth PKCE, recuperação, confirmação, sessões, isolamento, privilégios e idempotência. Lint, typecheck e build aprovados.

Ensaio em PostgreSQL 17 local, descartável e sem provedores: 13 verificações aprovadas, incluindo migrations 016/017 com rollback e preservação de registros; oito logins concorrentes com perfil único; oito concessões e oito revogações concorrentes com uma auditoria por mudança; token antigo sem privilégios após revogação; conflito de e-mail; isolamento de pedidos e bloqueio de pagamentos durante manutenção. Nova etapa CI reproduz esse ensaio.

Interface real local com contas exclusivamente sintéticas: login correto/incorreto, ausência de link administrativo para cliente, URL /admin redirecionada para /minha-conta, campos preservados após erro de gravação, recuperação sem link bloqueada, modal responsivo em 375 px sem overflow horizontal e confirmação de descarte com Voltar inicialmente focado. Nenhum e-mail real foi enviado, nenhuma conta foi criada/modificada no Supabase e nenhuma operação financeira foi executada. Sucesso com mocks não equivale à homologação Google/SMTP em produção.

## Pendências externas comprovadas, somente leitura

Painel Supabase do projeto D’Helenas em 14/10:

1. Google DISABLED. Necessita credencial OAuth existente/aprovada do Google Cloud, consentimento/configuração comercial e callback Supabase correto; nenhuma credencial foi criada.
2. Site URL = http://localhost:3000, sem Redirect URLs. Antes de homologar, autorizar Site URL https://dhelenas.com e retorno limitado https://dhelenas.com/auth/callback (incluindo query strings dos fluxos, conforme allowlist Supabase). Revisar também www somente se efetivamente utilizado. Não utilizar wildcard para origens externas.
3. Custom SMTP OFF; painel indica templates padrão. SMTP de Supabase Auth é separado da comunicação de pedidos Resend/migration 015. Necessita remetente/domínio verificados e aprovação específica. Entrega de e-mails reais não foi testada.
4. Templates de confirmação/cadastro, recuperação e mudança de e-mail precisam ser alinhados à estratégia de callback após aprovação da configuração. Link PKCE padrão deve manter RedirectTo; token_hash deve usar endpoint com finalidade explícita e ser validado por verifyOtp. Não copiar códigos, senhas ou tokens para o chat.
5. Gestão de colaboradores: autorizar isoladamente migrations 016/017 e o vínculo/registro da conta da proprietária após prova independente. Conferir perfis legados sem reescrever UUIDs. Só depois habilitar ADMIN_ACCESS_MANAGEMENT_ENABLED. Nenhuma migration, backfill, grant, RLS ou mudança de usuário real executada.

Referências oficiais: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Manutenção ON, Mercado Pago em produção, Data API OFF, Pix OFF, retirada OFF e parcelamento 1x preservados. Main intacta e PR #3 sem merge. Migration 015 e políticas em minuta continuam nas condições anteriores.

Regressão operacional adicional: 17/17 cenários PostgreSQL sintéticos anteriores também aprovados após estas alterações (comunicação, reembolsos, etiquetas, rastreamento e endereços). Chamadas financeiras/e-mails externos: zero.
