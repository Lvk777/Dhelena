import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { client } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import PasswordInput from '@/components/PasswordInput';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export default function AdminEmailVerification() {
    const navigate = useNavigate();
    const location = useLocation();
    const { checkUserAuth } = useAuth();
    const [status, setStatus] = useState(null);
    const [bootstrap, setBootstrap] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [code, setCode] = useState('');
    const [pending, setPending] = useState(false);
    const [sent, setSent] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        client.auth.adminStepUpStatus().then(value => { if (active) setStatus(value); })
            .catch(() => { if (active) setError('Verificação administrativa indisponível.'); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!cooldown) return undefined;
        const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    async function submit(event) {
        event.preventDefault(); setError(''); setPending(true);
        try {
            if (!status?.enrolled) {
                await client.auth.adminStepUpSetup(bootstrap, passphrase);
                setBootstrap(''); setPassphrase(''); setStatus({ enrolled: true, verified: false });
                setError('Senha administrativa definida. Confirme-a para receber o código.');
            } else if (!sent) {
                const result = await client.auth.adminStepUpStart(passphrase);
                setPassphrase(''); setSent(true); setCooldown(result.resend_after || 60);
            } else {
                await client.auth.adminStepUpVerify(code);
                setCode('');
                await checkUserAuth();
                const destination = location.state?.from;
                navigate(typeof destination === 'string' && destination.startsWith('/admin') ? destination : '/admin', { replace: true });
            }
        } catch (failure) { setError(failure.message || 'Não foi possível concluir a verificação.'); }
        finally { setPending(false); }
    }

    return <main className="mx-auto max-w-lg px-5 py-10 text-foreground">
        <h1 className="font-display text-3xl">Verificação administrativa</h1>
        <p className="mt-3 text-sm text-muted-foreground">Sua conta comum continua acessível. Para entrar no painel, confirme a senha administrativa independente e o código enviado ao endereço aprovado para esta conta.</p>
        {error && <p role="alert" className="mt-4 text-sm text-error-ink">{error}</p>}
        {status && <form onSubmit={submit} className="mt-6 space-y-5">
            {!status.enrolled && <>
                <p className="text-sm">A primeira configuração exige a chave de ativação entregue pessoalmente pelo responsável da loja.</p>
                <label className="block text-sm" htmlFor="admin-bootstrap">Chave de ativação</label>
                <PasswordInput id="admin-bootstrap" autoComplete="off" value={bootstrap} onChange={event => setBootstrap(event.target.value)} required
                    className="w-full border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus:border-[hsl(var(--gold))]" />
            </>}
            {!sent && <>
                <label className="block text-sm" htmlFor="admin-passphrase">Senha administrativa</label>
                <PasswordInput id="admin-passphrase" autoComplete={status.enrolled ? 'current-password' : 'new-password'} value={passphrase}
                    onChange={event => setPassphrase(event.target.value)} minLength={16} maxLength={72} required
                    className="w-full border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus:border-[hsl(var(--gold))]" />
                {!status.enrolled && <p className="text-xs text-muted-foreground">Use ao menos 16 caracteres. Esta senha não é sua senha de login.</p>}
            </>}
            {sent && <>
                <label className="block text-sm" htmlFor="admin-email-code">Código de seis dígitos</label>
                <InputOTP id="admin-email-code" maxLength={6} pattern="^[0-9]*$" inputMode="numeric" autoComplete="one-time-code"
                    value={code} onChange={setCode} aria-label="Código administrativo de seis dígitos" containerClassName="justify-center">
                    <InputOTPGroup>{Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index}
                        className="h-12 w-11 bg-background text-foreground border-border" />)}</InputOTPGroup>
                </InputOTP>
                <button type="button" disabled={pending || cooldown > 0} onClick={() => { setSent(false); setCode(''); }}
                    className="min-h-11 text-sm text-rose-ink disabled:opacity-50">{cooldown ? `Novo código em ${cooldown}s` : 'Solicitar novo código'}</button>
            </>}
            <button type="submit" disabled={pending || sent && code.length !== 6} className="btn-gold w-full">
                {pending ? 'Aguarde...' : !status.enrolled ? 'Definir senha administrativa' : sent ? 'Confirmar código' : 'Receber código'}</button>
        </form>}
    </main>;
}
