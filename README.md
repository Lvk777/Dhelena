# Dhelena

Projeto e-commerce Dhelena - Aplicação React + Vite standalone.

## Desenvolvimento Local

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Execute o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

O servidor iniciará por padrão na porta `5551`, compatível com o túnel do ngrok:
`https://angella-soullike-virgie.ngrok-free.dev` -> `http://localhost:5551`

## Build para Produção

```bash
VITE_API_URL=https://api.dhelenas.com npm run build
```

O build falha intencionalmente sem `VITE_API_URL` para impedir que o frontend de produção envie `/api` ao próprio host estático. Consulte [DEPLOY.md](DEPLOY.md) para configurar Railway, Cloudflare e Supabase.
