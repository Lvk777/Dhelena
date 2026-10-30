import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '@/components/AuthLayout';
import { client } from '@/api/apiClient';
import { authEmail } from '@/lib/supabaseAuthFlow';

export default function ResendConfirmation() {
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        if (!authEmail(email)) { setError('Informe um e-mail válido.'); return; }
        setBusy(true); setError('');
        try {
            await client.auth.resendOtp(email.trim().toLowerCase());
            setSent(true);
        } catch {
            setError('Não foi possível solicitar agora. Tente novamente em instantes ou entre na sua conta.');
        } finally { setBusy(false); }
    };

    return <AuthLayout title="Confirmar cadastro" subtitle="D’Helenas — acesso à sua conta">
        {sent ? <p role="status" className="text-sm leading-relaxed">Se houver um cadastro pendente para este e-mail, enviaremos uma nova confirmação. Confira sua caixa de entrada.</p>
            : <form onSubmit={submit} className="space-y-5">
                <div><label htmlFor="confirmation-email" className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">E-mail do cadastro</label>
                    <input id="confirmation-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="admin-field min-h-11" /></div>
                {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
                <button type="submit" className="btn-gold w-full min-h-11" disabled={busy}>{busy ? 'Solicitando...' : 'Reenviar confirmação'}</button>
            </form>}
        <Link to="/login" className="block mt-5 text-sm text-center underline">Já confirmou? Entrar</Link>
    </AuthLayout>;
}
