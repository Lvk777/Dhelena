import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '@/api/apiClient';
import { passwordMessage } from '@/lib/supabaseAuthFlow';
import { useBoutiqueDialogs } from '@/components/BoutiqueDialogs';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
export default function ChangePassword() {
    const dialogs = useBoutiqueDialogs();
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [info, setInfo] = useState(null), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
    const [current, setCurrent] = useState(''), [nonce, setNonce] = useState(''), [needsNonce, setNeedsNonce] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    useEffect(() => { client.auth.securityInfo().then(setInfo).catch(() => setError('Não foi possível verificar sua conta. Tente novamente.')); }, []);
    const save = async event => {
        event.preventDefault(); if (busy) return;
        const invalid = passwordMessage(password) || (password !== repeat ? 'As senhas não coincidem.' : ''); if (invalid) return setError(invalid);
        setBusy(true); setError(''); setMessage('');
        try {
            if (!await dialogs.confirm({ title: 'Alterar senha', message: 'Confirma a atualização da senha desta conta?', confirmLabel: 'Atualizar senha' })) return;
            const result = await client.auth.changePassword({ newPassword: password, currentPassword: current, nonce });
            if (result.reauthentication_required) { setNeedsNonce(true); setError('Confirme sua identidade com o código de reautenticação antes de continuar.'); }
            else { setPassword(''); setRepeat(''); setCurrent(''); setNonce(''); setNeedsNonce(false); setMessage('Senha atualizada com sucesso.'); }
        } catch { setError('Não foi possível atualizar a senha. Confira os dados ou utilize a recuperação por e-mail.'); }
        finally { setBusy(false); }
    };
    const sendNonce = async () => { if (busy) return; setBusy(true); try { await client.auth.requestReauthentication(); setMessage('Reautenticação solicitada. Confira seu e-mail ou telefone cadastrado.'); } catch { setError('Não foi possível solicitar o código agora.'); } finally { setBusy(false); } };
    const endSessions = async () => {
        if (busy) return; setBusy(true);
        try {
            if (!await dialogs.confirm({ title: 'Encerrar sessões', message: 'Você sairá desta conta e as sessões Supabase serão encerradas. Confirma?', confirmLabel: 'Sair da conta' })) return;
            await logout(false); navigate('/login', { replace: true });
        } catch { setError('Não foi possível confirmar o encerramento remoto. O acesso local foi removido; entre novamente para tentar.'); }
        finally { setBusy(false); }
    };
    return <div><h1 className="font-heading text-3xl mb-6">Segurança da conta</h1><form onSubmit={save} className="bg-bone p-6 sm:p-8 max-w-lg space-y-5">
        {!info && !error && <p role="status">Verificando sua conta...</p>}
        {info && !info.password_provider && <p className="text-sm">Você utiliza Google. Uma senha adicional pode ser cadastrada se o Supabase confirmar sua identidade. Seu acesso Google será preservado.</p>}
        {info?.local_mode && <label className="block text-sm">Senha atual<input className="admin-field mt-2 w-full" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required /></label>}
        <label className="block text-sm">Nova senha<input className="admin-field mt-2 w-full" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} maxLength={128} /></label>
        <p className="text-sm">Use de 8 a 128 caracteres, com letras e números.</p>
        <label className="block text-sm">Confirme a nova senha<input className="admin-field mt-2 w-full" type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required /></label>
        {needsNonce && <><label className="block text-sm">Código de reautenticação<input className="admin-field mt-2 w-full" autoComplete="one-time-code" inputMode="numeric" value={nonce} onChange={e => setNonce(e.target.value)} required /></label><button type="button" className="btn-outline min-h-11" disabled={busy} onClick={sendNonce}>Solicitar código</button></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
        <button className="btn-gold min-h-11" disabled={busy || !info}>{busy ? 'Atualizando...' : 'Alterar senha'}</button><Link to="/esqueci-minha-senha" className="block text-sm underline">Recuperar acesso por e-mail</Link>
    </form><div className="max-w-lg mt-6 p-6 border border-border"><h2 className="font-heading text-xl mb-3">Sessões da conta</h2><p className="text-sm mb-4">O encerramento remove o acesso deste navegador e revoga a renovação das sessões no Supabase. Tokens já emitidos podem permanecer válidos até sua expiração.</p><button type="button" className="btn-outline min-h-11" disabled={busy} onClick={endSessions}>Encerrar sessões e sair</button></div></div>;
}
