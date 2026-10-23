import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { formatBRL } from '@/data/products';

export default function OperationalRefund({ order, onChanged }) {
    const [kind,setKind]=useState('full'),[reason,setReason]=useState(''),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const [item,setItem]=useState(''),[quantity,setQuantity]=useState(1),[confirmed,setConfirmed]=useState(false),[key,setKey]=useState('');
    if(!order.snapshot?.payment_context||!['approved','partially_refunded'].includes(order.payment_status))return null;
    const request={kind,reason,selected_items:kind==='partial'?[{order_item_id:item,quantity}]:[]};
    const invalidate=()=>{setPreview(null);setConfirmed(false);setKey('');};
    const run=async submit=>{
        setBusy(true);setError('');
        try {
            if(submit){await base44.functions.invoke('operationalRefund',{orderId:order.id,idempotencyKey:key,request:{...request,confirmation:preview.confirmation,confirm:confirmed}});invalidate();onChanged?.();}
            else {const result=await base44.functions.invoke('operationalRefundPreview',{orderId:order.id,request});setPreview(result);setKey(crypto.randomUUID());setConfirmed(false);}
        }catch(e){setError(e.message||'Reembolso indisponível.');}finally{setBusy(false);}
    };
    return <div className="border border-border p-4 space-y-3 text-sm" aria-label="Reembolso operacional">
        <h3 className="font-medium">Reembolso administrativo</h3>
        <select aria-label="Tipo de reembolso" value={kind} onChange={e=>{setKind(e.target.value);invalidate();}} className="border border-border bg-background p-3">
            <option value="full">Integral</option><option value="partial">Itens selecionados</option><option value="remaining">Saldo restante</option>
        </select>
        {kind==='partial'&&<div className="flex flex-wrap gap-2">
            <select aria-label="Peça a reembolsar" value={item} onChange={e=>{setItem(e.target.value);invalidate();}} className="border border-border bg-background p-3">
                <option value="">Selecione a peça</option>{(order.items||[]).map(i=><option key={i.id} value={i.id}>{i.product_name}</option>)}
            </select>
            <input aria-label="Quantidade a reembolsar" type="number" min="1" value={quantity} onChange={e=>{setQuantity(Number(e.target.value));invalidate();}} className="border border-border bg-background p-3 w-24" />
        </div>}
        <label className="block">Motivo<textarea aria-label="Motivo do reembolso" value={reason} maxLength={500} onChange={e=>{setReason(e.target.value);invalidate();}} className="block w-full border border-border bg-background p-3" /></label>
        <button disabled={busy||reason.trim().length<5} onClick={()=>run(false)} className="btn-outline text-xs">Consultar prévia sem reembolsar</button>
        {error&&<p role="alert" className="text-red-700">{error}</p>}
        {preview&&<div className="space-y-2" role="status">
            <p>Ambiente: {preview.mode==='production'?'Produção':'TEST'}. Reembolso: {formatBRL(preview.amount_cents/100)}. Prévia válida por 5 minutos.</p>
            {preview.enabled?<><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Confirmo o motivo, os itens e o reembolso do valor apresentado.</label>
                <button disabled={busy||!confirmed} className="btn-outline text-xs" onClick={()=>run(true)}>Confirmar reembolso</button></>:<p>Execução desabilitada até homologação e autorização.</p>}
        </div>}
        <p className="text-xs text-muted-foreground">Resultado incerto exige consulta oficial. Não repita a solicitação. Reembolso não repõe estoque automaticamente.</p>
    </div>;
}
