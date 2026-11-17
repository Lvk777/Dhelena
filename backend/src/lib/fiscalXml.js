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
    const key = text(nfe?.['@_Id']).replace(/^NFe/, '');
    if (!proc || !nfe || !prot || !validNfeKey(key) || text(prot.chNFe) !== key
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

export function reconcileNfe(nfe, order, orderItems, senderDocument) {
    const differences = [];
    const add = (condition, label) => { if (!condition) differences.push(label); };
    const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    add(digits(senderDocument).length === 14 && nfe.issuerCnpj === digits(senderDocument), 'CNPJ emitente');
    add(nfe.recipientDocument && nfe.recipientDocument === digits(order.snapshot?.customer?.cpf), 'Documento do destinatário');
    add(normalize(nfe.recipientName) && normalize(nfe.recipientName) === normalize(order.snapshot?.customer?.name), 'Nome do destinatário');
    add(nfe.items.length === orderItems.length, 'Quantidade de linhas de produto');
    const remaining = [...orderItems];
    for (const item of nfe.items) {
        const index = remaining.findIndex(row => {
            const orderNames = [row.product_name,
                [row.product_name, row.color_name].filter(Boolean).join(' '),
                [row.product_name, row.color_name, row.size].filter(Boolean).join(' ')];
            return normalize(item.code) && normalize(row.product_sku) === normalize(item.code)
                || orderNames.some(name => normalize(name) === normalize(item.name));
        });
        if (index < 0) { differences.push('Identificação dos produtos'); continue; }
        const [matched] = remaining.splice(index, 1);
        add(Number(matched.quantity) === item.quantity, 'Quantidade dos produtos');
        add(sameMoney(item.productCents, matched.subtotal), 'Valor dos produtos');
    }
    add(!remaining.length, 'Produtos do pedido');
    add(sameMoney(nfe.productCents, order.subtotal), 'Subtotal das mercadorias');
    add(sameMoney(nfe.shippingCents, order.shipping_cost), 'Frete');
    add(sameMoney(nfe.discountCents, order.discount), 'Desconto');
    add(sameMoney(nfe.totalCents, order.total), 'Total');
    add(nfe.insuranceCents === 0 && nfe.otherCents === 0 && nfe.taxesCents === 0, 'Outras despesas, seguro ou tributos adicionais');
    return [...new Set(differences)];
}
