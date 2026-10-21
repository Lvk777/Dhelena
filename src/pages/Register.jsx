import React, { useId, useState } from "react";
import { Link } from "react-router-dom";
import { client } from "@/api/apiClient";
import { Loader2, Mail, Lock, UserPlus, User, Eye, EyeOff } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleSignIn from "@/components/GoogleSignIn";
import { safeReturnTo } from "@/lib/authReturnTo";
import { validateEmail } from "@/lib/forms";
import { track } from "@/lib/analytics";
import { passwordMessage } from '@/lib/supabaseAuthFlow';

export default function Register() {
    const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
    const [error, setError] = useState("");
    const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showOtp, setShowOtp] = useState(false);
    const [registrationComplete, setRegistrationComplete] = useState(false);
    const [otpCode, setOtpCode] = useState("");

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const returnTo = safeReturnTo();

    const completeProfile = async () => {
        await client.auth.updateMe({ full_name: form.name });
        window.location.href = returnTo === '/' ? '/minha-conta' : returnTo;
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        const e2 = /** @type {Record<string, string>} */ ({});
        if (!form.name.trim()) e2.name = "Informe seu nome completo";
        if (!validateEmail(form.email)) e2.email = "Informe um e-mail válido";
        if (passwordMessage(form.password)) e2.password = passwordMessage(form.password);
        if (form.password !== form.confirm) e2.confirm = "As senhas não coincidem";
        setErrors(e2);
        if (Object.keys(e2).length > 0) return;
        setLoading(true);
        try {
            if (registrationComplete) { await completeProfile(); return; }
            const registration = await client.auth.register({ email: form.email, password: form.password, full_name: form.name });
            track('sign_up');
            if (registration?.pending_verification) {
                setShowOtp(true);
            } else {
                setRegistrationComplete(true);
                await completeProfile();
            }
        } catch (err) {
            setError(err.message || "Falha no cadastro");
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async () => {
        if (loading) return;
        setError("");
        setLoading(true);
        try {
            const result = await client.auth.verifyOtp({ email: form.email, otpCode });
            if (result?.access_token) {
                client.auth.setToken(result.access_token);
                setRegistrationComplete(true);
                await completeProfile();
            } else { throw new Error("Confirmação sem sessão válida. Faça login para concluir seu cadastro."); }
        } catch (err) {
            setError(err.message || "Código inválido");
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        if (loading) return;
        setLoading(true);
        setError("");
        try {
            await client.auth.resendOtp(form.email);
        } catch (err) {
            setError(err.message || "Erro ao reenviar código");
        } finally { setLoading(false); }
    };

    const handleGoogle = async () => {
        setLoading(true); setError('');
        try { await client.auth.loginWithProvider("google", returnTo === '/' ? '/minha-conta' : returnTo); }
        catch { setError('Não foi possível entrar com Google. Tente novamente ou cadastre-se com e-mail e senha.'); }
        finally { setLoading(false); }
    };

    if (showOtp && !registrationComplete) {
        return (
            <AuthLayout
                title="Verifique seu e-mail"
                subtitle={`Confira as instruções de confirmação em ${form.email}`}
            >
                {error && <div className="mb-4 p-3 bg-[hsl(var(--rose))]/10 text-[hsl(var(--rose))] text-sm text-center">{error}</div>}
                <p className="text-sm mb-5">Abra o link de confirmação enviado pelo Supabase. Depois, complete seus dados na área da cliente. Se o e-mail contiver um código, você também pode informá-lo abaixo.</p>
                <label className="block text-sm mb-6">Código de confirmação<input className="admin-field block mt-2 w-full" autoComplete="one-time-code" inputMode="numeric" maxLength={10} value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))} /></label>
                <button onClick={handleVerify} disabled={loading || otpCode.length < 6} className="btn-gold w-full">
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : "Verificar"}
                </button>
                <p className="text-center text-sm text-muted-foreground mt-4">
                    Não recebeu?{" "}
                    <button disabled={loading} onClick={handleResend} className="text-[hsl(var(--rose))] min-h-11 font-medium hover:underline">Reenviar instruções</button>
                </p>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout
            title="Criar sua conta"
            subtitle="Junte-se à comunidade D'Helenas"
            footer={
                <>
                    Já tem conta?{" "}
                    <Link to={"/login" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")} className="text-[hsl(var(--rose))] font-medium hover:underline">
                        Entrar
                    </Link>
                </>
            }
        >
            <GoogleSignIn loading={loading} onClick={handleGoogle} />

            <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em]">
                    <span className="bg-[hsl(var(--bone))] px-3 text-muted-foreground">ou</span>
                </div>
            </div>

            {error && <div className="mb-4 p-3 bg-[hsl(var(--rose))]/10 text-[hsl(var(--rose))] text-sm text-center">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
                <Field icon={User} label="Nome completo" value={form.name} onChange={(v) => set("name", v)} required error={errors.name} />
                <Field icon={Mail} label="E-mail" type="email" value={form.email} onChange={(v) => set("email", v)} required error={errors.email} />
                <p className="text-xs text-muted-foreground">Telefone e CPF serão solicitados apenas se você fizer um pedido.</p>
                <Field icon={Lock} label="Senha" type="password" visible={showPassword} onToggleVisibility={() => setShowPassword((v) => !v)} value={form.password} onChange={(v) => set("password", v)} required error={errors.password} />
                <Field icon={Lock} label="Confirmar senha" type="password" visible={showConfirm} onToggleVisibility={() => setShowConfirm((v) => !v)} value={form.confirm} onChange={(v) => set("confirm", v)} required error={errors.confirm} />
                <button type="submit" disabled={loading} className="btn-gold w-full">
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : <><UserPlus className="w-4 h-4" strokeWidth={1.5} /> {registrationComplete ? "Concluir meus dados" : "Criar conta"}</>}
                </button>
            </form>
        </AuthLayout>
    );
}

function Field({ icon: Icon, label, value, onChange, type = "text", required = false, error = "", max = undefined, visible = false, onToggleVisibility = undefined }) {
    const id = useId();
    return (
        <div>
            <label htmlFor={id} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                    id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
                    type={type === "password" && visible ? "text" : type}
                    autoComplete={type === "password" ? "new-password" : undefined}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required={required}
                    max={max}
                    className={`w-full border bg-background pl-10 ${type === "password" ? "pr-12" : "pr-4"} py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${error ? "border-[hsl(var(--rose))]" : "border-border"}`}
                />
                {type === "password" && onToggleVisibility && (
                    <button type="button" onClick={onToggleVisibility} aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`} aria-pressed={visible} title={visible ? "Ocultar senha" : "Mostrar senha"} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--gold))]">
                        {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                    </button>
                )}
            </div>
            {error && <p id={`${id}-error`} role="alert" className="text-[11px] text-destructive mt-1.5">{error}</p>}
        </div>
    );
}
