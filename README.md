# D’Helenas

Loja virtual de moda feminina. O frontend utiliza React e Vite; a API utiliza Node.js, Express e PostgreSQL.

- [Arquitetura](ARCHITECTURE.md)
- [Publicação e configuração](DEPLOY.md)
- [Orientações de manutenção](AGENTS.md)

## Desenvolvimento Local

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Execute o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

O servidor de desenvolvimento utiliza a porta `5551` por padrão (`http://localhost:5551`). Para acesso externo durante o desenvolvimento, configure um túnel próprio.

## Build para Produção

```bash
VITE_API_URL=https://api.dhelenas.com npm run build
```

O build falha intencionalmente sem `VITE_API_URL` para impedir que o frontend de produção envie `/api` ao próprio host estático. Consulte [DEPLOY.md](DEPLOY.md) para configurar Railway, Cloudflare e Supabase.
