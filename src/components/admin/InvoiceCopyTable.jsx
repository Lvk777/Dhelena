import React, { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { formatBRL } from '@/data/products';
import { carrierFiscalData } from '@/lib/carrierFiscalData';

const available = (value) => value === null || value === undefined ? '' : String(value).trim();
const money = (value) => value === null || value === undefined || value === '' ? '' : formatBRL(Number(value));
const fiscalAmount = (value) => {
    if (value === null || value === undefined || value === '') return ['', ''];
    const number = Number(value);
    return Number.isFinite(number) ? [money(number), number.toFixed(2).replace('.', ',')] : ['', ''];
};
const lineSubtotal = (item) => {
    if (item.subtotal !== null && item.subtotal !== undefined) return item.subtotal;
    const unit = item.unit_price ?? item.price;
    const quantity = item.quantity ?? item.qty;
    return unit === null || unit === undefined || quantity === null || quantity === undefined ? '' : Number(unit) * Number(quantity);
};

export function invoiceCopyGroups(order) {
    const customer = order?.snapshot?.customer || {};
    const address = order?.shipping_address || order?.snapshot?.shipping_address || {};
    const items = order?.items?.length ? order.items : order?.snapshot?.items || [];
    const shippingCarrier = order?.shipping_carrier || order?.snapshot?.shipping_carrier;
    const shippingService = order?.shipping_service_name || order?.snapshot?.shipping_service_name;
    const carrier = order?.shipping_method === 'melhor_envio' ? carrierFiscalData(shippingCarrier) : null;

    return [
        {
            title: 'Dados da cliente', rows: [
                ['Nome completo', customer.name],
                ['CPF', customer.cpf],
                ['E-mail', customer.email],
                ['Telefone', customer.phone],
            ],
        },
        {
            title: 'Endereço de entrega', rows: [
                ['Logradouro', address.street],
                ['Número', address.number],
                ['Complemento', address.complement],
                ['Bairro', address.district],
                ['Cidade', address.city],
                ['UF', address.state],
                ['CEP', address.cep || address.postal_code],
            ],
        },
        ...(order?.shipping_method === 'melhor_envio' ? [{
            title: 'Transportadora selecionada no checkout', rows: [
                ['Transportadora', shippingCarrier],
                ['Serviço contratado', shippingService],
                ['Razão social', carrier?.legalName],
                ['CNPJ do transportador', carrier?.cnpj],
                ['Inscrição estadual do transportador', carrier?.ie],
            ],
        }] : []),
        ...items.map((item, index) => ({
            title: `Produto ${index + 1}`, rows: [
                ['Descrição cadastrada', item.product_name || item.name],
                ['SKU interno (referência)', item.product_sku || item.sku],
                ['Cor cadastrada', item.color_name],
                ['Tamanho', item.size],
                ['Quantidade', item.quantity ?? item.qty],
                ['Valor unitário', ...fiscalAmount(item.unit_price ?? item.price)],
                ['Subtotal do item', ...fiscalAmount(lineSubtotal(item))],
            ],
        })),
        {
            title: 'Valores do pedido', rows: [
                ['Número do pedido (referência)', order?.order_number],
                ['Subtotal de mercadorias', ...fiscalAmount(order?.subtotal)],
                ['Desconto', ...fiscalAmount(order?.discount)],
                ['Frete', ...fiscalAmount(order?.shipping_cost)],
                ['Total do pedido', ...fiscalAmount(order?.total)],
            ],
        },
    ];
}

export default function InvoiceCopyTable({ order }) {
    const [expanded, setExpanded] = useState(true);
    const [copied, setCopied] = useState('');
    const [copyError, setCopyError] = useState('');
    const shippingCarrier = order?.shipping_carrier || order?.snapshot?.shipping_carrier;
    const unrecognizedCarrier = order?.shipping_method === 'melhor_envio' && !carrierFiscalData(shippingCarrier);

    const copy = async (value, key, label) => {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(value);
            setCopied(key);
            setCopyError('');
        } catch {
            setCopied('');
            setCopyError(`Não foi possível copiar ${label}. Selecione o valor para copiar manualmente.`);
        }
    };

    return <details className="bg-background text-foreground group" open={expanded}
        onToggle={event => setExpanded(event.currentTarget.open)} aria-label="Dados para emissão da nota fiscal">
        <summary className="min-h-11 p-5 flex items-center justify-between gap-3 cursor-pointer list-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[hsl(var(--gold))] [&::-webkit-details-marker]:hidden">
            <h2 className="text-[11px] uppercase tracking-[0.18em] font-medium flex items-center gap-2">
                <FileText className="w-4 h-4" /> Dados para emissão da NF-e
            </h2>
            <span aria-hidden="true" className="text-xl leading-none group-open:rotate-45 transition-transform">+</span>
        </summary>
        <div className="border-t border-border p-5 space-y-4 min-w-0 [overflow-wrap:anywhere]">
            <p className="text-xs text-muted-foreground">Clique no valor de cada campo para copiá-lo. Os dados vêm do pedido e não emitem nem alteram a nota fiscal. Valores monetários são copiados sem o símbolo R$.</p>
            {order?.shipping_method === 'melhor_envio' && <p className="text-xs text-muted-foreground">Os dados cadastrais da transportadora são referências publicadas pelo Melhor Envio. Confira CNPJ e inscrição estadual no emissor antes de autorizar a NF-e; o Melhor Envio é intermediador, não transportador.</p>}
            {unrecognizedCarrier && <p role="alert" className="border border-amber-500/60 bg-amber-500/10 p-3 text-xs">Não foi possível identificar com segurança a transportadora deste pedido. Confira o serviço selecionado no Melhor Envio antes de preencher o CNPJ na NF-e.</p>}

        {invoiceCopyGroups(order).map((group, groupIndex) => <div key={group.title}>
            <h3 className="text-xs font-semibold mb-2">{group.title}</h3>
            <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
                <tbody>
                    {group.rows.map(([label, raw, rawCopy], rowIndex) => {
                        const value = available(raw);
                        const copyValue = available(rawCopy ?? raw);
                        const key = `${groupIndex}:${rowIndex}`;
                        return <tr key={key} className="border-t border-border">
                            <th scope="row" className="text-left align-top py-2 pr-3 font-normal text-muted-foreground w-[43%] break-words">{label}</th>
                            <td className="py-1.5 align-top break-all">
                                {value ? <button type="button" onClick={() => copy(copyValue, key, label)}
                                    className="w-full min-h-8 flex items-start justify-between gap-2 text-left rounded-sm p-1 hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--gold))]"
                                    aria-label={`Copiar ${label}: ${value}`} title={`Copiar ${label}`}>
                                    <span className="break-words [overflow-wrap:anywhere]">{value}</span>
                                    {copied === key ? <Check className="w-4 h-4 shrink-0 text-green-600" aria-hidden="true" />
                                        : <Copy className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                                </button> : <span className="block py-1 text-muted-foreground">—</span>}
                            </td>
                        </tr>;
                    })}
                </tbody>
            </table>
        </div>)}

        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {copyError || (copied ? 'Valor copiado. Agora você pode colá-lo no emissor da NF-e.' : 'A descrição fiscal, NCM, CFOP e outros dados tributários devem ser conferidos no emissor. O SKU interno não substitui o código fiscal.')}
        </p>
        </div>
    </details>;
}
