# D'Helenas: Checklist Definitivo de Cutover

Auditoria: 2026-10-07. Preparação somente; nenhuma mudança de modo, credencial, manutenção ou operação financeira foi executada.

## Resumo Executivo

- PRODUCTION-REACHABLE SECURITY BLOCKERS: nenhum advisory high identificado nos chunks frontend emitidos; backend runtime com npm audit --omit=dev zerado. React Router tem exposição condicional de redirecionamento em CTAs editáveis pelo admin, descrita abaixo; o caso SSR não é alcançável nesta SPA.
- CLIENT DATA STILL REQUIRED: identificação empresarial, canais de atendimento, endereço público/retirada, horários, instruções, Instagram, remetente/reply-to, políticas aprovadas e validação privada do remetente Melhor Envio.
- MERCADO PAGO PRODUCTION GATES: credenciais da aplicação de produção, modo production, secret e URL de webhook de produção, habilitação Pix e homologação; correção do secret TEST não substitui isso.
- MELHOR ENVIO PRODUCTION GATES: token/OAuth isolado por ambiente, remetente validado e cotação. O OAuth atual é exclusivamente Sandbox e uma linha OAuth Sandbox existente bloqueia o fallback fixo em production.
- EMAIL/DNS GATES: domínio real do remetente aprovado/verificado no Resend, DNS de autenticação, reply-to funcional, domínio de recebimento e controles Cloudflare/origin.
- LOG PRIVACY BLOCKERS: casos de risco nos logs runtime foram substituídos por whitelist técnica, com testes. Publicação e verificação operacional continuam sendo gates; logs históricos e configurações de log do edge não foram apagados nem certificados.
- READY AFTER WEBHOOK TEST SECRET FIX: NÃO.
- NEXT EXACT ACTION: operador autorizado deve atualizar a chave Webhook TEST da aplicação 6694235692742515 diretamente no Railway, confirmar apenas a atualização e validar um retry real da Order existente. Em paralelo, coletar/aprovar os dados desta lista. Não criar Pix para provocar webhook.

## 1. Advisories de Produção e Reachability

Foi analisado o grafo real do build Vite, incluindo os 49 chunks estáticos e lazy. A presença foi verificada pelos IDs dos módulos com renderedLength > 0, e não inferida de npm audit --omit=dev. Dependências instaladas por uma biblioteca podem aparecer no audit prod sem entrar no bundle servido.

| Advisory | Dependência instalada | Reachability neste projeto | Ação recomendada |
|---|---|---|---|
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), moderate | react-router / react-router-dom 6.30.6 | Código no chunk principal. Home e PositionBanner passam CTAs do banco para Link. Escrita de banners exige admin; os destinos públicos observados eram /sobre, /novidades e /colecoes. Nenhuma entrada anônima malformada até esse sink foi identificada; busca é codificada e returnTo tem validação própria. Exposição condicional se um destino malformado for publicado pelo CMS. | Validar URLs de CTA antes de publicar: rejeitar backslashes, controles e destinos protocol-relative, normalizar e aplicar política de destinos internos/externos. Adicionar testes adversariais. Alternativa: migração controlada para versão corrigida 7.18+, nunca audit fix --force. Não declarar o advisory eliminado enquanto a biblioteca estiver afetada. |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), moderate | react-router 6.30.6 | Não alcançável: src/main.jsx usa createRoot e src/App.jsx BrowserRouter/Routes; não há SSR, hydrateRoot, RouterProvider/data router ou SSR hydration de erros. | Registrar a exceção por arquitetura. Reavaliar se SSR/data router for introduzido; não migrar major só para este caso. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | braces 3.0.3; cadeia chokidar/micromatch/fast-glob/Tailwind | Nenhum desses módulos apareceu nos chunks. São cadeia de build/watch, não entrada de padrões no runtime da loja. | Fora do escopo runtime; manter revisão do CI/build em trabalho separado, sem migração Tailwind major nesta fase. |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), high | source-map-js 1.2.1 | Ausente de todos os chunks; nenhum runtime interpreta source maps recebidos por cliente. | Fora do escopo runtime. Atualização compatível 1.2.2 pode ser avaliada no tooling separadamente. |
| [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), moderate | postcss-selector-parser 6.1.4 e postcss-nested | Ausentes do bundle; processamento CSS ocorre no build, não com seletores enviados ao backend. | Fora do escopo runtime. Não forçar migração Tailwind 4 para zerar esse advisory. |
| [GHSA-4p3w-j4w9-5jqw](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw), moderate | moment 2.30.1 | Não importado nem emitido; backend não depende de Moment. O advisory ainda exige uso server-side com locale não-string influenciado por atacante. | Sem blocker runtime atual. Remoção de dependência não usada ou atualização 2.31 em manutenção separada. |
| GHSA-v3m3-f69x-jf25 (Quill), GHSA-p98j-92pf-mc4p e GHSA-6688-9rhm-gjv2 (DOMPurify), low | quill 2.0.3, react-quill-new, dompurify 3.4.14 | Fora do bundle; não há consumidor ReactQuill/DOMPurify na aplicação emitida. | Sem blocker runtime neste build. Reavaliar antes de reintroduzir editor HTML/sanitizador; não fazer downgrade automático de ReactQuill. |

Counts de referência do grafo instalado frontend (--omit=dev): critical 0, high 6, moderate 5, low 3. Esses 14 itens não são 14 vulnerabilidades alcançáveis na loja. O audit backend --omit=dev retornou zero. Nenhum upgrade de dependência foi realizado nesta fase.

Limites: análise estática/build e inspeção de origem dos dados; não prova ausência universal de exploração. CTAs do CMS precisam continuar sujeitos a revisão de destinos. Não houve exploit de produção nem chamada financeira para testar advisories.

## 2. Logs Legados: Risco e Correção

| Local | Risco real | Diagnóstico preservado |
|---|---|---|
| backend/src/middleware.js, errorHandler | SyntaxError de express.json pode trazer fragmento do body; erros de validação/driver podem repetir entrada privada. | api_request_failed, tipo seguro, código conhecido e status HTTP numérico. |
| backend/src/middleware/securityLog.js | Falha PostgreSQL ao persistir metadados de login pode repetir valores recebidos. | security_event_persistence_failed e SQLSTATE permitido. |
| backend/src/routes/security.js | Falhas de auditoria/login/session com entrada de usuário e headers podem carregar dados em mensagens de driver. | Eventos separados admin_audit_persistence_failed e login_history_persistence_failed. |
| backend/src/routes/orders.js, cotação/etiqueta | Erros de dados de envio/catálogo e falhas de driver/provider podem repetir nomes, endereços ou identificadores privados. | shipping_quote_failed / shipping_label_failed e status/código permitidos. |
| backend/src/routes/upload.js | Mensagens de storage, JSON ou banco são fontes externas, podendo repetir URLs, paths, detalhes de requisição ou valores inválidos. | Fases separadas upload_reference_check_failed, storage_upload_failed, upload_failed, storage_delete_failed e upload_delete_failed. |
| backend/src/routes/webhooks.js, Melhor Envio | Mensagens brutas de DB/provider, shipmentId e status do body eram enviados diretamente ao stdout. Assinatura válida não torna o conteúdo adequado para logging. | Fase de erro; presença de shipmentId; número local DH validado; status apenas da lista conhecida ou unknown. |
| backend/src/index.js, init | Erros de conexão/configuração são fontes externas e podem carregar detalhes de ambiente. | database_initialization_failed e código técnico conhecido. |

backend/src/lib/safeErrorLog.js não copia message, stack, detail, query, request, cause completo, config, headers ou payload. Códigos são de uma lista fechada SQLSTATE/Node/multer, não apenas validados por regex. Tipos e HTTP 400..599 são limitados. Getters hostis não escapam nem conseguem trocar o nome entre validação e emissão.

Testes cobrem JSON inválido contendo e-mail/CPF/token de fixture, metadata de driver/rede, warn, códigos desconhecidos, getters hostis e contratos dos módulos revisados. Não foram enviados dados de cliente nem requests de webhook falsos à produção.

Não foram alterados HMAC, processamento, deduplicação, estoque, pagamento ou respostas funcionais das rotas. Logs MP já possuem whitelist própria e foram preservados. Logs fixos de startup e o status numérico do provider de cartão já eram técnicos. A mensagem de erro de runMigrations.js ficou fora da mudança: CLI explícita com SQL controlado, não executada no runtime de produção nem nesta tarefa. Não executar migrations com dados/secrets inline e saída não revisada.

Logs históricos, audit_logs privados no banco e retenção do Railway/Cloudflare são assuntos distintos de stdout sanitizado. Não houve exclusão desses registros. Respostas HTTP de erro também não foram redesenhadas nesta mudança de logging.

## 3. Dados da Cliente e Mapa de Placeholders

Checkboxes abaixo continuam pendentes até aprovação do operador/cliente. Campos vazios de formulário com máscaras são placeholders de UI, não dados empresariais válidos. Nada foi substituído por um valor inventado.

| Dado a obter/aprovar | Campo exato | Onde aparece / situação de ligação |
|---|---|---|
| [ ] Razão social/nome empresarial e nome fantasia | general.company_name, general.trade_name, general.store_name | Geral no admin. Footer.jsx:57 ainda fixa Silvestre & Sousa; preencher o setting NÃO muda esse texto. Conectar o rodapé aos valores aprovados em correção posterior. |
| [ ] CNPJ real | general.cnpj | GeneralTab.jsx:15 tem máscara legítima de input. Footer.jsx:57 publica 00.000.000/0001-00 hardcoded e precisa ser ligado ao campo real. |
| [ ] E-mail de atendimento, com caixa postal funcionando | general.email | Contact.jsx:57 fixa atendimento@dhelenas.com.br e mailto. Ainda não usa general.email. Validar domínio real, sem presumir .com.br a partir do domínio .com da loja. |
| [ ] Telefone/DDD | general.phone | GeneralTab.jsx:19; campo vazio na leitura anterior. Não há linha pública específica de telefone em Contato; definir se será publicada. |
| [ ] WhatsApp/DDD/DDI e canal autorizado | general.whatsapp (número), social.whatsapp (link/canal do rodapé) | Contact.jsx:56 e ComingSoon.jsx:49 fixam wa.me/5500000000000. Footer.jsx:9-11 lê social.whatsapp, mas usa esse fallback zero. Atualizar ambos os campos de forma consistente e ligar Contact/ComingSoon aos dados aprovados. |
| [ ] Endereço de origem completo | address.cep, street, number, complement, district, city, state | Admin Endereço, cálculo de frete e etiqueta. Setting privado, não enviado ao público. Não torná-lo público indiscriminadamente para resolver Contato. |
| [ ] Endereço público da boutique/retirada | Não existe campo dedicado no frontend atual. Proposta a implementar: general.public_address, contendo somente endereço aprovado para publicação | Contact.jsx:59 fixa Rua das Flores, 123 — Centro (sob agendamento). A proposta não é um campo já ligado nem foi criada nesta fase. Alternativamente, publicação explícita em shipping.pickup_instructions pode compor instruções reais, mas não atualiza Contato hoje. |
| [ ] Horários/dias, agendamento e exceções | Não existe campo dedicado. Proposta a implementar: general.business_hours | Contact.jsx:63 fixa Segunda a sábado, das 9h às 18h. Confirmar o texto; não tratar como horário aprovado só por estar no código. |
| [ ] Nome, prazo e instruções de retirada | shipping.pickup_enabled, pickup_name, pickup_time, pickup_instructions | ShippingTab.jsx:32-36. Instruções públicas devem incluir como/quando retirar sem expor dados privados do remetente. Fallback da entrega não substitui endereço real. |
| [ ] Instagram exato e URL autorizada | social.instagram | Footer.jsx:8 lê esse campo. Contact.jsx:58 e Home.jsx:153-156 fixam @dhelenas.oficial/instagram.com; ComingSoon.jsx:40 fixa instagram.com/dhelenas. Ligar esses pontos ao mesmo perfil aprovado. |
| [ ] Nome/e-mail do remetente transacional | emails.sender_name, emails.sender_email no admin; EMAIL_FROM efetivo no backend | EmailsTab.jsx:12-13 coleta os campos, mas services.js usa EMAIL_FROM ou fallback noreply@dhelenas.com.br. Não basta preencher o admin. Revisar ligação antes do go-live. |
| [ ] Reply-to com caixa postal real | emails.reply_to | EmailsTab.jsx:14 existe; sendOrderEmail não repassa reply-to ao Resend. Exige ligação no envio e teste não financeiro posterior autorizado. Não criar variável de ambiente imaginária e presumir que o backend a lê. |
| [ ] Políticas comerciais e privacidade aprovadas | policies.return_policy, privacy_policy, terms_of_use, shipping_policy | PolicyPage.jsx lê esses campos e exibe Este conteúdo está sendo atualizado quando vazio. Leitura pública atual: return/privacy preenchidas, terms/shipping vazias. ProductDetail.jsx ainda promete 30 dias e primeira troca por conta da loja: confirmar e alinhar às políticas aprovadas. |
| [ ] Remetente Melhor Envio: nome, e-mail, telefone, CPF/CNPJ e inscrição estadual | shipping_sender.name, email, phone, document, state_register; endereço em address.* | Setting privado e is_public=false obrigatório. A etiqueta usa esses valores no backend. Não publicar documento ou enviar valores no chat; operador valida diretamente no ambiente seguro. |
| [ ] Contato técnico da integração Melhor Envio | MELHOR_ENVIO_USER_AGENT | melhorEnvioToken.js:6 e melhorEnvioOAuth.js:39 têm fallback atendimento@dhelenas.com.br. Configurar o identificador com contato autorizado. Não confundir User-Agent com token. |

Leitura pública atual confirmou general com store_name/currency/timezone, social sem campos preenchidos e policies apenas return/privacy. Não foi acessado nenhum valor de credencial nem documento do remetente nesta fase.

Bloqueiam publicação: identificação legal, canais reais publicados, endereço/horários/retirada aprovados, remetente/reply-to funcional, políticas aprovadas e remoção por substituição autorizada das informações fictícias visíveis. Redes opcionais, analytics e conteúdo editorial adicional podem ficar para depois se não forem anunciados como disponíveis.

Referências Base44 de imports compatíveis/hosts de imagens não são placeholders de razão social ou credenciais de produção. O componente legado IntegrationsTab.jsx contém textos e estados demo, mas não está registrado nas seções atuais de Settings; não foi usado como evidência de configuração real.

## 4. Mercado Pago PRODUÇÃO

- [ ] Primeiro resolver/homologar secret TEST da aplicação 6694235692742515 com a Order existente, sem novo Pix. Não mudar mais o algoritmo por hipótese.
- [ ] Operador instalar MERCADO_PAGO_ACCESS_TOKEN de PRODUÇÃO no backend Railway, pertencente à aplicação/conta da cliente; nunca em VITE_* ou no chat.
- [ ] Operador instalar MERCADO_PAGO_PUBLIC_KEY da mesma aplicação/ambiente. Hoje /api/payments/methods entrega a chave pública ao Brick; não existe necessidade de inventar uma env frontend para token privado.
- [ ] MERCADO_PAGO_MODE=production. Prefixo APP_USR, presença de token ou select do admin não provam o ambiente.
- [ ] Gerar/copiar a chave Webhook da configuração PRODUÇÃO da aplicação correta e instalar MERCADO_PAGO_WEBHOOK_SECRET diretamente no Railway. Client Secret não é Webhook Secret.
- [ ] URL HTTPS sem redirects: https://api.dhelenas.com/api/webhooks/mercado-pago. Configurar notificações de Orders; preservar query data.id e os headers x-request-id/x-signature no proxy.
- [ ] Confirmar restart/deploy, /health ok e database connected; registrar somente nomes/presença/modo/application_id, nunca valores de secrets ou hashes de secrets.
- [ ] GET /api/payments/test com admin: connected=true, environment=Produção, conta/application correspondentes. É GET de /users/me, não criação de pagamento; executar no gate futuro, não foi executado contra credenciais novas nesta fase.
- [ ] settings payments.pix_enabled=true quando a homologação permitir. GET /api/payments/methods deve indicar Pix available/enabled e ambiente Produção. Flags de presença não certificam assinatura ou pagamento real.
- [ ] Cartões: conferir PUBLIC KEY, card_enabled/debit_card_enabled, métodos e parcelas efetivas, sem tokenizar/pagar nesta preparação.
- [ ] Homologação de webhook PRODUÇÃO e smoke financeiro exigem autorização separada. TEST live_mode=false não comprova PRODUÇÃO live_mode=true. Não reutilizar a Order TEST como prova financeira em produção.
- [ ] Invalid HMAC continua 401, sem GET fallback; webhook válido usa GET oficial, referência/valor/moeda, deduplicação e aplicação idempotente. Simulação oficial valida transporte/HMAC, não equivale a pagamento real.

[Fonte oficial Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications).

## 5. Melhor Envio PRODUÇÃO

- [ ] Aprovar estratégia de autenticação de PRODUÇÃO e conta/remetente da cliente, separados do Sandbox.
- [ ] MELHOR_ENVIO_MODE=production é a fonte efetiva. shipping.melhor_envio_mode do admin não altera o ambiente do serviço automaticamente.
- [ ] Se usar token fixo: MELHOR_ENVIO_TOKEN de produção, MELHOR_ENVIO_TOKEN_MODE=production e estado de integração compatível. Nunca expor token, client secret ou refresh token.
- [ ] Gate técnico obrigatório: OAuth e refresh atuais usam somente sandbox.melhorenvio.com.br e service_key melhor_envio_sandbox_oauth. Se essa linha existir, getToken rejeita production antes do fallback. NÃO apagar a linha por SQL nem fazer simples troca de env esperando migração automática. Preparar fluxo autorizado de migração/isolamento ou implementar OAuth PRODUÇÃO em namespace separado, com testes e sem perder o Sandbox.
- [ ] Para OAuth futuro: credenciais de produção, redirect HTTPS registrado exatamente, scopes mínimos necessários, state validado, refresh criptografado e INTEGRATION_ENCRYPTION_KEY no backend. O callback atual é https://api.dhelenas.com/api/integrations/melhor-envio/oauth/callback, mas a implementação atual aceita apenas Sandbox.
- [ ] Confirmar MELHOR_ENVIO_USER_AGENT autorizado e MELHOR_ENVIO_WEBHOOK_SECRET próprio, diferente de OAuth/access token.
- [ ] Validar shipping_sender.* privadamente, address.*, pesos/dimensões de catálogo e serviço selecionado retornado pelo provedor.
- [ ] GET /api/shipping/test com admin: connected=true e environment=Produção; não tomar status visual estático como prova.
- [ ] Cotação não financeira pelo fluxo existente, com origem real e destino controlado autorizado; confirmar base https://melhorenvio.com.br/api/v2 e preço/prazo/volumes, sem adicionar envio ao carrinho do provedor.
- [ ] Compra/geração/impressão de etiqueta somente com autorização específica e pedido elegível pago; nenhuma dessas ações nesta fase.

## 6. Cloudflare, Domínios e E-mail

Observado por leitura pública: frontend e /health HTTPS responderam 200 com CF-Ray; API envia HSTS, frontend não apresentou HSTS/Cache-Control no HEAD consultado. Preflight do frontend retornou ACAO=https://dhelenas.com; origem invalid.example não recebeu ACAO. Esses testes não provam modo TLS da origem nem bloqueio do acesso direto ao Railway.

- [ ] Confirmar titularidade do domínio frontend dhelenas.com e api.dhelenas.com e seus registros/DNS targets Railway aprovados. www, se usado, deve ter política/canonical/redirect explícitos.
- [ ] Certificados válidos, renovação e TLS da origem; confirmar Full (strict) no painel Cloudflare, não apenas HTTPS no edge. Não desativar validação TLS nem aceitar Flexible como prova equivalente.
- [ ] HTTPS obrigatório sem loops. Rever HSTS do frontend após confirmar domínios/subdomínios; não ativar preload global por hipótese.
- [ ] VITE_API_URL=https://api.dhelenas.com no build frontend; CORS_ORIGIN com origens reais explícitas, sem *. Adicionar www somente se realmente existir/for usado.
- [ ] Bloquear/restringir acesso direto à origem antes de confiar em identidade por IP. O backend trust proxy=1 reconhece o salto Railway, mas não prova que a requisição veio do Cloudflare. Manter rate limits no edge.
- [ ] WAF/bot rules compatíveis com webhooks sem desafios interativos nessas rotas; nenhuma liberação global de segurança e nenhum bypass de HMAC. Não alterar query/header assinados.
- [ ] Bypass de cache em API/autenticação/pedidos/webhooks; HTML com política que permita atualização de versão; assets fingerprintados com cache próprio. Recovery de chunk não substitui configuração de HTML/cache correta.
- [ ] Rever logs/retention/export do edge: não registrar Authorization, x-signature, cookies, body ou dados payer em destinos de logging.
- [ ] Aprovar o domínio real do From e do Reply-To. O domínio da loja .com não autoriza presumir que .com.br pertence à cliente. DNS .com.br e MX/SPF/DMARC dos apex consultados não foram observados; tratar como verificação pendente, não como prova de domínio inexistente.
- [ ] Resend: adicionar/verificar o domínio autorizado, status verified e RESEND_API_KEY segura no backend. Usar exatamente os registros/seletores gerados pelo painel; não inventar DKIM/TXT.
- [ ] SPF na identidade/Return-Path exigida pelo provedor, DKIM com selector efetivo e alinhamento DMARC ao From. Ausência de SPF no apex não prova ausência no Return-Path/subdomínio. DKIM não foi certificado nesta auditoria.
- [ ] Publicar/revisar DMARC de acordo com os remetentes reais, validar MX/caixa postal para atendimento/reply-to e não sobrescrever registros existentes sem aprovação.
- [ ] Ligar emails.reply_to ao envio real, configurar EMAIL_FROM corretamente e testar e-mail não financeiro para caixa autorizada em etapa posterior. Nenhum e-mail foi enviado nesta fase.

Fontes: [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/), [Resend Verified Domains](https://resend.com/docs/dashboard/domains/introduction).

## 7. Ordem de Liberação

1. Instalar/homologar secret TEST correto usando apenas retry real da Order existente; manter manutenção ligada.
2. Receber e aprovar dados reais, políticas e decisões de publicação; ligar os consumidores que hoje estão hardcoded ou não funcionais.
3. Resolver autenticação Melhor Envio PRODUÇÃO isolada e envio/reply-to real; avaliar/validar destinos de CTA do CMS.
4. Operador configurar credenciais e webhooks de PRODUÇÃO; validar saúde, cotação, DNS/Resend/Cloudflare e verificações não financeiras.
5. Solicitar autorização própria para eventual smoke financeiro/etiqueta. Não inferir autorização desta checklist.
6. Somente após todos os gates: autorização específica para desligar manutenção. Não alterar main nem mergear PR #3 nesta preparação.

## 8. Verificação do Código

Executar após as últimas correções: npm run lint; npm run typecheck; build com VITE_API_URL=https://api.dhelenas.com; backend npm test; npm audit --omit=dev nos dois diretórios; git diff --check. Audits podem retornar exit 1 por itens não alcançáveis documentados, sem mascarar os counts.

As correções desta fase são restritas a logging e seus testes. Nenhum dependency upgrade, operação financeira, troca de modo, credencial, configuração pública ou manutenção foi executado.

Resultados finais: lint PASS; typecheck PASS; build de produção PASS; backend 140/140 PASS (135 anteriores + 5 novos testes); git diff --check PASS. Audit frontend --omit=dev: 0 critical / 6 high / 5 moderate / 3 low no grafo instalado, com reachability discriminada acima. Audit backend --omit=dev: todos os counts zero.

Entrega local na branch codex/production-hardening: não houve commit/push/redeploy nesta etapa de preparação. As correções de logging ainda precisam ser publicadas e verificadas antes do cutover. Main remoto permanece d5378bac76f59d1dba5aa6ec5adf93b924b130f2, PR #3 OPEN/mergedAt=null e maintenance_mode=true na leitura pública final.
