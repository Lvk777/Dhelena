import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { client } from "@/api/apiClient";
import { Loader2, Mail, Lock, LogIn } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import PasswordInput from "@/components/PasswordInput";
import GoogleSignIn from "@/components/GoogleSignIn";
import { safeReturnTo } from "@/lib/authReturnTo";
import { track } from "@/lib/analytics";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { isSupabaseConfigured } from "@/api/supabaseClient";

const emailOtpAvailable = isSupabaseConfigured && import.meta.env.VITE_EMAIL_OTP_LOGIN_ENABLED === 'true';

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [pendingCode, setPendingCode] = useState(false);
    const [pendingEmailOtp, setPendingEmailOtp] = useState(false);
    const [code, setCode] = useState('');
    const [resendSeconds, setResendSeconds] = useState(0);
    const returnTo = safeReturnTo();
    const adminDestination = returnTo === '/admin' || returnTo.startsWith('/admin/');
    const [useEmailOtp, setUseEmailOtp] = useState(emailOtpAvailable && !adminDestination);
    const showingCode = pendingCode || pendingEmailOtp;

    useEffect(() => {
        if (!resendSeconds) return undefined;
        const timer = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [resendSeconds]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const result = await client.auth.loginViaEmailPassword(email, password, returnTo);
            if (result.pending_code) {
                setPassword(''); setPendingCode(true); setResendSeconds(result.resend_after || 60);
                return;
            }
            track('login');
            window.location.href = returnTo === '/' ? '/minha-conta' : returnTo;
        } catch (err) {
            setError(err.message || "E-mail ou senha inválidos");
        } finally {
            setLoading(false);
        }
    };

    const requestEmailOtp = async (event) => {
        event?.preventDefault(); setError(''); setLoading(true);
        try {
            const result = await client.auth.requestEmailOtp(email);
            setPendingEmailOtp(true); setCode(''); setResendSeconds(result.resend_after || 60);
        } catch (err) { setError(err.message || 'Não foi possível solicitar o código.'); }
        finally { setLoading(false); }
    };

    const verifyCode = async (event) => {
        event.preventDefault(); setError(''); setLoading(true);
        try {
            if (pendingEmailOtp) await client.auth.verifyEmailOtp(email, code);
            else await client.auth.verifyLoginCode(code);
            track('login');
            window.location.href = returnTo === '/' ? '/minha-conta' : returnTo;
        } catch (err) { setError(err.message || 'Não foi possível verificar o código.'); }
        finally { setLoading(false); }
    };

    const resendCode = async () => {
        setError(''); setLoading(true);
        try { const result = pendingEmailOtp ? await client.auth.requestEmailOtp(email) : await client.auth.resendLoginCode();
            setCode(''); setResendSeconds(result.resend_after || 60); }
        catch (err) { setError(err.message || 'Não foi possível reenviar o código.'); }
        finally { setLoading(false); }
    };

    const backToLogin = async () => {
        setLoading(true);
        try { if (pendingCode) await client.auth.logout(); }
        catch { /* Local state is cleared by logout even if Supabase is unavailable. */ }
        finally { setPendingCode(false); setPendingEmailOtp(false); setCode(''); setError(''); setLoading(false); }
    };

    const handleGoogle = async () => {
        setLoading(true); setError('');
        try { await client.auth.loginWithProvider("google", returnTo === '/' ? '/minha-conta' : returnTo); }
        catch { setError('Não foi possível entrar com Google. Tente novamente.'); }
        finally { setLoading(false); }
    };

    return (
        <AuthLayout
            title={showingCode ? 'Verifique seu e-mail' : 'Bem-vinda de volta'}
            subtitle={pendingEmailOtp ? 'Se esta conta existir, enviaremos um código de 6 dígitos.'
                : pendingCode ? 'Enviamos um código de 6 dígitos para o e-mail cadastrado.' : "Entre na sua conta D'Helenas"}
            footer={
                <>
                    Ainda não tem conta?{" "}
                    <Link
                        to={"/cadastro" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
                        className="text-rose-ink font-medium hover:underline"
                    >
                        Criar conta
                    </Link>
                </>
            }
        >
            {!showingCode && <GoogleSignIn loading={loading} onClick={handleGoogle} />}

            {!showingCode && <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em]">
                    <span className="bg-[hsl(var(--bone))] px-3 text-muted-foreground">ou</span>
                </div>
            </div>}

            {error && (
                <div role="alert" className="mb-4 p-3 bg-[hsl(var(--rose))]/10 text-error-ink text-sm text-center">
                    {error}
                </div>
            )}

            {showingCode ? <form onSubmit={verifyCode} className="space-y-5">
                <label htmlFor="login-code" className="block text-sm text-foreground">Código de acesso</label>
                <InputOTP id="login-code" maxLength={6} pattern="^[0-9]*$" inputMode="numeric" autoComplete="one-time-code"
                    value={code} onChange={setCode} aria-label="Código de acesso de seis dígitos" disabled={loading}
                    containerClassName="justify-center">
                    <InputOTPGroup>{Array.from({ length: 6 }, (_, index) =>
                        <InputOTPSlot key={index} index={index} className="h-12 w-11 bg-background text-foreground border-border" />)}</InputOTPGroup>
                </InputOTP>
                <button type="submit" disabled={loading || code.length !== 6} className="btn-gold w-full">{loading ? 'Verificando...' : 'Verificar código'}</button>
                <button type="button" disabled={loading || resendSeconds > 0} onClick={resendCode} className="w-full min-h-11 text-rose-ink disabled:opacity-50">
                    {resendSeconds > 0 ? `Reenviar código em ${resendSeconds}s` : 'Reenviar código'}
                </button>
                <button type="button" disabled={loading} onClick={backToLogin} className="w-full min-h-11 text-muted-foreground">Voltar ao login</button>
            </form> : useEmailOtp ? <form onSubmit={requestEmailOtp} className="space-y-4">
                <label htmlFor="login-otp-email" className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground">E-mail</label>
                <input id="login-otp-email" type="email" autoComplete="email" autoFocus required value={email}
                    onChange={event => setEmail(event.target.value)} placeholder="seu@email.com"
                    className="w-full border border-border bg-background px-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors" />
                <button type="submit" disabled={loading} className="btn-gold w-full">
                    {loading ? 'Solicitando...' : 'Receber código por e-mail'}
                </button>
                <p className="text-xs text-muted-foreground text-center">O código substitui a senha neste modo de entrada.</p>
            </form> : <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="login-email" className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">E-mail</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            id="login-email" type="email"
                            autoComplete="email"
                            autoFocus
                            placeholder="seu@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full border border-border bg-background pl-10 pr-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors"
                            required
                        />
                    </div>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="login-password" className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Senha</label>
                        <Link to="/esqueci-minha-senha" className="text-xs text-rose-ink hover:underline">
                            Esqueci minha senha
                        </Link>
                    </div>
                    <PasswordInput
                        id="login-password" name="password" leadingIcon={Lock}
                        autoComplete="current-password" placeholder="••••••••"
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        className="w-full border border-border bg-background pl-10 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors"
                        required
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    className="btn-gold w-full"
                >
                    {loading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Entrando...</>
                    ) : (
                        <><LogIn className="w-4 h-4" strokeWidth={1.5} /> Entrar</>
                    )}
                </button>
            </form>}
            {emailOtpAvailable && !showingCode && <button type="button" disabled={loading}
                onClick={() => { setUseEmailOtp(value => !value); setError(''); }}
                className="mt-5 w-full min-h-11 text-sm text-rose-ink hover:underline">
                {useEmailOtp ? 'Entrar com senha' : 'Entrar com código por e-mail'}
            </button>}

        </AuthLayout>
    );
}
