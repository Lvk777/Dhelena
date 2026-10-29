import React, { useEffect, useState } from 'react';
import AdminFormSection from '@/components/admin/AdminFormSection';
import AdminInput from '@/components/admin/AdminInput';
import AdminToggle from '@/components/admin/AdminToggle';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

export default function InstallmentsModule() {
    const [loaded, setLoaded] = useState(null), [config, setConfig] = useState(null);
    const [amount, setAmount] = useState('500.00'), [bin, setBin] = useState('');
    const [simulation, setSimulation] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [approval, setApproval] = useState(false), [homologated, setHomologated] = useState(false);
    const load = async () => { const result = await base44.functions.invoke('getInstallmentSettings'); setLoaded(result); setConfig(result.config); return result; };
    useEffect(() => { load().catch(() => setMessage('Não foi possível carregar as condições. Recarregue antes de editar.')); }, []);
    const update = (key, value) => { setConfig(c => ({ ...c, [key]: value })); setSimulation(null); setMessage(''); };
    const run = async kind => {
        setBusy(true); setMessage('');
        try {
            const args = { config, amount: Number(amount), bin, expected_version: loaded.version,
                commercial_approved: approval, financial_homologated: homologated };
            const result = await base44.functions.invoke(kind, args);
            if (kind === 'simulateInstallments') setSimulation(result);
            else { await load(); setSimulation(null); setMessage(kind === 'approveInstallments' ? 'Aprovação registrada; oferta continua desativada. Ative e salve separadamente.' : 'Condições salvas.'); }
        } catch (error) { setMessage(error.message || 'Operação indisponível.'); }
        finally { setBusy(false); }
    };
    if (!config) return <p role="status">{message || 'Carregando parcelamento...'}</p>;
    const dirty = JSON.stringify(config) !== JSON.stringify(loaded.config);
    return <AdminFormSection title="Parcelamento e Juros" description="Proposta comercial e consulta das condições reais do Mercado Pago. Esta seção possui salvamento próprio.">
        <div className="sm:col-span-2 space-y-3">
            <p className="text-sm">Ambiente: {loaded.environment}. {loaded.approved ? 'Aprovação registrada para esta condição e ambiente.' : 'Pendente de homologação e aprovação comercial explícita.'}</p>
            <AdminToggle label="Ativar parcelamento" checked={config.enabled} onChange={v => update('enabled', v)} description="Salvar ativação exige aprovação registrada e faixa confirmada pelo provedor. Preparar uma proposta não ativa a oferta." />
            <AdminToggle label="Permitir parcelas com juros" checked={config.allow_interest} onChange={v => update('allow_interest', v)} description="Somente os juros retornados pelo provedor, acima da faixa sem juros aprovada." />
        </div>
        <AdminInput label="Número máximo de parcelas" type="number" min={1} max={12} value={config.max_installments} onChange={v => update('max_installments', Number(v))} />
        <AdminInput label="Máximo sem juros para a cliente" type="number" min={1} max={config.max_installments} value={config.interest_free_installments} onChange={v => update('interest_free_installments', Number(v))} />
        <div><label htmlFor="installment-interest-payer" className="block text-xs mb-2">Responsabilidade pelo financiamento</label>
            <select id="installment-interest-payer" className="admin-field" value={config.interest_payer} onChange={e => update('interest_payer', e.target.value)}>
                <option value="buyer">Cliente acima da faixa sem juros</option><option value="seller">Boutique — cliente paga sem juros</option>
            </select><p className="text-xs mt-2 text-muted-foreground">A modalidade é configurada na conta Mercado Pago. Este controle não altera taxas na conta nem usa parâmetros do Point.</p></div>
        <AdminInput label="Valor mínimo por parcela (R$)" type="number" min={0} step={0.01} value={config.min_installment_amount} onChange={v => update('min_installment_amount', Number(v))} description="0 usa os limites e opções efetivamente retornados pelo provedor." />
        <AdminInput full label="Mensagem comercial na vitrine" value={config.commercial_message} onChange={v => update('commercial_message', v)} description="Somente após ativação aprovada. O site acrescenta a condição de disponibilidade do cartão; promessas acima dos limites são recusadas." />
        <div className="sm:col-span-2"><button type="button" className="btn-outline min-h-11" disabled={busy || (!dirty && loaded.exists)} onClick={() => run('saveInstallmentSettings')}>{busy ? 'Processando...' : 'Salvar condições de parcelamento'}</button></div>
        <AdminInput label="Valor da compra para simular (R$)" type="number" min={0.01} step={0.01} value={amount} onChange={v => { setAmount(v); setSimulation(null); }} />
        <AdminInput label="BIN de teste — primeiros 8 dígitos" value={bin} onChange={v => { setBin(v.replace(/\D/g, '').slice(0, 8)); setSimulation(null); }} description="Use apenas BIN de cartão oficial de teste. Não informe cartão completo, CVV ou token." />
        <div className="sm:col-span-2"><button type="button" className="btn-outline min-h-11" disabled={busy || !/^\d{8}$/.test(bin)} onClick={() => run('simulateInstallments')}>Simular sem criar pagamento</button></div>
        {simulation && <div className="sm:col-span-2 space-y-3">
            <p className="text-sm">Compra original: {formatBRL(simulation.original_amount)}. Consulta no ambiente {simulation.environment}; valores sujeitos à confirmação no checkout.</p>
            {simulation.unavailable_installments.length > 0 && <p role="status" className="text-sm text-warning-ink">Condições propostas não confirmadas em: {simulation.unavailable_installments.join(', ')}x. A ativação dessa faixa será bloqueada.</p>}
            <div className="overflow-x-auto"><table className="w-full text-xs"><caption className="text-left pb-2">Opções efetivamente retornadas pelo Mercado Pago</caption><thead><tr>{['Parcelas', 'Por parcela', 'Juros da cliente', 'Total da cliente', 'Na proposta'].map(label => <th scope="col" key={label} className="text-left p-2">{label}</th>)}</tr></thead>
                <tbody>{simulation.provider_options.map(o => <tr key={`${o.payment_method_id}-${o.issuer_id}-${o.installments}`}><td className="p-2">{o.installments}x</td><td>{formatBRL(o.installment_amount)}</td><td>{formatBRL(o.buyer_interest_amount)} ({o.buyer_interest_rate}%)</td><td>{formatBRL(o.buyer_total)}</td><td>{simulation.offers.some(v => v.installments === o.installments && v.issuer_id === o.issuer_id && v.payment_method_id === o.payment_method_id) ? 'Permitida' : 'Bloqueada'}</td></tr>)}</tbody></table></div>
            <p className="text-xs">Encargos de financiamento da boutique: Não disponível. Taxa de processamento: Não disponível. Líquido estimado: Não disponível. Depende das condições da conta. A diferença entre total e compra é juros da cliente; não é a taxa da boutique. Eventuais ajustes de centavos seguem o provedor.</p>
        </div>}
        <div className="sm:col-span-2 border-t pt-4 space-y-3">
            <p className="text-sm">Aprovação posterior à homologação: salve a proposta desativada e confirme a faixa no simulador. A prova vale para o cartão/valor consultado; o checkout valida cada oferta novamente.</p>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={approval} onChange={e => setApproval(e.target.checked)} />Confirmo aprovação comercial da Juliane para os custos desta condição.</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={homologated} onChange={e => setHomologated(e.target.checked)} />Confirmo homologação financeira desta condição no ambiente {loaded.environment}.</label>
            <button type="button" className="btn-outline min-h-11" disabled={busy || dirty || config.enabled || !approval || !homologated || !simulation || simulation.unavailable_installments.length > 0} onClick={() => run('approveInstallments')}>Registrar aprovação sem ativar</button>
            <p className="text-xs text-muted-foreground">Aprovação de TEST não libera produção. Mudanças da faixa ou responsabilidade exigem nova aprovação. Ajustes são feitos neste painel, sem editar código ou Railway.</p>
        </div>
        {message && <p role="alert" className="sm:col-span-2 text-sm">{message}</p>}
    </AdminFormSection>;
}
