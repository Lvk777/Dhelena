import React, { useState } from "react";
import { Link } from "react-router-dom";
import { client } from "@/api/apiClient";
import { Loader2, Mail, Lock, LogIn } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import PasswordInput from "@/components/PasswordInput";
import GoogleSignIn from "@/components/GoogleSignIn";
import { safeReturnTo } from "@/lib/authReturnTo";
import { track } from "@/lib/analytics";

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const returnTo = safeReturnTo();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            await client.auth.loginViaEmailPassword(email, password, returnTo);
            track('login');
            window.location.href = returnTo === '/' ? '/minha-conta' : returnTo;
        } catch (err) {
            setError(err.message || "E-mail ou senha inválidos");
        } finally {
            setLoading(false);
        }
    };

    const handleGoogle = async () => {
        setLoading(true); setError('');
        try { await client.auth.loginWithProvider("google", returnTo === '/' ? '/minha-conta' : returnTo); }
        catch { setError('Não foi possível entrar com Google. Tente novamente ou use e-mail e senha.'); }
        finally { setLoading(false); }
    };

    return (
        <AuthLayout
            title="Bem-vinda de volta"
            subtitle="Entre na sua conta D'Helenas"
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
            <GoogleSignIn loading={loading} onClick={handleGoogle} />

            <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em]">
                    <span className="bg-[hsl(var(--bone))] px-3 text-muted-foreground">ou</span>
                </div>
            </div>

            {error && (
                <div role="alert" className="mb-4 p-3 bg-[hsl(var(--rose))]/10 text-error-ink text-sm text-center">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
            </form>

        </AuthLayout>
    );
}
