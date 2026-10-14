import React, { useEffect, useState } from 'react';
import { client } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { useBoutiqueDialogs } from '@/components/BoutiqueDialogs';
import AdminModal from '@/components/admin/AdminModal';
import { authEmail } from '@/lib/supabaseAuthFlow';
export default function EmailChange() {
    const { checkUserAuth } = useAuth(); const dialogs = useBoutiqueDialogs();
    const [info, setInfo] = useState(null), [open, setOpen] = useState(false), [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const load = async () => { try { setInfo(await client.auth.securityInfo()); } catch { setError('Não foi possível verificar seu e-mail. Tente novamente.'); } };
    useEffect(() => { load(); }, []);
    const submit = async event => {
        event.preventDefault(); if (busy) return;
        if (!authEmail(email) || email.trim().toLowerCase() === info?.email?.toLowerCase()) return setError('Informe um novo e-mail válido.');
        setBusy(true);
        try {
            if (!await dialogs.confirm({ title: 'Alterar e-mail', message: 'Será necessária a confirmação indicada pelo Supabase no e-mail atual e/ou no novo endereço. Seu cadastro só será atualizado após a confirmação real.' })) return;
            const result = await client.auth.changeEmail(email); setInfo(result);
            setMessage(result.pending ? 'Aguardando confirmação. Confira as instruções recebidas nos e-mails atual e novo.' : 'Solicitação processada. Confira seu e-mail confirmado.');
            await checkUserAuth(); setOpen(false); setEmail('');
        } catch (failure) { setError(failure.message || 'Não foi possível solicitar a alteração.'); }
        finally { setBusy(false); }
    };
    return <section className="border-t border-border pt-5 mt-5">
        {info?.pending_email && <p role="status" className="text-sm mb-4">Aguardando confirmação da alteração para {info.pending_email}. O endereço atual continua válido até a confirmação.</p>}
        {info && !info.email_change_supported && <p className="text-sm mb-4">O vínculo seguro desta conta precisa ser concluído antes de alterar seu e-mail.</p>}
        {message && <p role="status" className="text-sm mb-4">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive mb-4">{error}</p>}
        <div className="flex flex-wrap gap-3"><button className="btn-outline min-h-11" disabled={!info?.email_change_supported} onClick={() => { setError(''); setOpen(true); }}>Alterar e-mail</button><button className="btn-ghost min-h-11" onClick={async () => { await load(); await checkUserAuth(); }}>Verificar confirmação</button></div>
        <AdminModal open={open} onClose={() => setOpen(false)} title="Alterar e-mail" busy={busy}>
            <form onSubmit={submit} className="space-y-4"><label className="block text-sm">Novo e-mail<input className="admin-field mt-2 w-full" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} /></label>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<p className="text-sm">A edição pode ser cancelada antes do envio. Depois da solicitação, siga as instruções de confirmação; não presumimos que o provedor permita cancelar uma solicitação pendente.</p>
                <button className="btn-gold min-h-11" disabled={busy}>{busy ? 'Solicitando...' : 'Solicitar alteração'}</button>
            </form>
        </AdminModal>
    </section>;
}
