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
