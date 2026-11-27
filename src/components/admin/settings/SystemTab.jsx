import React, { useEffect, useState } from "react";
import { Server, Database, ShieldCheck, GitBranch, Lock, Globe, Cloud, Zap, AlertTriangle } from "lucide-react";
import AdminToggle from "@/components/admin/AdminToggle";

export default function SystemTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    const [backendHealth, setBackendHealth] = useState("checking");

    useEffect(() => {
        const apiUrl = import.meta.env.VITE_API_URL;
        if (!apiUrl) {
            setBackendHealth("unverified");
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let mounted = true;
        const checkHealth = async () => {
            try {
                const response = await fetch(new URL('/health', apiUrl).href, {
                    cache: 'no-store', signal: controller.signal,
                });
                const payload = response.ok ? await response.json() : null;
                if (mounted) {
                    setBackendHealth(response.ok && payload?.status === 'ok' && payload?.database === 'connected'
                        ? 'online' : 'unavailable');
                }
            } catch {
                if (mounted) setBackendHealth('unavailable');
            } finally {
                clearTimeout(timeout);
            }
        };

        checkHealth();
        return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
    }, []);

    return (
        <div className="space-y-5">
            {/* ─── Modo Manutenção ─────────────────────────────────── */}
            <div className="border border-border rounded-xl p-5 bg-background/50">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 text-amber-500" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Modo Manutenção</h3>
                </div>
                <AdminToggle
                    label="Ativar modo manutenção"
                    checked={data?.maintenance_mode || false}
                    onChange={(v) => set("maintenance_mode", v)}
                    description="Quando ativado, visitantes veem apenas a página Em breve. Administradores continuam acessando o site normalmente."
                />
            </div>
            <div className="border border-border rounded-xl p-5 bg-background/50">
                <div className="flex items-center gap-2 mb-4">
                    <Server className="w-4 h-4 text-gold-ink" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Informações do sistema</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow icon={GitBranch} label="Plataforma" value="D'Helenas v2.0" />
                    <InfoRow icon={Database} label="Banco de dados" value={backendHealth === 'online' ? 'Conectado' : backendHealth === 'checking' ? 'Verificando...' : 'Não confirmado'} status={backendHealth === 'online' ? 'ok' : ''} />
                    <InfoRow icon={ShieldCheck} label="Autenticação" value="Implementada no código" />
                    <InfoRow icon={Server} label="Site" value="Painel carregado" />
                </div>
            </div>

            {/* ─── Status verificável e recursos de segurança ──────── */}
            <div className="border border-border rounded-xl p-5 bg-background/50">
                <div className="flex items-center gap-2 mb-4">
                    <Lock className="w-4 h-4 text-gold-ink" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Segurança</h3>
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">Disponibilidade consultada agora</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                    <SecurityRow icon={Cloud} label="Railway — API" status={backendHealth} note="Saúde da API e do banco; não consulta o histórico de deploy" />
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">Proteções implementadas no código</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                    <SecurityRow icon={Zap} label="Rate Limit" status="implemented" />
                    <SecurityRow icon={ShieldCheck} label="Helmet (Headers)" status="implemented" />
                    <SecurityRow icon={Globe} label="CORS" status="implemented" />
                    <SecurityRow icon={Server} label="Analytics" status="implemented" note="Painel interno de eventos" />
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">Recursos adicionais e verificações externas</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SecurityRow icon={Cloud} label="Cloudflare" status="unverified" note="WAF / DDoS: exige verificação externa" />
                    <SecurityRow icon={Database} label="Redis" status="optional" note="Rate limit distribuído; não é exigido pelo sistema atual" />
                    <SecurityRow icon={Lock} label="CSP" status="review" note="Desativada no backend; ativação exige testes de compatibilidade" />
                    <SecurityRow icon={ShieldCheck} label="Turnstile" status="optional" note="Antirrobô adicional; não é exigido para vender" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
                    "Online" é resultado de uma consulta à API. "Implementado" descreve código existente,
                    não uma auditoria de produção. Recursos opcionais ou não verificados não são falhas
                    confirmadas. Nenhuma credencial é exibida aqui.
                </p>
            </div>

            <div className="border border-border rounded-xl p-5 bg-background/50">
                <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium mb-3">Entidades do sistema</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {["Product", "Order", "Category", "Collection", "Banner", "Coupon", "Address", "Favorite", "User", "Setting"].map((e) => (
                        <div key={e} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                            <Database className="w-3 h-3 text-gold-ink" strokeWidth={1.5} /> {e}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SecurityRow({ icon: Icon, label, status, note = "" }) {
    const states = {
        online: { label: 'Online', color: 'bg-green-500/10 text-success-ink' },
        implemented: { label: 'Implementado', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
        optional: { label: 'Opcional', color: 'bg-muted text-muted-foreground' },
        unverified: { label: 'Não verificado', color: 'bg-muted text-muted-foreground' },
        checking: { label: 'Verificando', color: 'bg-muted text-muted-foreground' },
        unavailable: { label: 'Sem conexão', color: 'bg-red-500/10 text-red-700 dark:text-red-300' },
        review: { label: 'A avaliar', color: 'bg-amber-500/10 text-warning-ink' },
    };
    const state = states[status] || states.unverified;
    return (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <div className="flex-1">
                <p className="text-sm font-medium">{label}</p>
                {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
            </div>
            <span className={`text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap ${state.color}`}>
                {state.label}
            </span>
        </div>
    );
}

function InfoRow({ icon: Icon, label, value, status = "" }) {
    return (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <div className="flex-1">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="text-sm font-medium flex items-center gap-2">
                    {value}
                    {status === "ok" && <span className="w-2 h-2 rounded-full bg-accent" />}
                </p>
            </div>
        </div>
    );
}
