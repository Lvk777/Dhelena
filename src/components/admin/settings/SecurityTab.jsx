import React, { useState, useEffect } from "react";
import { Shield, Loader2, Smartphone, KeyRound, AlertTriangle, Check, Copy } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AdminFormSection from "@/components/admin/AdminFormSection";
import AdminToggle from "@/components/admin/AdminToggle";
import { logAdminAction } from "@/lib/audit";

export default function SecurityTab() {
    const [loading, setLoading] = useState(true);
    const [twoFAStatus, setTwoFAStatus] = useState({ enabled: false, require_2fa_admin: false });
    const [setupMode, setSetupMode] = useState(null); // null | 'qr' | 'verify' | 'recovery'
    const [qrUrl, setQrUrl] = useState("");
    const [verifyCode, setVerifyCode] = useState("");
    const [recoveryCodes, setRecoveryCodes] = useState([]);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => { loadStatus(); }, []);

    const loadStatus = async () => {
        try {
            const res = await base44.custom.securityStatus();
            setTwoFAStatus(res);
        } catch (e) {
            console.error("Failed to load 2FA status", e);
        } finally {
            setLoading(false);
        }
    };

    const start2FASetup = async () => {
        setBusy(true); setError("");
        try {
            const res = await base44.custom.setup2FA();
            setQrUrl(res.qr_url);
            setSetupMode("qr");
        } catch (e) {
            setError("Erro ao gerar QR Code. Tente novamente.");
        } finally { setBusy(false); }
    };

    const verify2FA = async () => {
        setBusy(true); setError("");
        try {
            const res = await base44.custom.verify2FA({ code: verifyCode });
            if (res.recovery_codes) {
                setRecoveryCodes(res.recovery_codes);
                setSetupMode("recovery");
                setTwoFAStatus(s => ({ ...s, enabled: true }));
                await logAdminAction("2fa_enabled", "Security", "", "2FA", "Autenticação 2FA ativada");
            }
        } catch (e) {
            setError("Código inválido. Verifique e tente novamente.");
        } finally { setBusy(false); }
    };

    const disable2FA = async () => {
        setBusy(true); setError("");
        try {
            await base44.custom.disable2FA();
            setTwoFAStatus(s => ({ ...s, enabled: false }));
            setSetupMode(null);
            await logAdminAction("2fa_disabled", "Security", "", "2FA", "Autenticação 2FA desativada");
        } catch (e) {
            setError("Erro ao desativar 2FA.");
        } finally { setBusy(false); }
    };

    const toggleRequireAdmin = async (val) => {
        try {
            await base44.custom.updateSecuritySetting({ require_2fa_admin: val });
            setTwoFAStatus(s => ({ ...s, require_2fa_admin: val }));
            await logAdminAction("settings_update", "Security", "", "2FA Policy", `Exigir 2FA para admins: ${val ? "ativado" : "desativado"}`);
        } catch (e) {
            setError("Erro ao atualizar política.");
        }
    };

    const copyCodes = () => {
        navigator.clipboard.writeText(recoveryCodes.join("\n"));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) return <div className="h-40 bg-background animate-pulse rounded-lg" />;

    return (
        <div className="space-y-5">
            <AdminFormSection title="Autenticação em Dois Fatores (2FA)" icon={Shield}
                description="Proteja sua conta com verificação adicional via app autenticador (Google Authenticator, Microsoft Authenticator, Authy, 1Password).">
                {error && (
                    <div className="col-span-2 flex items-center gap-2 text-sm text-rose bg-rose/5 p-3 rounded">
                        <AlertTriangle className="w-4 h-4" /> {error}
                    </div>
                )}

                {!twoFAStatus.enabled && !setupMode && (
                    <div className="col-span-2">
                        <div className="flex items-center gap-3 p-4 bg-background border border-border rounded-lg">
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                <KeyRound className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium">2FA não configurado</p>
                                <p className="text-xs text-muted-foreground">Sua conta não tem proteção 2FA ativa.</p>
                            </div>
                            <button onClick={start2FASetup} disabled={busy} className="btn-gold text-xs">
                                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />} Ativar 2FA
                            </button>
                        </div>
                    </div>
                )}

                {twoFAStatus.enabled && !setupMode && (
                    <div className="col-span-2">
                        <div className="flex items-center gap-3 p-4 bg-accent/5 border border-accent/20 rounded-lg">
                            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                                <Check className="w-5 h-5 text-accent" strokeWidth={2} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-accent">2FA ativo</p>
                                <p className="text-xs text-muted-foreground">Sua conta está protegida com autenticação de dois fatores.</p>
                            </div>
                            <button onClick={disable2FA} disabled={busy} className="btn-ghost text-xs">
                                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Desativar
                            </button>
                        </div>
                    </div>
                )}

                {/* QR Code step */}
                {setupMode === "qr" && (
                    <div className="col-span-2 space-y-4">
                        <p className="text-sm text-muted-foreground">1. Escaneie o QR Code com seu app autenticador:</p>
                        {qrUrl && (
                            <div className="flex justify-center p-4 bg-white rounded-lg border border-border">
                                <img src={qrUrl} alt="QR Code 2FA" className="w-48 h-48" />
                            </div>
                        )}
                        <p className="text-sm text-muted-foreground">2. Digite o código de 6 dígitos gerado pelo app:</p>
                        <input
                            type="text"
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            placeholder="000000"
                            className="w-full max-w-[200px] px-4 py-3 text-center text-2xl tracking-[0.5em] bg-background border border-border rounded-lg focus:outline-none focus:border-accent font-numeric"
                            maxLength={6}
                        />
                        <div className="flex gap-2">
                            <button onClick={verify2FA} disabled={busy || verifyCode.length !== 6} className="btn-gold text-xs">
                                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirmar código
                            </button>
                            <button onClick={() => setSetupMode(null)} className="btn-ghost text-xs">Cancelar</button>
                        </div>
                    </div>
                )}

                {/* Recovery codes step */}
                {setupMode === "recovery" && (
                    <div className="col-span-2 space-y-4">
                        <div className="flex items-start gap-2 p-4 bg-accent/5 border border-accent/20 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-accent">Salve seus códigos de recuperação</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Guarde estes códigos em local seguro. Use-os se perder acesso ao seu app autenticador.
                                    Cada código pode ser usado apenas uma vez.
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 p-4 bg-background border border-border rounded-lg">
                            {recoveryCodes.map((code, i) => (
                                <p key={i} className="font-numeric text-sm tracking-wider text-center">{code}</p>
                            ))}
                        </div>
                        <button onClick={copyCodes} className="btn-ghost text-xs">
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? "Copiado!" : "Copiar códigos"}
                        </button>
                        <button onClick={() => setSetupMode(null)} className="btn-gold text-xs ml-2">Concluir</button>
                    </div>
                )}
            </AdminFormSection>

            <AdminFormSection title="Política de 2FA para Administradores" icon={KeyRound}
                description="Quando ativo, administradores sem 2FA configurado serão obrigados a configurar no próximo login.">
                <div className="col-span-2 py-2">
                    <AdminToggle
                        label="Exigir 2FA para administradores"
                        checked={twoFAStatus.require_2fa_admin}
                        onChange={toggleRequireAdmin}
                        description="Obriga todos os admins a terem 2FA ativo. Clientes não são afetados."
                    />
                </div>
            </AdminFormSection>
        </div>
    );
}
