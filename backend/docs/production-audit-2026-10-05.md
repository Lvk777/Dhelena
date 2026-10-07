# Auditoria final de checkout — 2026-10-05

## Pix na Orders API

A [documentação oficial de Pix na Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix) usa `payment_method.id = pix` e `type = bank_transfer` ao criar uma order. A [referência dos endpoints da Orders API](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/overview) apresenta `GET /v1/payment_methods` como consulta **opcional** para a lista do checkout; ela não fornece um endpoint de leitura específico que ateste a aceitação futura de Pix via Orders API. A ausência de Pix nessa listagem em TEST não anulou a evidência de homologação anterior.

O checkout agora recebe uma capacidade calculada pela configuração: `MERCADO_PAGO_MODE` explícito, Access Token presente, segredo de webhook presente e `payments.pix_enabled` ligado. O backend aplica a mesma regra antes de criar um pedido Pix e antes de iniciar o pagamento. A lista de métodos continua a orientar crédito e débito; sua indisponibilidade desativa os cartões, sem mudar a capacidade Pix. Cada cobrança ainda é validada pela resposta e por um GET da Orders API. Falhas são apresentadas ao cliente com mensagem segura e exigem conciliação quando uma tentativa pode ter alcançado o provedor. Essa capacidade significa **integração configurada**, não uma garantia de aceitação pelo Mercado Pago.

O pedido Pix TEST aprovado no histórico serve somente como evidência de homologação. Não há consulta a esse pedido na rota de métodos nem dependência operacional de qualquer Order histórica. Nenhum Pix ou pedido novo foi criado nesta auditoria.

## URL da API e frete

`VITE_API_URL=https://api.dhelenas.com` e `VITE_API_URL=https://api.dhelenas.com/api` produzem a mesma base `https://api.dhelenas.com/api`. O cliente HTTP central usa essa base em auth, catálogo, sacola, frete, checkout, admin, settings, integrações e upload. O teste de contrato cobre as duas formas e rejeita a rota duplicada `/api/api/...`.

Frete grátis exige subtotal elegível **maior ou igual a R$ 499 após descontos**. Backend, sacola, checkout e cópia pública usam esse limite. Em 04/10/2026, às 18:31:46 no horário exibido pelo painel, a barra superior foi alterada no ambiente publicado para “Frete grátis a partir de R$ 499 · Parcelamos em até 6x”. A Central de Auditoria mostra `setting.update` para essa alteração. Foi uma mutação de conteúdo público, sem operação financeira.

## Evidência de concorrência PostgreSQL

O ensaio já realizado usou o banco **local e isolado** `dhelenas_audit_final_20261004`; não usou Supabase de produção. A segunda reserva aguardou `SELECT FOR UPDATE`; somente uma venceu quando o estoque não atendia ambas; o estoque não ficou negativo. Rollback preservou o estoque. Restaurações simultâneas geraram uma única reposição. O tamanho `Único` legado respeitou a proteção transacional. O script preservado está em `backend/integration/postgresConcurrency.mjs` e exige explicitamente um banco local `dhelenas_audit_*`.

## Limite desta rodada

Regressões de checkout param em **Pagamento**. Não clicar em “Confirmar pedido”, não gerar Pix, não criar pedido, não executar reembolso e não desligar manutenção. A publicação segue pela branch `codex/production-hardening`; `main` e o PR #3 não são alterados.
