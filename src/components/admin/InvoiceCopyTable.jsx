import React, { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { formatBRL } from '@/data/products';

const available = (value) => value === null || value === undefined ? '' : String(value).trim();
const money = (value) => value === null || value === undefined || value === '' ? '' : formatBRL(Number(value));
const lineSubtotal = (item) => {
    if (item.subtotal !== null && item.subtotal !== undefined) return money(item.subtotal);
    const unit = item.unit_price ?? item.price;
    const quantity = item.quantity ?? item.qty;
    return unit === null || unit === undefined || quantity === null || quantity === undefined ? '' : money(Number(unit) * Number(quantity));
};

export function invoiceCopyGroups(order) {
    const customer = order?.snapshot?.customer || {};
    const address = order?.shipping_address || order?.snapshot?.shipping_address || {};
    const items = order?.items?.length ? order.items : order?.snapshot?.items || [];

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
        ...items.map((item, index) => ({
            title: `Produto ${index + 1}`, rows: [
                ['Descrição cadastrada', item.product_name || item.name],
                ['SKU interno (referência)', item.product_sku || item.sku],
                ['Cor cadastrada', item.color_name],
                ['Tamanho', item.size],
                ['Quantidade', item.quantity ?? item.qty],
                ['Valor unitário', money(item.unit_price ?? item.price)],
                ['Subtotal do item', lineSubtotal(item)],
            ],
        })),
        {
            title: 'Valores do pedido', rows: [
                ['Número do pedido (referência)', order?.order_number],
                ['Subtotal de mercadorias', money(order?.subtotal)],
                ['Desconto', money(order?.discount)],
                ['Frete', money(order?.shipping_cost)],
                ['Total do pedido', money(order?.total)],
            ],
        },
    ];
}

export default function InvoiceCopyTable({ order }) {
    const [copied, setCopied] = useState('');
    const [copyError, setCopyError] = useState('');

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

    return <section className="bg-background text-foreground p-5 space-y-4" aria-label="Dados para emissão da nota fiscal">
        <div>
            <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground flex items-center gap-2">
                <FileText className="w-4 h-4" /> Dados para emissão da NF-e
            </h2>
            <p className="text-xs text-muted-foreground mt-2">Clique no valor de cada campo para copiá-lo. Os dados vêm do pedido e não emitem nem alteram a nota fiscal.</p>
        </div>

        {invoiceCopyGroups(order).map((group, groupIndex) => <div key={group.title}>
            <h3 className="text-xs font-semibold mb-2">{group.title}</h3>
            <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
                <tbody>
                    {group.rows.map(([label, raw], rowIndex) => {
                        const value = available(raw);
                        const key = `${groupIndex}:${rowIndex}`;
                        return <tr key={key} className="border-t border-border">
                            <th scope="row" className="text-left align-top py-2 pr-3 font-normal text-muted-foreground w-[43%] break-words">{label}</th>
                            <td className="py-1.5 align-top break-all">
                                {value ? <button type="button" onClick={() => copy(value, key, label)}
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
    </section>;
}
