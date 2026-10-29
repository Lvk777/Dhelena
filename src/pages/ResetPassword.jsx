import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { client } from '@/api/apiClient';
import { passwordMessage } from '@/lib/supabaseAuthFlow';
import AuthLayout from '@/components/AuthLayout';
import PasswordInput from '@/components/PasswordInput';
export default function ResetPassword() {
    const [params] = useSearchParams();
    const [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
    const ready = client.auth.recoveryReady();
    const save = async event => {
        event.preventDefault(); if (busy) return;
        const invalid = passwordMessage(password) || (password !== repeat ? 'As senhas não coincidem.' : '');
        if (invalid) return setError(invalid);
        setBusy(true); setError('');
        try { await client.auth.resetPassword({ resetToken: params.get('token'), newPassword: password }); setPassword(''); setRepeat(''); setDone(true); }
        catch { setError('Não foi possível redefinir a senha. O link pode ter expirado ou já ter sido utilizado. Solicite outro link.'); }
        finally { setBusy(false); }
    };
    return <AuthLayout title={done ? 'Senha atualizada' : ready ? 'Crie sua nova senha' : 'Link inválido ou expirado'} subtitle="Sua conta D’Helenas">
        {done ? <><p role="status" className="text-sm mb-5">Sua senha foi atualizada. Entre novamente com a nova senha.</p><Link className="btn-gold w-full" to="/login">Entrar</Link></>
            : !ready ? <><p role="alert" className="text-sm mb-5">Abra um link válido de recuperação. Um link já utilizado não pode ser reutilizado.</p><Link className="btn-gold w-full" to="/esqueci-minha-senha">Solicitar outro link</Link></>
                : <form onSubmit={save} className="space-y-5">
                    <p className="text-sm">Use de 8 a 128 caracteres, com letras e números.</p>
                    <div><label htmlFor="reset-password" className="block text-sm">Nova senha</label><PasswordInput id="reset-password" name="new-password" visibilityLabel="nova senha" className="admin-field w-full mt-2" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} maxLength={128} /></div>
                    <div><label htmlFor="reset-password-confirm" className="block text-sm">Confirme a nova senha</label><PasswordInput id="reset-password-confirm" name="confirm-password" visibilityLabel="confirmação da nova senha" className="admin-field w-full mt-2" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required /></div>
                    {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
                    <button className="btn-gold w-full min-h-11" disabled={busy}>{busy ? 'Atualizando...' : 'Atualizar senha'}</button>
                </form>}
    </AuthLayout>;
}
