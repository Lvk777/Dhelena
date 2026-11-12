# D'Helenas — fechamento operacional de 12/10/2026

Manutenção **ON**. Trabalho na branch `codex/production-hardening`; main preservada e PR #3 sem merge. Nenhum pagamento, pedido comercial, compra de frete ou etiqueta criado neste fechamento. Webhook Mercado Pago preservado.

## Alterações externas especificamente autorizadas

### Contenção da Data API

Antes da mudança: `/health` respondeu 200 com `database=connected`; o painel indicava PostgreSQL Supabase em produção. O backend usa `pg.Pool(DATABASE_URL)` para as tabelas. A busca no código encontrou somente Supabase Auth e Storage como usos do SDK, sem consultas de tabelas, RPC de dados, GraphQL ou Realtime do frontend/backend. Nenhuma dependência conhecida da Data API foi encontrada.

`Enable Data API` foi salvo **OFF**, exclusivamente no projeto D'Helenas. O painel confirmou “Data API is disabled”. A opção de exposição automática ficou inacessível depois disso. O responsável escolheu explicitamente **preservar OFF e deixar esse segundo controle pendente**, sem reativação temporária. Não houve revogação de grants, ativação de RLS ou mudança de outros controles de segurança.

Checagens imediatas e pós-migration:

| Serviço | Resultado | Limite da evidência |
| --- | --- | --- |
| Backend / PostgreSQL | `/health` 200, `database=connected` | Executa `SELECT 1` pela conexão do backend |
| Auth | `/auth/v1/settings` 200; sessão existente revalidada no painel | Nenhum novo cadastro, envio de senha ou troca de credenciais |
| Perfil | Página de conta da sessão existente abriu | Não comprova entrega de e-mail de novos clientes |
| Produtos / categorias / coleções | API 200; 5 categorias e 3 coleções | Leitura pública; sem edição comercial |
| Sacola | Sacola existente abriu com produto e subtotal | Nenhum item real alterado, pedido ou pagamento confirmado |
| Cupom | Validação não financeira retornou 200 e rejeitou código inexistente | Sem criação, ativação, uso ou consumo de cupom real |
| Admin | Integrações, configurações, categorias e coleções abriram autenticadas | Formulários abertos e fechados sem salvar conteúdo comercial |
| Storage | HEAD de imagem pública retornou 200 `image/webp` | Sem upload/exclusão real |
| REST / GraphQL direto | Ambos 503 com chave pública publicada do cliente | Apenas categoria limitada e `__typename`; nenhuma consulta de dados pessoais |
| Manutenção | `maintenance_mode=true` | Conferida no banco e endpoint público |

O bloqueio HTTP não substitui grants/RLS nem prova recuperação integral. Não reativar a Data API sem autorização específica e revisão da exposição existente. [Documentação oficial de contenção](https://supabase.com/docs/guides/api/securing-your-api).

### Remetente / origem privados

Foram corrigidos exclusivamente e-mail e telefone do remetente e bairro da origem, com os valores fornecidos e autorizados. Os valores anteriores foram conferidos antes de salvar. Após recarregar, os demais campos dos formulários foram comparados e preservados. A comparação no banco confirmou os três valores autorizados e `is_public=false` para ambos os registros. Os valores privados não constam neste relatório.

Nenhum contato público, configuração financeira, pedido, estoque ou opção de retirada foi alterado. A retirada já estava habilitada no cadastro anterior; não foi habilitada por este trabalho e ainda requer decisão comercial sobre local, horários e instruções. Esta atualização é do cadastro da loja usado como origem/remetente; não comprova atualização da conta externa do Melhor Envio nem OAuth de produção.

### Migration 014

Original: `backend/migrations/014_category_collection_fields.sql`, SHA256 `669a9d6402af40b362e3d912fec75b2ea533f423ef887cf580474d9a25ae0a97`, conteúdo preservado.

Pré-checagem real: PostgreSQL 17.6, 29 tabelas, 400 colunas e 94 constraints; hashes das colunas e constraints iguais ao snapshot esperado. Nenhuma das sete colunas existia. Ensaio local PostgreSQL 17 passou com aplicação dupla, leitura/escrita sintética dos campos e rollback. A transação preparada também foi executada em banco local antes da produção, verificando igualdade do conteúdo original.

Aplicação real autorizada: transação com `lock_timeout=5s`, `statement_timeout=30s` e locks das duas tabelas. Snapshot temporário de contagens/digests dos registros foi comparado antes do commit, descontando apenas as colunas novas. As colunas e defaults foram confirmados:

| Tabela | Colunas novas |
| --- | --- |
| categories | `description text`, `status text DEFAULT 'active'` |
| collections | `banner_image text`, `status text DEFAULT 'active'`, `featured boolean DEFAULT false`, `start_date timestamptz`, `end_date timestamptz` |

Resultado: **7 colunas**, 407 colunas públicas, 5 categorias e 3 coleções, registros anteriores preservados. As leituras públicas passaram. Os formulários reais mostraram descrição/status, banner, destaque e datas; foram fechados sem salvar dados comerciais. Nenhuma outra migration executada em produção. RLS permaneceu no estado anterior.

O responsável dispensou o backup real e autorizou explicitamente esta migration sem ele. Houve ensaio sintético e rollback local, mas **não existe restauração integral comprovada do banco real**. Depois do commit, remover colunas pode perder conteúdo futuro; não executar DROP nem prometer recuperação sem perdas. O arquivo `backend/supabase/security/2026-10-12_apply_014.sql` guarda o procedimento executado e aborta se detectar aplicação prévia/parcial.

## Checkout Pix e acesso à conta

O backend calcula preços, desconto, frete e total em centavos, com catálogo e estoque atuais. O Pix dá 5% somente sobre produtos, nunca sobre frete. Cupom escolhido, promoção monetária ou qualquer item com preço de promoção bloqueia o desconto Pix, inclusive em sacolas mistas. As regras existentes de combinação de cupom/campanha foram preservadas. Frete grátis usa o subtotal de produtos após descontos, no limite configurado de R$ 499.

O checkout consulta um preview de leitura, mostra os descontos e exige o total confirmado antes de criar pedido. O serviço final recalcula em transação e rejeita divergências; rollback não consome estoque/cupom. O snapshot conserva a composição dos descontos. O teste do payload Mercado Pago mock confirma valor exatamente igual ao total final, com idempotência.

A oferta depende **simultaneamente** de `PIX_DISCOUNT_ENABLED=true` no backend e `payments.pix_discount=5`. O default é desativado e o flag não foi ativado no Railway. A UI só anuncia a oferta quando o backend a habilita. Homologação com mocks passou; aprovação comercial da Juliane e ativação específica ainda pendentes.

Recuperação de senha: a UI mantém formulário e tentativa quando o provedor falha; não informa envio bem-sucedido em 400/429/500/erro de rede. Em respostas aceitas, usa mensagem genérica para contas existentes/inexistentes. O checkout orienta consultar Meus pedidos, sem prometer notificações ainda indisponíveis. O painel distingue mensagens de pedidos via Resend das mensagens do Supabase Auth.

Verificação técnica: **234/234 testes backend**, incluindo 17 casos Pix e 4 de recuperação. Mocks cobrem cupom, promoção, sacola mista, frete pago/grátis, limite de centavos, estoque agregado, rollback, idempotência e payload Mercado Pago. Ensaio PostgreSQL 17 passou com concorrência de estoque/cupom, perfis e migration 014. Checkout visual desktop e celular: total R$ 209,90 para R$ 199,90 − R$ 10,00 + R$ 20,00; com cupom de 1% e retirada simulada, R$ 197,90 sem Pix. Sem rolagem horizontal no celular, sem erros de console no checkout. Recuperação com SMTP simulado 503 exibiu erro e manteve nova tentativa. Nenhum botão de confirmação de pedido foi acionado no ensaio visual.

## Resultado e próximos passos mínimos

| Item | Classificação | Próxima ação |
| --- | --- | --- |
| Contenção REST/GraphQL, remetente privado e migration 014 | CONCLUÍDO | Preservar Data API OFF; evidências acima |
| Cálculo Pix / preview / rollback / recuperação com mocks | CONFIGURADO E TESTADO | Oferta pública ainda OFF; aprovação da Juliane antes de ativar |
| Exposição automática de novas tabelas | PODE FICAR PARA DEPOIS | Controle pendente por decisão expressa, com Data API OFF; não reativar para acessá-lo |
| SMTP / integrações em produção / oferta Pix pública | NECESSITA AUTORIZAÇÃO MINHA | Autorizações específicas futuras, depois de acesso, condições comerciais e procedimento concreto; nenhuma ativação neste fechamento |
| CNPJ oficial | NECESSITA AÇÃO DA JULIANE | Consulta Receita preparada; hCaptcha impede confirmação oficial. Não declarar situação cadastral validada |
| Condições comerciais | NECESSITA AÇÃO DA JULIANE | Aprovar Pix, limite líquido de frete grátis, custos/6x sem juros; confirmar estoque real, medidas por peça e embalagem |
| Contatos / retirada / políticas | NECESSITA AÇÃO DA JULIANE | Definir canais públicos, eventual retirada e horários/instruções; aprovar os quatro textos |
| Auth para novos clientes | BLOQUEIA INAUGURAÇÃO | SMTP próprio OFF; homologar cadastro/OTP, confirmação e recuperação entregues de verdade |
| Confirmação confiável de pagamentos | BLOQUEIA INAUGURAÇÃO | Mercado Pago continua TEST; preservar evidência `signature_mismatch`, acesso ao painel pendente de validação do titular; concluir configuração/entrega real e reconciliação sem marcar pago por retorno do navegador |
| Frete real | BLOQUEIA INAUGURAÇÃO | Melhor Envio só tem OAuth Sandbox; produção sem credenciais/autorização. Titular deve acessar a conta e autorizar produção; então cotar sem comprar fretes |
| Políticas e atendimento essenciais | BLOQUEIA INAUGURAÇÃO | Política de privacidade atual é explicitamente de teste; termos/entrega vazios, devoluções sem aprovação comprovada. Contatos públicos vazios |
| Comunicação essencial dos pedidos | BLOQUEIA INAUGURAÇÃO | Aprovar e homologar canal operacional antes de clientes reais; não presumir envio automático |
| Resend como ferramenta / WhatsApp automático | PODE FICAR PARA DEPOIS | Resend adiado pelo responsável; nenhuma conta criada. Isso não dispensa comunicação essencial funcional |

O [SMTP padrão do Supabase](https://supabase.com/docs/guides/auth/auth-smtp) só entrega a endereços da equipe do projeto e não atende cadastro/recuperação de clientes em produção. Não alterar confirmação de e-mail para contornar essa restrição. O template OTP e a entrega real ainda precisam de homologação. Nenhum fornecedor/remetente foi inventado.

Não retirar manutenção, ativar oferta pública Pix, trocar integrações para produção, criar cobrança ou comprar etiqueta enquanto os respectivos gates e autorizações estiverem pendentes.

Frontend local: lint, typecheck e build de produção passaram com `VITE_API_URL=https://api.dhelenas.com`. A publicação autorizada será somente na branch citada; resultados de CI e implantação devem ser conferidos para o commit enviado, sem merge.
