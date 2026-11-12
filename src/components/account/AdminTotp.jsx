import React, { useEffect, useState } from 'react';
import { client } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';

export default function AdminTotp() {
    const { user, checkUserAuth } = useAuth();
    const [status, setStatus] = useState(null);
    const [pending, setPending] = useState(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (user?.role !== 'admin' || !client.auth.mfaStatus) return;
        client.auth.mfaStatus().then(setStatus).catch(() => setError('Não foi possível consultar o autenticador.'));
    }, [user?.role]);

    if (user?.role !== 'admin' || !client.auth.mfaStatus) return null;

    const enroll = async () => {
        setBusy(true); setError('');
        try { setPending(await client.auth.mfaEnroll()); setCode(''); }
        catch { setError('Não foi possível iniciar a inscrição. Tente novamente.'); }
        finally { setBusy(false); }
    };
    const verify = async event => {
        event.preventDefault();
        if (!/^\d{6}$/.test(code)) return setError('Informe os seis dígitos do aplicativo.');
        setBusy(true); setError('');
        try {
            const next = await client.auth.mfaVerify(pending?.factorId || status?.factorId, code);
            setPending(null); setCode(''); setStatus(next);
            await checkUserAuth();
        } catch { setError('Não foi possível confirmar o código. Verifique o relógio do dispositivo e tente novamente.'); }
        finally { setBusy(false); }
    };

    return <section className="max-w-lg mt-6 p-6 border border-border bg-background" aria-labelledby="admin-totp-title">
        <h2 id="admin-totp-title" className="font-heading text-xl mb-3">Proteção do painel administrativo</h2>
        {!status && !error && <p role="status" className="text-sm">Verificando o autenticador...</p>}
        {status?.enrolled && status.aal === 'aal2' && <p role="status" className="text-sm">Aplicativo autenticador confirmado nesta sessão.</p>}
        {status?.enrolled && status.aal !== 'aal2' && <p className="text-sm mb-4">Confirme o código do seu aplicativo autenticador para acessar o painel.</p>}
        {status && !status.enrolled && !pending && <>
            <p className="text-sm mb-4">Configure um aplicativo autenticador na sua própria conta. O acesso atual permanece disponível durante a preparação.</p>
            <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={enroll}>Configurar autenticador</button>
        </>}
        {pending && <div className="mt-4 space-y-3">
            <p className="text-sm">No aplicativo autenticador, escolha adicionar conta por chave manual. Digite a chave abaixo somente no seu dispositivo; não a envie a ninguém.</p>
            <code className="block overflow-x-auto rounded border border-border p-3 text-sm select-all" aria-label="Chave de configuração do autenticador">{pending.secret}</code>
        </div>}
        {(pending || status?.enrolled && status.aal !== 'aal2') && <form onSubmit={verify} className="mt-4 space-y-3">
            <label htmlFor="admin-totp-code" className="block text-sm">Código do aplicativo</label>
            <input id="admin-totp-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="admin-field w-full" required />
            <button type="submit" className="btn-gold min-h-11" disabled={busy || code.length !== 6}>Confirmar aplicativo</button>
        </form>}
        {error && <p role="alert" className="text-sm text-error-ink mt-3">{error}</p>}
    </section>;
}
