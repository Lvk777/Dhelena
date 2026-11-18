import { useState } from 'react';
import { base44 } from '@/api/base44Client';

const emptyItem = () => ({ code: '', name: '', quantity: '1', productValue: '' });
const initial = () => ({ key: '', number: '', series: '', issuedAt: '', protocol: '',
    issuerCnpj: '', issuerName: '', recipientDocument: '', recipientName: '',
    productValue: '', shippingValue: '0', totalValue: '', discountValue: '0',
    insuranceValue: '0', otherValue: '0', taxesValue: '0', desonerationValue: '0', items: [emptyItem()] });
const fields = [
    ['key', 'Chave de acesso (44 dígitos)', 'text'], ['number', 'Número da NF-e', 'text'],
    ['series', 'Série', 'text'], ['issuedAt', 'Data e hora de emissão', 'datetime-local'],
    ['protocol', 'Protocolo de autorização (15 dígitos)', 'text'],
    ['issuerCnpj', 'CNPJ do emitente', 'text'], ['issuerName', 'Nome do emitente', 'text'],
    ['recipientDocument', 'CPF ou CNPJ do destinatário', 'text'],
    ['recipientName', 'Nome do destinatário', 'text'],
];
const amounts = [
    ['productValue', 'Valor das mercadorias'], ['shippingValue', 'Frete'], ['totalValue', 'Total da NF-e'],
    ['discountValue', 'Desconto'], ['insuranceValue', 'Seguro'], ['otherValue', 'Outras despesas'],
    ['taxesValue', 'Tributos adicionais'], ['desonerationValue', 'Desoneração'],
];

function Input({ label, value, onChange, type = 'text', inputMode = undefined, required = true }) {
    return <label className="block text-sm min-w-0">{label}
        <input required={required} type={type} inputMode={inputMode} value={value} onChange={event => onChange(event.target.value)}
            className="admin-field mt-1 block w-full min-w-0 min-h-11 p-2" />
    </label>;
}

export default function ManualFiscalForm({ orderId, onSaved, onCancel }) {
    const [data, setData] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const field = (key, value) => setData(current => ({ ...current, [key]: value }));
    const itemField = (index, key, value) => setData(current => ({ ...current,
        items: current.items.map((item, position) => position === index ? { ...item, [key]: value } : item) }));
    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try { onSaved(await base44.functions.invoke('recordManualFiscalDocument', { orderId, data })); }
        catch (cause) { setError(cause.message || 'Não foi possível cadastrar a NF-e. Confira os dados.'); }
        finally { setBusy(false); }
    };
    return <form onSubmit={submit} className="border border-border p-4 space-y-4" aria-label="Preencher NF-e manualmente">
        <p className="text-sm">Transcreva os dados do documento emitido. Este cadastro não emite nota nem comprova autorização. A chave só será usada após comparação com o pedido e conferência no portal oficial.</p>
        {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
            {fields.map(([key, label, type]) => <Input key={key} label={label} type={type}
                inputMode={['key', 'number', 'series', 'protocol', 'issuerCnpj', 'recipientDocument'].includes(key) ? 'numeric' : undefined}
                value={data[key]} onChange={value => field(key, value)} />)}
        </div>
        <div className="space-y-3">
            <h3 className="font-medium text-sm">Itens da NF-e</h3>
            {data.items.map((item, index) => <div key={index} className="border border-border p-3 grid sm:grid-cols-2 gap-3">
                <p className="sm:col-span-2 text-sm font-medium">Item {index + 1}</p>
                <Input label="Código do produto" required={false} value={item.code} onChange={value => itemField(index, 'code', value)} />
                <Input label="Descrição" value={item.name} onChange={value => itemField(index, 'name', value)} />
                <Input label="Quantidade" type="number" value={item.quantity} onChange={value => itemField(index, 'quantity', value)} />
                <Input label="Valor total do item (R$)" inputMode="decimal" value={item.productValue} onChange={value => itemField(index, 'productValue', value)} />
                {data.items.length > 1 && <button type="button" className="btn-outline text-xs min-h-11" onClick={() => setData(current => ({ ...current,
                    items: current.items.filter((_, position) => position !== index) }))}>Remover item {index + 1}</button>}
            </div>)}
            <button type="button" className="btn-outline text-xs min-h-11" disabled={data.items.length >= 100}
                onClick={() => setData(current => ({ ...current, items: [...current.items, emptyItem()] }))}>Adicionar item</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
            {amounts.map(([key, label]) => <Input key={key} label={`${label} (R$)`} inputMode="decimal"
                value={data[key]} onChange={value => field(key, value)} />)}
        </div>
        <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-outline text-xs min-h-11" disabled={busy}>{busy ? 'Conferindo...' : 'Cadastrar dados para conferência'}</button>
            <button type="button" className="btn-outline text-xs min-h-11" disabled={busy} onClick={onCancel}>Cancelar</button>
        </div>
    </form>;
}
