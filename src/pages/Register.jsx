import React, { useState } from "react";
import { Link } from "react-router-dom";
import { client } from "@/api/apiClient";
import { Loader2, Mail, Lock, UserPlus, User, Phone, Calendar } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { safeReturnTo } from "@/lib/authReturnTo";
import { validateCPF, validateEmail, validatePhone, maskCPF, maskPhone } from "@/lib/forms";
import { track } from "@/lib/analytics";

export default function Register() {
    const [form, setForm] = useState({ name: "", email: "", phone: "", cpf: "", birthDate: "", password: "", confirm: "" });
    const [error, setError] = useState("");
    const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
    const [loading, setLoading] = useState(false);
    const [showOtp, setShowOtp] = useState(false);
    const [otpCode, setOtpCode] = useState("");

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const returnTo = safeReturnTo();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        const e2 = /** @type {Record<string, string>} */ ({});
        if (!form.name.trim()) e2.name = "Informe seu nome completo";
        if (!validateEmail(form.email)) e2.email = "Informe um e-mail válido";
        if (!validatePhone(form.phone)) e2.phone = "Informe seu telefone";
        if (!validateCPF(form.cpf)) e2.cpf = "CPF inválido";
        if (form.password.length < 6) e2.password = "Mínimo de 6 caracteres";
        if (form.password !== form.confirm) e2.confirm = "As senhas não coincidem";
        setErrors(e2);
        if (Object.keys(e2).length > 0) return;
        setLoading(true);
        try {
            const registration = await client.auth.register({ email: form.email, password: form.password, full_name: form.name });
            track('sign_up');
            if (registration?.pending_verification) {
                setShowOtp(true);
            } else {
                try {
                    await client.auth.updateMe({
                        phone: form.phone,
                        cpf: form.cpf,
                        birth_date: form.birthDate,
                    });
                } catch (profileError) { console.error("Profile save error:", profileError); }
                window.location.href = returnTo;
            }
        } catch (err) {
            setError(err.message || "Falha no cadastro");
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async () => {
        setError("");
        setLoading(true);
        try {
            const result = await client.auth.verifyOtp({ email: form.email, otpCode });
            if (result?.access_token) {
                client.auth.setToken(result.access_token);
                // Save extra profile data
                try {
                    await client.auth.updateMe({
                        phone: form.phone,
                        cpf: form.cpf,
                        birth_date: form.birthDate,
                    });
                } catch (e) { console.error("Profile save error:", e); }
            }
            window.location.href = returnTo;
        } catch (err) {
            setError(err.message || "Código inválido");
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setError("");
        try {
            await client.auth.resendOtp(form.email);
        } catch (err) {
            setError(err.message || "Erro ao reenviar código");
        }
    };

    const handleGoogle = () => {
        client.auth.loginWithProvider("google", returnTo);
    };

    if (showOtp) {
        return (
            <AuthLayout
                title="Verifique seu e-mail"
                subtitle={`Enviamos um código para ${form.email}`}
            >
                {error && <div className="mb-4 p-3 bg-[hsl(var(--rose))]/10 text-[hsl(var(--rose))] text-sm text-center">{error}</div>}
                <div className="flex justify-center mb-6">
                    <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} autoFocus>
                        <InputOTPGroup>
                            {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
                        </InputOTPGroup>
                    </InputOTP>
                </div>
                <button onClick={handleVerify} disabled={loading || otpCode.length < 6} className="btn-gold w-full">
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : "Verificar"}
                </button>
                <p className="text-center text-sm text-muted-foreground mt-4">
                    Não recebeu?{" "}
                    <button onClick={handleResend} className="text-[hsl(var(--rose))] font-medium hover:underline">Reenviar</button>
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
            <button onClick={handleGoogle} className="w-full h-12 flex items-center justify-center gap-2 border border-border bg-background text-sm font-medium mb-5 hover:border-foreground/40 transition-colors">
                <GoogleIcon className="w-4 h-4" />
                Cadastrar com Google
            </button>

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
                <div className="grid grid-cols-2 gap-3">
                    <Field icon={Phone} label="Telefone" value={form.phone} onChange={(v) => set("phone", maskPhone(v))} required error={errors.phone} />
                    <Field icon={User} label="CPF" value={form.cpf} onChange={(v) => set("cpf", maskCPF(v))} required error={errors.cpf} />
                </div>
                <Field icon={Calendar} label="Data de nascimento (opcional)" type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(v) => set("birthDate", v)} />
                <Field icon={Lock} label="Senha" type="password" value={form.password} onChange={(v) => set("password", v)} required error={errors.password} />
                <Field icon={Lock} label="Confirmar senha" type="password" value={form.confirm} onChange={(v) => set("confirm", v)} required error={errors.confirm} />
                <button type="submit" disabled={loading} className="btn-gold w-full">
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando conta...</> : <><UserPlus className="w-4 h-4" strokeWidth={1.5} /> Criar conta</>}
                </button>
            </form>
        </AuthLayout>
    );
}

function Field({ icon: Icon, label, value, onChange, type = "text", required = false, error = "", max = undefined }) {
    return (
        <div>
            <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{label}</label>
            <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required={required}
                    max={max}
                    className={`w-full border bg-background pl-10 pr-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors ${error ? "border-[hsl(var(--rose))]" : "border-border"}`}
                />
            </div>
            {error && <p className="text-[11px] text-[hsl(var(--rose))] mt-1.5">{error}</p>}
        </div>
    );
}
