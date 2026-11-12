# Políticas D’Helenas — revisão de 30/10/2026

Os arquivos são a fonte editorial local; **não são importados automaticamente** para `settings.policies`. A identificação legal foi conferida no comprovante de inscrição e situação cadastral do CNPJ emitido pela Receita Federal em 30/10/2026, às 20:58:24, fornecido pela responsável. O documento comprova CNPJ ativo, nome empresarial e endereço cadastral; não comprova que o endereço seja ponto de atendimento.

- [Trocas e devoluções](trocas-e-devolucoes.md): mantém arrependimento de 7 dias e troca comercial de 30 dias, custos e direitos separados.
- [Entrega e frete](entrega-e-frete.md): aprovada com até 2 dias úteis para preparar e entregar efetivamente o pacote à transportadora, após confirmação do pagamento.
- [Termos de uso](termos-de-uso.md): identificação legal conforme o comprovante e direitos da consumidora preservados.
- [Privacidade](privacidade.md): controladora identificada; categorias e prestadores descritos conforme os fluxos revisados.

Contatos institucionais: `contato@dhelenas.com` para contato geral; `suporte@dhelenas.com` para atendimento, trocas e privacidade; `pedidos@dhelenas.com` para mensagens de pedidos. WhatsApp autorizado pela responsável: (11) 92718-9069. Atendimento de segunda a sexta-feira, 8h–18h, com resposta inicial em até 1 dia útil. Loja exclusivamente on-line, sem retirada. Endereço cadastral não se torna ponto de retirada.

As quatro políticas foram aprovadas e salvas em `settings.policies` em 30/10/2026; a leitura pública foi reconfirmada em 12/11/2026. O comprovante empresarial foi recebido como anexo desta tarefa; o original não foi copiado para o repositório por conter contato pessoal. O WhatsApp, dias e horários foram confirmados separadamente pela responsável.

Implementação autorizada: `shipping.melhor_envio_extra_days=2` e `SHIPPING_PREPARATION_ENABLED=true`. O backend informa o estado efetivo em `shipping.preparation` da configuração pública. A soma é em dias úteis; a UI não converte para datas corridas. A preparação inclui entrega efetiva à transportadora dentro do horário de corte. Ponto intermediário que acrescente prazo exige nova homologação.

Os quatro campos publicados correspondem ao texto simples gerado por `scripts/preparePolicyPublication.mjs`. A versão anterior de `settings.policies` e o JSON aprovado foram preservados fora do repositório, em `C:\Users\vitor\.codex\backups\dhelenas-policies-2026-10-30`. O renderer aceita texto simples; alterações futuras exigem nova revisão e sincronização explícita.

Referências: [CDC](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm), [Decreto 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), [direitos dos titulares — ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares), [guia de cookies — ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais), [contagem de entrega — Melhor Envio](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/39933307558164-Como-calcular-a-data-estimada-de-entrega-dos-meus-envios).
