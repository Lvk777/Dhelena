import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { userFacingError } from '@/lib/userFacingError';

export default function NffVariantMappings({ productId, productName, colors, sizes }) {
    const [mappings, setMappings] = useState([]);
    const [colorId, setColorId] = useState('');
    const [size, setSize] = useState('');
    const [code, setCode] = useState('');
    const [description, setDescription] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    useEffect(() => {
        if (!productId) return;
        let active = true;
        base44.functions.invoke('getNffVariantMappings', { productId })
            .then(rows => { if (active) setMappings(rows); })
            .catch(cause => { if (active) setError(userFacingError(cause, '/fiscal/mappings')); });
        return () => { active = false; };
    }, [productId]);
    if (!productId) return <p className="text-sm text-muted-foreground">Salve o produto e abra-o novamente para relacionar suas variantes ao NFF.</p>;
    const save = async () => {
        if (busy || !confirmed || !colorId || !size || !code.trim() || !description.trim()) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const mapping = { color_id: colorId, size, code: code.trim(), description: description.trim(),
                expected_color_name: colors.find(color => color.id === colorId)?.name,
                expected_product_name: productName, confirmed_match: true };
            await base44.functions.invoke('saveNffVariantMapping', { productId, mapping });
            setMappings(await base44.functions.invoke('getNffVariantMappings', { productId }));
            setCode(''); setDescription(''); setConfirmed(false);
            setMessage('Correspondência registrada. Ela será usada apenas quando código, descrição, variante, quantidade e valor coincidirem.');
        } catch (cause) { setError(userFacingError(cause, '/fiscal/mappings')); }
        finally { setBusy(false); }
    };
    return <section className="border border-border p-4 space-y-3 text-sm" aria-label="Identificadores NFF das variantes">
        <h3 className="font-medium">Identificadores usados no NFF</h3>
        <p>Cadastre o código e a descrição exatamente como aparecem no NFF. Confira pessoalmente que representam a mesma mercadoria, cor e tamanho da loja. Salve alterações do produto antes deste registro. O registro fica na auditoria e não altera notas existentes.</p>
        {mappings.length > 0 && <ul className="space-y-1" aria-label="Correspondências cadastradas">{mappings.map((entry, index) => <li key={`${entry.code}-${entry.color_id}-${entry.size}-${index}`} className="break-words">
            {colors.find(color => color.id === entry.color_id)?.name || entry.color_id} · {entry.size} → {entry.code} · {entry.description}
        </li>)}</ul>}
        <div className="grid gap-3 sm:grid-cols-2">
            <label>Cor da loja<select className="admin-field block w-full p-2 mt-1" value={colorId} onChange={event => setColorId(event.target.value)}><option value="">Selecione a cor</option>{colors.map(color => <option key={color.id} value={color.id}>{color.name}</option>)}</select></label>
            <label>Tamanho<select className="admin-field block w-full p-2 mt-1" value={size} onChange={event => setSize(event.target.value)}><option value="">Selecione o tamanho</option>{sizes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Código no NFF<input className="admin-field block w-full p-2 mt-1" value={code} maxLength={60} onChange={event => setCode(event.target.value)} /></label>
            <label>Descrição no NFF<input className="admin-field block w-full p-2 mt-1" value={description} maxLength={255} onChange={event => setDescription(event.target.value)} /></label>
        </div>
        <label className="flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Conferi no NFF e confirmo que estes identificadores representam a mesma mercadoria e variante cadastrada.</label>
        {error && <p role="alert" className="text-error-ink">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button type="button" className="btn-outline min-h-11" disabled={busy || !confirmed || !colorId || !size || !code.trim() || !description.trim()} onClick={save}>{busy ? 'Salvando...' : 'Salvar correspondência NFF'}</button>
    </section>;
}
