# Auditoria de catálogo e conteúdo — leitura de 20/10/2026

Fonte: `GET /api/products?limit=60` e `GET /api/settings` públicos, sem autenticação e sem acesso a dados de clientes. Este é um retrato técnico; **nenhum preço, estoque, peso, dimensão ou texto comercial foi aprovado** por esta leitura. Nenhum dado produtivo foi alterado.

## Produtos publicados

| SKU | Produto | Preço / promoção (R$) | Variantes com estoque / total | Peso kg | Embalagem cm (A × L × C) |
| --- | --- | ---: | ---: | ---: | --- |
| DH-BL-001 | Blusa Serena | 189,90 / — | 8 / 10 | 0,20 | 58 × 50 × 5 |
| DH-VD-002 | Vestido Aurora | 349,90 / 279,90 | 3 / 5 | 0,30 | 70 × 38 × 28 |
| DH-AC-001 | Bolsa Sofia | 329,90 / — | 2 / 2; saldo agregado 40 | 0,60 | 22 × 30 × 12 |
| DH-CJ-001 | Conjunto Lúcia | 459,90 / — | 5 / 10 | 0,70 | 62 × 40 × 30 |
| DH-VD-004 | Vestido Íris | 299,90 / — | 5 / 10 | 0,40 | 95 × 44 × 5 |
| DH-CA-002 | Calça Paloma | 239,90 / — | 8 / 10 | 0,35 | 100 × 38 × 5 |
| DH-CA-001 | Calça Margot | 259,90 / — | 8 / 10 | 0,35 | 105 × 40 × 5 |
| DH-VD-003 | Vestido Beatriz | 319,90 / — | 5 / 5 | 0,35 | 95 × 42 × 5 |
| DH-CJ-002 | Conjunto Sofia | 489,90 / — | 5 / 5 | 0,50 | 50 × 40 × 10 |
| DH-BL-002 | Blusa Helena Silk | 219,90 / 175,90 | 9 / 10 | 0,20 | 60 × 48 × 5 |
| DH-BL-003 | Blusa Maria | 169,90 / — | 5 / 5 | 0,25 | 64 × 52 × 5 |
| DH-AC-002 | Colar Ponte | 159,90 / — | 1 / 1; saldo agregado 50 | 0,05 | 10 × 10 × 3 |
| DH-AC-003 | Cinto Aurora | 119,90 / — | 2 / 2; saldo agregado 69 | 0,15 | 5 × 20 × 10 |
| DH-VD-001 | Vestido Helena | 289,90 / — | 8 / 10 | 0,40 | 60 × 40 × 30 |

Todos os 14 têm duas URLs de foto, 28/28 responderam HTTP 200 `image/jpeg`, todas as variantes têm estoque inteiro não negativo e todos os pesos e dimensões são positivos. Os três acessórios têm tamanho `Único`, mas ainda armazenam saldo nas chaves legadas `PP/P/M/G/GG`; frontend e backend somam essas chaves. A Juliane precisa confirmar se os totais agregados 40/50/69 correspondem às unidades físicas, pois as chaves podem representar um cadastro antigo. Isto confirma apenas integridade básica, não autenticidade, qualidade visual ou medidas físicas. Todas as fotos usam `media.base44.com`, uma dependência externa do antigo serviço. Fotos idênticas são reutilizadas entre três blusas, quatro vestidos, dois conjuntos, duas calças e três acessórios; a Juliane precisa confirmar quais imagens pertencem a cada SKU e variante. A ausência de foto específica por cor também precisa de decisão editorial.

## Conteúdo público

- Entrega: política publicada com preparação de até dois dias úteis, coerente com a configuração pública de preparação e com retirada presencial desativada. A Juliane deve confirmar que a operação consegue cumprir o texto e aprovar sua redação.
- Trocas e devoluções: valor cadastrado é um texto de teste, ocultado pelo frontend. Página pública mostra conteúdo em atualização. Requer texto jurídico/comercial aprovado.
- Privacidade: valor cadastrado é um texto de teste, ocultado pelo frontend. Página pública mostra conteúdo em atualização. Requer política LGPD aprovada.
- Termos de uso: vazio. Página pública mostra conteúdo em atualização. Requer texto aprovado.
- Contato: formulário usa `POST /api/contact`; telefone, e-mail, endereço público e horários dependem dos settings. Confirmar canais, horário e responsável pelo tratamento das mensagens.
- Nossa História: texto estático no frontend cita Juliane, Lucilene e “Método PONTE®”. Confirmar narrativa, nomes, imagens e uso do símbolo ® antes de abrir a loja.

## Ensaio local da experiência

O frontend foi servido localmente com uma fixture que consulta somente as rotas públicas de catálogo e configurações; a manutenção foi desligada **apenas na resposta local**. O login administrativo usou identidade sintética. Nenhum pedido, contato ou cadastro foi enviado. Em 375, 768, 1024 e 1440 px, loja, detalhe de produto, sacola e lista administrativa de 14 produtos não tiveram rolagem horizontal nem imagem quebrada. Em 375 px, as seis páginas de conteúdo e as sete etapas do editor de produtos também não tiveram rolagem horizontal. A sacola recebeu um item de teste somente no navegador; a finalização parou no pedido de login.

Defeito técnico corrigido no código local: Contato e Nossa História exibiam o título e URL canônica genéricos da loja. Agora usam metadados próprios, sem alterar o conteúdo comercial. ESLint e build Vite aprovados com `VITE_API_URL` definido somente para o comando local. O build avisou que o bundle principal supera 500 kB; otimização de carregamento continua pendente antes do lançamento.

## Confirmações necessárias da Juliane

1. Preço normal e promocional, disponibilidade e estoque real de cada SKU/variante; conferir especialmente os três acessórios de tamanho único com chaves legadas de estoque.
2. Foto principal/secundária de cada SKU e cor; autorizar migração das mídias para armazenamento próprio antes de depender do antigo domínio.
3. Peso e dimensões **da embalagem expedida**, não apenas da peça, para cotação e etiqueta; conferir SKU, descrição, composição e grade de tamanhos.
4. Conteúdo de entrega, trocas, privacidade e termos, com revisão jurídica adequada; canais de contato e narrativa da marca.
