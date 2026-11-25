import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

export default function OperationalRefund({ order, onChanged }) {
    const [reason,setReason]=useState(''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const [confirmed,setConfirmed]=useState(false),[key,setKey]=useState('');
    if(order.order_number!=='DH-2026-000019')return null;
    if(!order.snapshot?.payment_context||order.payment_status!=='approved')return <p className="text-xs text-muted-foreground">O estorno deste pedido exige um pagamento aprovado e vínculo confirmado com o Mercado Pago.</p>;
    const request={kind:'full',reason,selected_items:[]};
    const invalidate=()=>{setPreview(null);setConfirmed(false);setKey('');};
    const run=async submit=>{
        if(submit && !window.confirm('Confirmar o estorno REAL de R$ 39,98 do pedido DH-2026-000019? O dinheiro será devolvido à compradora.'))return;
        setBusy(true);setError('');
        try {
            if(submit){await base44.functions.invoke('operationalRefund',{orderId:order.id,idempotencyKey:key,request:{...request,confirmation:preview.confirmation,confirm:confirmed}});invalidate();onChanged?.();}
            else {const result=await base44.functions.invoke('operationalRefundPreview',{orderId:order.id,request});setPreview(result);setKey(crypto.randomUUID());setConfirmed(false);}
        }catch(e){setError(e.message||'Reembolso indisponível.');}finally{setBusy(false);}
    };
    return <div className="border border-border p-4 space-y-3 text-sm" aria-label="Reembolso operacional">
        <h3 className="font-medium">Estorno integral de homologação · pedido DH-2026-000019</h3>
        <p className="text-xs text-muted-foreground">Esta liberação é exclusiva deste pedido. Consulte a prévia e confira o valor e o ambiente antes de confirmar o estorno real.</p>
        <label className="block">Motivo<textarea aria-label="Motivo do reembolso" value={reason} maxLength={500} onChange={e=>{setReason(e.target.value);invalidate();}} className="block w-full admin-field p-3" /></label>
        <button disabled={busy||reason.trim().length<5} onClick={()=>run(false)} className="btn-outline text-xs">Consultar prévia sem reembolsar</button>
        {error&&<p role="alert" className="text-error-ink">{error}</p>}
        {preview&&<div className="space-y-2" role="status">
            <p>Ambiente: {preview.mode==='production'?'Produção':'TEST'}. Reembolso: {formatBRL(preview.amount_cents/100)}. Prévia válida por 5 minutos.</p>
            {preview.enabled?<><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Confirmo o motivo, os itens e o reembolso do valor apresentado.</label>
                <button disabled={busy||!confirmed} className="btn-outline text-xs" onClick={()=>run(true)}>Confirmar estorno real de {formatBRL(preview.amount_cents/100)}</button></>:<p>Execução desabilitada até homologação e autorização.</p>}
        </div>}
        <p className="text-xs text-muted-foreground">Resultado incerto exige consulta oficial. Não repita a solicitação. Reembolso não repõe estoque automaticamente.</p>
    </div>;
}
