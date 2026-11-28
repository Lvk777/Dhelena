// Dados publicados pelo Melhor Envio para identificação da transportadora na NF-e:
// https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220428174356-Como-preencher-os-dados-da-etiqueta-de-frete
// Os Correios não têm IE nessa lista; a IE abaixo consta no artigo do próprio Melhor Envio:
// https://melhorenvio.com.br/blog/frete-e-logistica/nota-fiscal-e-declaracao-de-conteudo/
const CARRIERS = [
    { match: /correios|empresa brasileira de correios/, name: 'Correios', legalName: 'EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS', cnpj: '34.028.316/0001-03', ie: '073.338.210.0116' },
    { match: /jadlog/, name: 'Jadlog', legalName: 'JADLOG LOGISTICA S.A', cnpj: '04.884.082/0001-35', ie: '149.744.148.111' },
    { match: /loggi|l4b logistica/, name: 'Loggi', legalName: 'L4B Logística LTDA', cnpj: '24.217.653/0001-95', ie: '140.538.606.113' },
    { match: /j\s*&\s*t|j\s*e\s*t express/, name: 'J&T Express', legalName: 'J&T EXPRESS BRAZIL LTDA.', cnpj: '42.584.754/0001-86', ie: '133.512.711.118' },
    { match: /total express|tex courier/, name: 'Total Express', legalName: 'TEX COURIER S.A', cnpj: '73.939.449/0001-93', ie: '206.214.714.111' },
    { match: /buslog|metar logistica/, name: 'Buslog', legalName: 'METAR LOGISTICA LTDA.', cnpj: '10.992.167/0001-30', ie: '148.694.458.111' },
    { match: /azul cargo|azul linhas aereas/, name: 'Azul Cargo Express', legalName: 'AZUL LINHAS AEREAS BRASILEIRAS S.A.', cnpj: '09.296.295/0001-60', ie: '206.265.026.118' },
    { match: /latam|tam linhas aereas/, name: 'LATAM Cargo', legalName: 'TAM LINHAS AEREAS S/A', cnpj: '02.012.862/0001-60', ie: '112.347.127.116' },
];

export function carrierFiscalData(carrier) {
    const normalized = String(carrier || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return normalized ? CARRIERS.find(({ match }) => match.test(normalized)) || null : null;
}
