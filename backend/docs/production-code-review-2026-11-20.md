# Revisão direcionada de checkout, NF-e e expedição — 20/11/2026

## Escopo da mudança

Esta rodada foi feita sobre o branch `codex/production-hardening`, sem migração,
alteração no banco de produção, criação de etiqueta ou ativação da loja.

1. **PostgreSQL:** conexões de produção e Supabase passaram a validar certificado
   e nome do servidor via TLS. Um `sslmode` inseguro é rejeitado; o parâmetro do
   URI não pode substituir silenciosamente o objeto de SSL do driver.
2. **Checkout:** o cálculo remoto de frete sai do período de transação com
   bloqueio de produtos, cliente e cupom. Antes de gravar o pedido, o servidor
   recalcula os preços e compara todos os parâmetros utilizados na cotação
   preliminar (origem, destino, produtos, dimensões, quantidade e valor).
   Divergências encerram a operação sem pedido e sem cobrança.
3. **NF-e:** chave e protocolo do XML são preenchidos automaticamente no
   formulário de conferência para evitar digitação repetitiva. Continua
   obrigatório conferir a situação atual no portal oficial e marcar as
   declarações; os dados importados não provam autorização atual.
4. **Expedição:** a interface sinaliza dimensões ou peso inválidos salvos numa
   cotação PAC/SEDEX. Não substitui medidas antigas por suposições.

## Pré-requisito antes de publicar o backend

**Não publicar esta revisão do backend sem validar uma conexão TLS com o banco
Supabase usando uma cópia/ambiente seguro e as mesmas opções previstas para o
Railway.** Baixar o certificado raiz correto nas configurações do banco
Supabase, conferir sua procedência e, caso necessário, configurar o segredo
`DATABASE_SSL_CA_PEM` no serviço do Railway. O valor pode conter quebras de
linha reais ou `\n`. Não gravar o PEM nem a `DATABASE_URL` no repositório.

O cliente PostgreSQL também utiliza a cadeia de certificados confiáveis do
ambiente. Um erro de validação TLS deve bloquear o lançamento e ser investigado,
jamais resolvido com `rejectUnauthorized: false` ou `sslmode=no-verify`.

## Limites operacionais que permanecem

- O pedido 19 segue exigindo conciliação externa da tentativa anterior
  `cart_inflight` no Melhor Envio; carrinho vazio não prova ausência de envio.
  **Não desbloquear automaticamente nem repetir POST ao provedor.**
- As medidas da embalagem fechada devem ser verificadas fisicamente. Uma
  cotação persistida inválida não pode ser corrigida por valores inventados.
- A verificação atual da NF-e é uma declaração administrativa de consulta em
  fonte oficial, não uma integração automática de consulta à SEFAZ.
- Antes de abrir a manutenção, exercitar o ciclo completo de compra, pagamento,
  NF-e e preparação de etiqueta em ambiente controlado. Não comprar etiqueta
  sem autorização operacional independente.

## Validação local

- `npm test --prefix backend`
- `npm run test:admin`
- `npm run test:static`
- `npm run lint`, `npm run typecheck`
- `VITE_API_URL=https://api.dhelenas.com npm run build`

O CI da PR deve concluir novamente após a publicação do commit. Esta revisão
não substitui testes com Supabase/Melhor Envio em ambientes autorizados, nem
comprova o estado atual dos pedidos reais.
