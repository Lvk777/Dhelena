import { XMLParser, XMLValidator } from 'fast-xml-parser';

const digits = value => String(value ?? '').replace(/\D/g, '');
const money = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Valor fiscal inválido no XML.');
    return Math.round(number * 100);
};
const text = value => String(value ?? '').trim();
const asArray = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const sameMoney = (a, b) => a === Math.round(Number(b) * 100);

export function validNfeKey(key) {
    if (!/^\d{44}$/.test(key) || key.slice(20, 22) !== '55') return false;
    let sum = 0, weight = 2;
    for (let i = 42; i >= 0; i -= 1) {
        sum += Number(key[i]) * weight;
        weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return Number(key[43]) === (remainder < 2 ? 0 : 11 - remainder);
}

export function parseManualNfe(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Preencha os dados da NF-e.');
    const key = text(input.key);
    const number = text(input.number), series = text(input.series);
    const issuedAt = text(input.issuedAt), protocol = text(input.protocol);
    const issueParts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?$/.exec(issuedAt);
    const issueDate = issueParts && new Date(Date.UTC(Number(issueParts[1]), Number(issueParts[2]) - 1,
        Number(issueParts[3]), Number(issueParts[4]), Number(issueParts[5]), Number(issueParts[6] || 0)));
    const validIssueDate = !!issueParts && issueDate.getUTCFullYear() === Number(issueParts[1])
        && issueDate.getUTCMonth() + 1 === Number(issueParts[2]) && issueDate.getUTCDate() === Number(issueParts[3])
        && issueDate.getUTCHours() === Number(issueParts[4]) && issueDate.getUTCMinutes() === Number(issueParts[5]);
    const issuerCnpj = digits(input.issuerCnpj), recipientDocument = digits(input.recipientDocument);
    const issuerName = text(input.issuerName), recipientName = text(input.recipientName);
    if (!validNfeKey(key) || !/^\d{1,9}$/.test(number) || !/^\d{1,3}$/.test(series)
        || number !== String(Number(key.slice(25, 34))) || series.padStart(3, '0') !== key.slice(22, 25)
        || !validIssueDate
        || issuedAt.slice(2, 4) + issuedAt.slice(5, 7) !== key.slice(2, 6)
        || !/^\d{15}$/.test(protocol) || issuerCnpj !== key.slice(6, 20)
        || issuerName.length < 3 || issuerName.length > 200 || recipientName.length < 3 || recipientName.length > 200
        || ![11, 14].includes(recipientDocument.length)) {
        throw new Error('Chave, modelo 55, número, série, emissão, protocolo ou participantes incoerentes.');
    }
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
        throw new Error('Informe de 1 a 100 itens da NF-e.');
    }
    const amount = (value, label) => {
        const raw = String(value ?? '');
        if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(raw)) throw new Error(`Valor inválido: ${label}.`);
        return Math.round(Number(raw.replace(',', '.')) * 100);
    };
    const items = input.items.map((item, index) => {
        const name = text(item?.name), code = text(item?.code), quantity = Number(item?.quantity);
        if (name.length < 2 || name.length > 200 || code.length > 60
            || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
            throw new Error(`Item ${index + 1} inválido.`);
        }
        const productCents = amount(item.productValue, `item ${index + 1}`);
        if (productCents <= 0) throw new Error(`Valor do item ${index + 1} deve ser positivo.`);
        return { code, name, quantity, productCents, unitCents: Math.round(productCents / quantity) };
    });
    const productCents = amount(input.productValue, 'mercadorias');
    const shippingCents = amount(input.shippingValue, 'frete');
    const totalCents = amount(input.totalValue, 'total');
    const discountCents = amount(input.discountValue ?? '0', 'desconto');
    const insuranceCents = amount(input.insuranceValue ?? '0', 'seguro');
    const otherCents = amount(input.otherValue ?? '0', 'outras despesas');
    const taxesCents = amount(input.taxesValue ?? '0', 'tributos adicionais');
    const desonerationCents = amount(input.desonerationValue ?? '0', 'desoneração');
    if (items.reduce((sum, item) => sum + item.productCents, 0) !== productCents
        || Math.abs(productCents + shippingCents + insuranceCents + otherCents + taxesCents
            - discountCents - desonerationCents - totalCents) > 1) {
        throw new Error('Os valores manuais não fecham com os itens e o total da NF-e.');
    }
    return { key, model: '55', number, series, issuedAt, protocol, authorizedAt: null,
        issuerCnpj, issuerName, recipientDocument, recipientName, items,
        productCents, shippingCents, discountCents, totalCents,
        insuranceCents, otherCents, taxesCents, desonerationCents };
}

export function parseAuthorizedNfe(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 1024 * 1024) throw new Error('Selecione um XML de NF-e de até 1 MB.');
    const xml = buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml) || xml.includes('\uFFFD')) throw new Error('XML fiscal inválido ou inseguro.');
    const valid = XMLValidator.validate(xml);
    if (valid !== true) throw new Error('Estrutura XML inválida.');
    const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false,
        parseTagValue: false, parseAttributeValue: false, trimValues: true }).parse(xml);
    const proc = parsed.nfeProc;
    const nfe = proc?.NFe?.infNFe;
    const prot = proc?.protNFe?.infProt;
    if (!proc || !nfe || !prot) {
        throw new Error('O arquivo não é o XML fiscal autorizado da NF-e. Solicite o XML original no emissor/NFF ou à contabilidade. Converter um DANFE em PDF para XML não funciona.');
    }
    const key = text(nfe?.['@_Id']).replace(/^NFe/, '');
    if (!validNfeKey(key) || text(prot.chNFe) !== key
        || text(prot.cStat) !== '100' || !/^\d{15}$/.test(text(prot.nProt))
        || text(nfe.ide?.mod) !== '55' || text(nfe.ide?.tpAmb) !== '1'
        || text(nfe.ide?.nNF) !== String(Number(key.slice(25, 34)))
        || String(nfe.ide?.serie).padStart(3, '0') !== key.slice(22, 25)
        || text(nfe.ide?.cUF).padStart(2, '0') !== key.slice(0, 2)
        || text(nfe.ide?.tpEmis) !== key.slice(34, 35)
        || text(nfe.ide?.cNF).padStart(8, '0') !== key.slice(35, 43)
        || text(nfe.ide?.dhEmi || nfe.ide?.dEmi).slice(2, 4) + text(nfe.ide?.dhEmi || nfe.ide?.dEmi).slice(5, 7) !== key.slice(2, 6)
        || digits(nfe.emit?.CNPJ) !== key.slice(6, 20)
        || !text(prot.dhRecbto) || !text(nfe.ide?.dhEmi || nfe.ide?.dEmi)
        || !nfe.total?.ICMSTot || !asArray(nfe.det).length || !proc.NFe.Signature) {
        throw new Error('O XML não contém NF-e modelo 55 de produção e protocolo de autorização coerentes.');
    }
    const total = nfe.total.ICMSTot;
    const items = asArray(nfe.det).map(entry => ({
        code: text(entry.prod?.cProd), name: text(entry.prod?.xProd),
        quantity: Number(entry.prod?.qCom), unitCents: money(entry.prod?.vUnCom),
        productCents: money(entry.prod?.vProd),
    }));
    if (items.some(item => !item.name || !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new Error('Produtos fiscais inválidos.');
    const productCents = money(total.vProd), shippingCents = money(total.vFrete || 0);
    const discountCents = money(total.vDesc || 0), totalCents = money(total.vNF);
    const insuranceCents = money(total.vSeg || 0), otherCents = money(total.vOutro || 0);
    const taxesCents = ['vST', 'vFCPST', 'vII', 'vIPI', 'vIPIDevol'].reduce((sum, field) => sum + money(total[field] || 0), 0);
    const desonerationCents = money(total.vICMSDeson || 0);
    if (items.reduce((sum, item) => sum + item.productCents, 0) !== productCents
        || Math.abs(productCents + shippingCents + insuranceCents + otherCents + taxesCents - discountCents - desonerationCents - totalCents) > 1) {
        throw new Error('Totais fiscais incoerentes no XML.');
    }
    return {
        key, model: '55', number: text(nfe.ide.nNF), series: text(nfe.ide.serie),
        issuedAt: text(nfe.ide.dhEmi || nfe.ide.dEmi), protocol: text(prot.nProt),
        authorizedAt: text(prot.dhRecbto), issuerCnpj: digits(nfe.emit.CNPJ),
        issuerName: text(nfe.emit.xNome), recipientDocument: digits(nfe.dest?.CPF || nfe.dest?.CNPJ),
        recipientName: text(nfe.dest?.xNome), items,
        productCents, shippingCents, discountCents, totalCents, insuranceCents, otherCents, taxesCents,
    };
}

const words = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const sameWords = (a, b) => words(a).length > 0 && words(a).join(' ') === words(b).join(' ');
const startsWithWords = (whole, prefix) => prefix.length > 0 && prefix.every((word, index) => whole[index] === word);
const productBaseWords = row => {
    let base = words(row.product_name);
    for (const suffix of [words(row.size), words(row.color_name)]) {
        if (suffix.length && base.slice(-suffix.length).join(' ') === suffix.join(' ')) base = base.slice(0, -suffix.length);
    }
    return base;
};
const moneyBR = cents => (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function assessNfe(nfe, order, orderItems, senderDocument, review = {}) {
    const issues = [];
    const add = (code, message) => issues.push({ code, message });
    const customer = order.snapshot?.customer || {};
    const sameRecipientDocument = !!nfe.recipientDocument && nfe.recipientDocument === digits(customer.cpf || customer.cnpj);
    if (digits(senderDocument).length !== 14 || nfe.issuerCnpj !== digits(senderDocument))
        add('issuer', 'CNPJ do emitente: a nota não corresponde ao CNPJ configurado para a loja. Confira o cadastro fiscal antes de prosseguir.');
    if (!sameRecipientDocument)
        add('recipient_document', 'Documento da cliente: o CPF ou CNPJ da nota difere do pedido. Confira a identidade; a expedição permanece bloqueada.');
    const orderName = words(customer.name), fiscalName = words(nfe.recipientName);
    const abbreviatedName = sameRecipientDocument && orderName.length >= 2 && fiscalName.length > orderName.length
        && startsWithWords(fiscalName, orderName);
    if (!sameWords(customer.name, nfe.recipientName) && !(abbreviatedName && review.recipientConfirmed)) {
        add('recipient_name', abbreviatedName
            ? `Nome da cliente: o pedido apresenta “${text(customer.name)}” e a nota “${text(nfe.recipientName)}”. O documento coincide; confirme a abreviação com evidência. A expedição permanece bloqueada.`
            : `Nome da cliente: o pedido apresenta “${text(customer.name)}” e a nota “${text(nfe.recipientName)}”. Confira a identidade; a expedição permanece bloqueada.`);
    }
    if (nfe.items.length !== orderItems.length)
        add('item_count', `Quantidade de linhas: o pedido tem ${orderItems.length} e a nota tem ${nfe.items.length}. Confira os produtos; a expedição permanece bloqueada.`);
    const remaining = [...orderItems];
    const unmatched = [];
    for (const [fiscalIndex, item] of nfe.items.entries()) {
        const index = remaining.findIndex(row => {
            const name = words(item.name), base = productBaseWords(row), size = words(row.size), color = words(row.color_name);
            const full = [...base, ...color, ...size];
            const exactDescription = sameWords(item.name, row.product_name) && !row.color_name && !row.size;
            const variantMatches = startsWithWords(name, base) && name.join(' ') === full.join(' ');
            return (exactDescription || variantMatches) && (!item.code || !row.product_sku || sameWords(item.code, row.product_sku));
        });
        if (index < 0) { unmatched.push({ item, fiscalIndex }); continue; }
        const [matched] = remaining.splice(index, 1);
        if (Number(matched.quantity) !== item.quantity)
            add('quantity', `Quantidade de “${text(matched.product_name)}”: pedido ${matched.quantity}, nota ${item.quantity}. Confira os itens; a expedição permanece bloqueada.`);
        if (!sameMoney(item.productCents, matched.subtotal))
            add('item_value', `Valor de “${text(matched.product_name)}”: pedido ${moneyBR(Number(matched.subtotal) * 100)}, nota ${moneyBR(item.productCents)}. Confira os itens; a expedição permanece bloqueada.`);
    }
    let productCandidate = null;
    if (unmatched.length === 1 && remaining.length === 1) {
        const { item, fiscalIndex } = unmatched[0], row = remaining[0];
        const fiscalWords = words(item.name), base = productBaseWords(row), size = words(row.size);
        const sameBase = startsWithWords(fiscalWords, base);
        const sameSize = size.length > 0 && fiscalWords.slice(-size.length).join(' ') === size.join(' ');
        const fiscalColor = sameBase ? fiscalWords.slice(base.length, -size.length).join(' ') : '';
        if (sameSize && !!row.color_name && Number(row.quantity) === item.quantity
            && sameMoney(item.productCents, row.subtotal) && row.id) {
            productCandidate = { orderItemId: row.id, fiscalIndex, fiscalCode: item.code,
                orderSku: row.product_sku || '', orderColor: row.color_name || '', fiscalColor,
                productName: row.product_name, fiscalName: item.name, size: row.size || '',
                quantity: item.quantity, productCents: item.productCents, sameBase };
        }
    }
    if (unmatched.length || remaining.length) {
        if (productCandidate && review.productConfirmed === true
            && review.orderItemId === productCandidate.orderItemId
            && review.fiscalIndex === productCandidate.fiscalIndex) {
            // A specific, audited administrator decision can only resolve this one candidate.
        } else if (productCandidate) {
            add('product_identity', `Produto “${text(productCandidate.productName)}”, tamanho ${text(productCandidate.size)}: o pedido registra cor ${text(productCandidate.orderColor)} e SKU ${text(productCandidate.orderSku) || 'não informado'}; a nota descreve “${text(productCandidate.fiscalName)}” com código ${text(productCandidate.fiscalCode) || 'não informado'}. Confira se são a mesma mercadoria e variante; a expedição permanece bloqueada.`);
        } else add('product_identity', 'Produto da nota sem correspondência segura no pedido. Confira nome, código, variante, tamanho, quantidade e valor; a expedição permanece bloqueada.');
    }
    if (!sameMoney(nfe.productCents, order.subtotal)) add('subtotal', `Mercadorias: pedido ${moneyBR(Number(order.subtotal) * 100)}, nota ${moneyBR(nfe.productCents)}. Confira os valores; a expedição permanece bloqueada.`);
    if (!sameMoney(nfe.shippingCents, order.shipping_cost)) add('shipping', `Frete: pedido ${moneyBR(Number(order.shipping_cost) * 100)}, nota ${moneyBR(nfe.shippingCents)}. Confira os valores; a expedição permanece bloqueada.`);
    if (!sameMoney(nfe.discountCents, order.discount)) add('discount', 'Desconto: os valores do pedido e da nota diferem. Confira os totais; a expedição permanece bloqueada.');
    if (!sameMoney(nfe.totalCents, order.total)) add('total', `Total: pedido ${moneyBR(Number(order.total) * 100)}, nota ${moneyBR(nfe.totalCents)}. Confira os valores; a expedição permanece bloqueada.`);
    if (nfe.insuranceCents !== 0 || nfe.otherCents !== 0 || nfe.taxesCents !== 0)
        add('additional_charges', 'A nota contém seguro, outras despesas ou tributos adicionais que o pedido não discrimina. Confira os valores; a expedição permanece bloqueada.');
    return { issues, abbreviatedName, productCandidate };
}

export function reconcileNfe(nfe, order, orderItems, senderDocument, review) {
    return assessNfe(nfe, order, orderItems, senderDocument, review).issues.map(issue => issue.message);
}
