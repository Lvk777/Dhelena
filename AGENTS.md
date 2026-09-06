# AGENTS.md

## Contexto do Projeto

Este é o projeto Dhelena, um e-commerce em React + Vite.
O projeto roda de forma autônoma/independente (sem dependência do Base44).

## Estrutura Principal

- `src/`: código-fonte da aplicação frontend.
- `src/api/apiClient.js`: cliente de API standalone (com persistência local/CRUD e stubs).
- `src/api/base44Client.js`: reexporta o cliente para manter compatibilidade com componentes existentes.
- `vite.config.js`: configuração do Vite (porta 5551 e suporte ao host ngrok).

## Comandos

- `npm run dev`: inicia o servidor de desenvolvimento na porta 5551.
- `npm run build`: compila a aplicação para produção.

## Ambiente Base44 (docker compose)

- `docker-compose.base44.yml`: sobe o app a partir do código-fonte clonado (imagem `node:22`), com bind-mount e Vite dev server (live reload). Porta do host `3000` mapeada para a porta `5551` do container.
- Sem backend nem credenciais externas: o app roda 100% standalone (persistência em `localStorage`, dados-semente em `src/data/initialData.json`). Não há secrets necessários para boot.
- `vite.config.js` usa `allowedHosts: true` para aceitar o hostname de preview variável.
- Verificação: `curl -sf -H "Host: external-preview.example.com" http://localhost:3000/` deve retornar o HTML do app; `/src/main.jsx` deve servir módulo fonte (não bundle pré-compilado).
