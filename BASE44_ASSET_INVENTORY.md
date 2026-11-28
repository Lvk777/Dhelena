# Inventário de ativos Base44

Data da revisão: 11 de setembro de 2026. Este documento é um inventário e um
plano de migração; ele não altera URLs, registros, buckets nem conteúdo remoto.

## Escopo encontrado

| Grupo | Fonte atual | Referências Base44 | Situação |
| --- | --- | ---: | --- |
| Produtos | `src/data/initialData.json`, `Product[*].images` | 28 em 14 produtos (11 arquivos únicos) | seed/fallback de dados |
| Categorias | `src/data/initialData.json`, `Category[*].image` | 5 em 5 categorias (5 arquivos únicos) | seed/fallback de dados |
| Banners | `src/data/initialData.json`, `Banner[*].image` | 2 em 2 banners (2 arquivos únicos) | seed/fallback de dados |
| Coleções | `src/data/initialData.json`, `Collection[*].image` | 0 | os 3 registros atuais têm imagem nula |
| Institucional | `src/data/products.js` | 3 URLs: hero, sobre e “complete o look” | usado por páginas públicas |
| Fallback de categorias | `src/data/products.js`, `CATEGORY_IMAGES` | 5 referências | usado por `About` e `Collections` |
| Seed SQL | `backend/supabase/schema.sql` | 5 categorias e 2 banners | réplica dos dados de seed |

Os caminhos institucionais usados no frontend são:

- `HERO_IMAGE` (também coincide com o banner principal);
- `ABOUT_IMAGE` (arquivo exclusivo do institucional);
- `LOOK_IMAGE` (arquivo exclusivo da Home);
- cinco imagens de categoria usadas como fallback.

Por isso as contagens acima não devem ser somadas cegamente: parte dos arquivos
é reutilizada entre o JSON, o seed SQL e os fallbacks da interface.

## Dependências Base44 que não são mídia

| Local | Resultado |
| --- | --- |
| `src/api/base44Client.js` | Não é SDK Base44: apenas reexporta o cliente HTTP local como compatibilidade de nome. |
| Chamadas `base44.*` em `src/` | Usam esse adaptador local para a API própria; não demonstram chamada à plataforma Base44. |
| `src/components/ui/image-helpers.js` | Reconhece `media.base44.com` para gerar URLs de transformação Wix/Base44; precisará ser ajustado somente depois da migração de mídia. |
| `.base44/environment.json`, `.env.base44-defaults`, `docker-compose.base44.yml` | Configuração legada de desenvolvimento/execução local; não é uma credencial nem um serviço Base44 em produção comprovado. |

## Plano de migração para Supabase Storage

1. Criar um manifesto fora do repositório com cada URL de origem, entidade,
   campo, `content-type`, tamanho e SHA-256. Manter as URLs Base44 ativas.
2. Criar ou confirmar o bucket privado de operação `store-assets` e políticas
   mínimas: leitura pública somente se o produto realmente exigir URL pública;
   escrita limitada ao backend/admin autorizado. Usar prefixes estáveis:
   `products/`, `categories/`, `banners/`, `collections/` e `institutional/`.
3. Com credenciais de Storage autorizadas, copiar um arquivo por vez, validar
   resposta HTTP, tipo, tamanho e hash, e gravar a URL de destino no manifesto.
   Não substituir nenhum campo de banco nesta fase.
4. Em uma janela revisada, atualizar cada entidade em transação com a dupla
   `origem -> destino` já validada. Atualizar em seguida os fallbacks de
   `src/data/products.js` e o seed SQL na mesma revisão, para que um novo
   ambiente não reintroduza URLs antigas.
5. Validar catálogo, banners, páginas institucional e uploads em navegador e
   dispositivos móveis. Preservar o manifesto e as URLs de origem por um prazo
   de retenção aprovado.
6. Somente após validação e aprovação explícita, decidir pela remoção no
   provedor de origem. Não há exclusão automática neste plano.

## Critério para começar

A migração depende de acesso autorizado ao Supabase Storage e de um destino
confirmado. Sem isso, o estado correto é manter os ativos atuais e não alterar
as referências. A substituição do adaptador de compatibilidade `base44` é uma
refatoração separada e não faz parte desta migração de ativos.

## Script preparado (não executado)

`scripts/prepare-base44-assets.mjs` gera no stdout um manifesto completo e
reprodutível, com URL de origem, cada registro/campo que a referencia e pasta
proposta de destino. O comando padrão é somente leitura lógica:

```bash
node scripts/prepare-base44-assets.mjs
```

O modo de cópia exige simultaneamente `--apply`, credenciais de Storage e a
confirmação literal `BASE44_ASSET_MIGRATION_APPROVED=YES`. Mesmo nesse modo ele
apenas cria cópias sob `base44-migration/<timestamp>/`; não atualiza banco ou
frontend e não apaga arquivos. A troca de referências continua sendo uma etapa
manual, revisada e reversível enquanto a origem estiver retida.
