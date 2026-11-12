import React, { useState } from "react";
import { Link } from "react-router-dom";
import { client } from "@/api/apiClient";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { requestPasswordRecovery, RECOVERY_ACCEPTED_MESSAGE } from "@/lib/passwordRecovery";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const result = await requestPasswordRecovery(email, value => client.auth.resetPasswordRequest(value));
            setSent(result.accepted);
            if (!result.accepted) setError(result.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title="Esqueci minha senha"
            subtitle="Enviaremos um link para redefini-la"
            footer={
                <Link to="/login" className="text-rose-ink font-medium hover:underline">
                    <ArrowLeft className="w-3 h-3 inline mr-1" />Voltar para entrar
                </Link>
            }
        >
            {sent ? (
                <p className="text-sm text-foreground text-center leading-relaxed">
                    {RECOVERY_ACCEPTED_MESSAGE}
                </p>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && <p role="alert" className="text-sm text-error-ink">{error}</p>}
                    <div>
                        <label htmlFor="recovery-email" className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">E-mail</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <input
                                id="recovery-email" type="email"
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
                    <button type="submit" disabled={loading} className="btn-gold w-full">
                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : "Enviar link de redefinição"}
                    </button>
                </form>
            )}
        </AuthLayout>
    );
}
