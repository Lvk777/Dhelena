import React, { useEffect, useState } from 'react';
import { client } from '@/api/apiClient';
import { useBoutiqueDialogs } from '@/components/BoutiqueDialogs';
export default function AdminAccess() {
    const dialogs = useBoutiqueDialogs();
    const [data,setData]=useState(null), [target,setTarget]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
    const load=async()=>{try{setData(await client.custom.readAdminAccess());}catch{setError('Não foi possível verificar os acessos.');}};
    useEffect(()=>{load();},[]);
    const change=async(id,grant)=>{
        if(busy)return;setBusy(true);setError('');
        try{if(!await dialogs.confirm({title:grant?'Autorizar colaborador':'Revogar acesso',message:grant?'A conta escolhida receberá acesso ao painel administrativo. Confirma?':'A conta escolhida perderá acesso ao painel. Seus pedidos e dados pessoais serão preservados.'}))return;
            await client.custom.changeAdminAccess(id,grant);setTarget('');await load();
        }catch(failure){setError(failure.message||'Não foi possível alterar o acesso.');}finally{setBusy(false);}
    };
    return <div><h1 className="font-heading text-3xl mb-6">Colaboradores autorizados</h1>{error&&<p role="alert" className="text-destructive mb-4">{error}</p>}
        {!data&&!error&&<p role="status">Verificando permissões...</p>}
        {data&&!data.can_manage&&<p className="text-sm">Este gerenciamento exige a autoridade comprovada da proprietária e a configuração segura de acessos. Nenhuma permissão será alterada por esta página enquanto essas condições não forem atendidas.</p>}
        {data?.can_manage&&<><form onSubmit={e=>{e.preventDefault();change(target,true);}} className="space-y-3 mb-6"><label className="block">Identificador da conta autorizada<input className="admin-field block mt-2 w-full max-w-lg" value={target} onChange={e=>setTarget(e.target.value)} required pattern="[a-fA-F0-9-]{36}" /></label><button className="btn-gold min-h-11" disabled={busy}>Autorizar colaborador</button></form>
            {data.collaborators.map(c=><div key={c.id} className="border border-border p-4 mb-3 flex flex-wrap justify-between gap-3"><span>{c.full_name||c.email} · {c.authority==='owner'?'Proprietária':c.role==='admin'?'Acesso autorizado':'Acesso revogado'}</span>{c.authority!=='owner'&&<button className="btn-outline min-h-11" disabled={busy} onClick={()=>change(c.id,c.role!=='admin')}>{c.role==='admin'?'Revogar acesso':'Autorizar acesso'}</button>}</div>)}</>}
    </div>;
}
