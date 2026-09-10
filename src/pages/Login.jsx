import React, { useState } from "react";
import { Link } from "react-router-dom";
import { client } from "@/api/apiClient";
import { Loader2, Mail, Lock, LogIn, ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
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
            window.location.href = returnTo;
        } catch (err) {
            setError(err.message || "E-mail ou senha inválidos");
        } finally {
            setLoading(false);
        }
    };

    const handleAdminLogin = async () => {
        setError("");
        setLoading(true);
        try {
            await client.auth.loginAsAdmin();
            window.location.href = returnTo.startsWith('/admin') ? returnTo : '/admin';
        } catch (err) {
            setError(err.message || "Erro ao entrar como administrador");
        } finally {
            setLoading(false);
        }
    };

    const handleGoogle = () => {
        client.auth.loginWithProvider("google", returnTo);
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
                        className="text-[hsl(var(--rose))] font-medium hover:underline"
                    >
                        Criar conta
                    </Link>
                </>
            }
        >
            <button
                onClick={handleGoogle}
                className="w-full h-12 flex items-center justify-center gap-2 border border-border bg-background text-sm font-medium mb-5 hover:border-foreground/40 transition-colors"
            >
                <GoogleIcon className="w-4 h-4" />
                Entrar com Google
            </button>

            <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em]">
                    <span className="bg-[hsl(var(--bone))] px-3 text-muted-foreground">ou</span>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-[hsl(var(--rose))]/10 text-[hsl(var(--rose))] text-sm text-center">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">E-mail</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="email"
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
                        <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Senha</label>
                        <Link to="/esqueci-minha-senha" className="text-xs text-[hsl(var(--rose))] hover:underline">
                            Esqueci minha senha
                        </Link>
                    </div>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full border border-border bg-background pl-10 pr-4 py-3.5 text-sm focus:outline-none focus:border-[hsl(var(--gold))] transition-colors"
                            required
                        />
                    </div>
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

            <div className="mt-6 pt-5 border-t border-border text-center">
                <button
                    type="button"
                    onClick={handleAdminLogin}
                    disabled={loading}
                    className="w-full py-2.5 px-4 text-[11px] tracking-[0.15em] uppercase border border-[hsl(var(--gold))] text-[hsl(var(--gold))] hover:bg-[hsl(var(--gold))] hover:text-white transition-all font-medium flex items-center justify-center gap-2"
                >
                    <ShieldCheck className="w-4 h-4" />
                    Entrar como Administrador
                </button>
            </div>
        </AuthLayout>
    );
}