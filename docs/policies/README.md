# Políticas D’Helenas — revisão de 13/10/2026

**Entrega aprovada em 13/10/2026; as outras três políticas continuam MINUTAS PARA APROVAÇÃO.** Os arquivos não são importados automaticamente pelo aplicativo.

- [Trocas e devoluções](trocas-e-devolucoes.md): mantém arrependimento de 7 dias e troca comercial de 30 dias, custos e direitos separados.
- [Entrega e frete](entrega-e-frete.md): aprovada com até 2 dias úteis para preparar e entregar efetivamente o pacote à transportadora, após confirmação do pagamento.
- [Termos de uso](termos-de-uso.md): preserva os direitos da consumidora; identificação legal deve ser completada com o comprovante oficial antes da publicação.
- [Privacidade](privacidade.md): minuta baseada nos fluxos reais do código, distinguindo os serviços ativos das integrações ainda em teste.

Contatos públicos autorizados: (11) 93803-3499 / julianeassousa@outlook.com. Loja exclusivamente on-line, sem retirada. Endereço operacional não se torna automaticamente endereço legal público.

Antes de publicar as três minutas restantes: obter aprovação integral, completar identificação do fornecedor/controlador com os dados oficiais já conferidos na Receita Federal e validar retenção, contratos e transferências internacionais dos provedores. A verificação oficial não autoriza automaticamente a publicação dos dados cadastrais. Não copiar notas de revisão nem marcadores pendentes para as páginas públicas.

Implementação autorizada: `shipping.melhor_envio_extra_days=2` e `SHIPPING_PREPARATION_ENABLED=true`. O backend informa o estado efetivo em `shipping.preparation` da configuração pública. A soma é em dias úteis; a UI não converte para datas corridas. A preparação inclui entrega efetiva à transportadora dentro do horário de corte. Ponto intermediário que acrescente prazo exige nova homologação.

Somente o campo da Política de Entrega tem publicação autorizada nesta etapa. Os demais campos do banco continuam preservados. O código deixa de apresentar os dois textos de teste identificados na revisão anterior; apresenta conteúdo em atualização até a publicação aprovada. O renderer público aceita texto simples: remover marcações Markdown das versões aprovadas antes de salvar.

Referências: [CDC](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm), [Decreto 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), [direitos dos titulares — ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares), [guia de cookies — ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais), [contagem de entrega — Melhor Envio](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/39933307558164-Como-calcular-a-data-estimada-de-entrega-dos-meus-envios).
