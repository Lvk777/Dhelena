# Virada proposta para catálogo vazio — não executada

Retrato revalidado em leitura no Supabase em 22/10/2026: os mesmos 14 pares SKU/UUID abaixo continuam `published`; existem 15 produtos no total, nenhum criado no dia, e `operational_start` não existe. Antes da execução produtiva, reconfirmar esses estados e que nenhum outro produto esteja publicado. Nenhum dado comercial deste retrato foi aprovado.

| SKU | ID | Antes → Depois |
| --- | --- | --- |
| DH-BL-001 | e6dfe65b-f491-41e2-b54d-5c4499a69be7 | published → archived |
| DH-VD-002 | e047c673-a19e-4246-9596-ad9338054fab | published → archived |
| DH-AC-001 | df3f56b5-8b86-40b4-b502-0c64e29b1fa8 | published → archived |
| DH-CJ-001 | c58eb5d6-86cf-4e89-ac8f-d63c49cdceaf | published → archived |
| DH-VD-004 | b4208c4c-9f6f-425c-aeac-27290d43f455 | published → archived |
| DH-CA-002 | a438cb1c-0ce6-471f-adfc-0ba3595b67d7 | published → archived |
| DH-CA-001 | 9efbc69c-6575-407f-9755-771f13d99214 | published → archived |
| DH-VD-003 | 9967b18f-20d4-4112-bd49-c2c1cc95d2fe | published → archived |
| DH-CJ-002 | 896b0cf3-b1c4-43db-8761-a2e1a07d3b36 | published → archived |
| DH-BL-002 | 7b899e4e-7e4d-46cb-9e2d-be89bc9683f6 | published → archived |
| DH-BL-003 | 71498a89-8ea9-456b-a414-f832da2c196e | published → archived |
| DH-AC-002 | 5521b0a1-eeb7-4e06-b904-0de205c3ce55 | published → archived |
| DH-AC-003 | 211ffc61-8da5-4a40-922c-73c403c0a2dd | published → archived |
| DH-VD-001 | 066af33a-e7dd-4575-94e6-afb52ab931fe | published → archived |

Somente `products.status` e `updated_date` mudariam nesses 14 registros. Fotos, variantes, quantidades físicas, pedidos, pagamentos, estornos e movimentos históricos permaneceriam intactos. O estoque **exibido** do catálogo publicado ficaria em zero. Uma nova linha interna de `settings` com `key='operational_start'`, `is_public=false` e timestamp UTC separaria os indicadores. Lucro líquido passaria a “A apurar” após a primeira venda paga, pois não há livro completo de custos e tarifas. Saldos externos não mudariam.

## Pré-condições e retrato para conferência

Com manutenção ligada, antes de qualquer escrita: salvar privadamente `SELECT id,sku,status,updated_date,colors,images FROM products WHERE status='published' ORDER BY sku`, `SELECT status,count(*) FROM products GROUP BY status` e `SELECT key,value,is_public FROM settings WHERE key IN ('operational_start','maintenance')`. Confirmar os 14 IDs e ausência da chave operacional. Se o retrato divergir, parar e gerar nova prévia. Verificar Data API e auto deploy desligados. A decisão da responsável é não incluir criação de backup nesta virada; a reversão descrita abaixo depende do estado dos registros após a execução e pode deixar de ser segura se houver vendas ou edições concorrentes.

## SQL exato proposto, sujeito a autorização específica

Executar em conexão direta autorizada. O bloco falha se houver produto publicado adicional, chave já existente ou manutenção desligada. O código novo precisa estar publicado primeiro, mediante autorização separada, para que os indicadores e o checkout usem estas regras.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE products, settings IN SHARE ROW EXCLUSIVE MODE;
DO $launch$
DECLARE
  ids uuid[] := ARRAY[
    'e6dfe65b-f491-41e2-b54d-5c4499a69be7','e047c673-a19e-4246-9596-ad9338054fab',
    'df3f56b5-8b86-40b4-b502-0c64e29b1fa8','c58eb5d6-86cf-4e89-ac8f-d63c49cdceaf',
    'b4208c4c-9f6f-425c-aeac-27290d43f455','a438cb1c-0ce6-471f-adfc-0ba3595b67d7',
    '9efbc69c-6575-407f-9755-771f13d99214','9967b18f-20d4-4112-bd49-c2c1cc95d2fe',
    '896b0cf3-b1c4-43db-8761-a2e1a07d3b36','7b899e4e-7e4d-46cb-9e2d-be89bc9683f6',
    '71498a89-8ea9-456b-a414-f832da2c196e','5521b0a1-eeb7-4e06-b904-0de205c3ce55',
    '211ffc61-8da5-4a40-922c-73c403c0a2dd','066af33a-e7dd-4575-94e6-afb52ab931fe'
  ]::uuid[];
  changed integer;
BEGIN
  PERFORM id FROM products WHERE status = 'published' FOR UPDATE;
  IF (SELECT count(*) FROM products WHERE status = 'published') <> 14
     OR (SELECT count(*) FROM products WHERE id = ANY(ids) AND status = 'published') <> 14
     OR EXISTS (SELECT 1 FROM settings WHERE key = 'operational_start')
     OR NOT EXISTS (SELECT 1 FROM settings WHERE key = 'maintenance'
                    AND value->>'maintenance_mode' = 'true') THEN
    RAISE EXCEPTION 'Pré-condições da virada divergiram';
  END IF;
  UPDATE products SET status = 'archived', updated_date = now()
  WHERE id = ANY(ids) AND status = 'published';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 14 THEN RAISE EXCEPTION 'Arquivamento incompleto'; END IF;
  INSERT INTO settings(key, value, is_public)
  VALUES ('operational_start', jsonb_build_object('start_at',
    to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), false);
  IF EXISTS (SELECT 1 FROM products WHERE status = 'published') THEN
    RAISE EXCEPTION 'Catálogo ainda contém produtos publicados';
  END IF;
END $launch$;
COMMIT;
```

Após a virada, conferir leituras de catálogo, sacola antiga, checkout, estoque, dashboard, relatórios e cadastro em rascunho, sem cobrança. A aplicação produtiva ainda não foi alterada.

## Recuperação

Antes do `COMMIT`, qualquer falha exige `ROLLBACK`. Depois, manter manutenção ligada, conferir se surgiram pedidos desde o marco e usar o retrato privado anterior. Se os 14 ainda estiverem arquivados e **não houver vendas novas**, a reversão autorizada é uma transação que restaura `status='published'` para esses mesmos IDs, atualiza `updated_date`, exclui a chave `operational_start` somente se criada nesta virada, confere contagens e faz `COMMIT`. Se houver vendas novas ou mudança concorrente, não remover o marco nem republicar em lote; conciliar e recuperar individualmente.

Após essas verificações e uma **nova autorização específica de recuperação**, a ação exata é:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $recover$
DECLARE changed integer;
BEGIN
  IF (SELECT count(*) FROM orders WHERE created_at >=
      (SELECT (value->>'start_at')::timestamptz FROM settings WHERE key='operational_start')) > 0
     OR NOT EXISTS (SELECT 1 FROM settings WHERE key='maintenance'
                    AND value->>'maintenance_mode'='true') THEN
    RAISE EXCEPTION 'Recuperação em lote insegura';
  END IF;
  UPDATE products SET status='published', updated_date=now()
  WHERE status='archived' AND sku = ANY(ARRAY[
    'DH-BL-001','DH-VD-002','DH-AC-001','DH-CJ-001','DH-VD-004','DH-CA-002','DH-CA-001',
    'DH-VD-003','DH-CJ-002','DH-BL-002','DH-BL-003','DH-AC-002','DH-AC-003','DH-VD-001']);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 14 THEN RAISE EXCEPTION 'Estados divergem do retrato anterior'; END IF;
  DELETE FROM settings WHERE key='operational_start';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Marco operacional ausente'; END IF;
END $recover$;
COMMIT;
```

Esse procedimento só se aplica se a chave não existia antes, como exigido pelo bloco de virada, e se a cópia anterior confirmar os 14 estados `published`.

Bloqueios externos para abertura: publicação autorizada do código, backup/restauração, virada SQL, RLS e credenciais produtivas, homologações reais de Auth/SMTP, pagamentos e etiqueta, novos produtos com dados aprovados e políticas definitivas da advogada. Nenhum texto jurídico provisório foi publicado.
