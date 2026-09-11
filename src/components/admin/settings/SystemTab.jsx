import React from "react";
import { Server, Database, ShieldCheck, GitBranch, Lock, Globe, Cloud, Zap, AlertTriangle } from "lucide-react";
import AdminToggle from "@/components/admin/AdminToggle";

export default function SystemTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });

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
                    <Server className="w-4 h-4 text-accent" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Informações do sistema</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow icon={GitBranch} label="Plataforma" value="D'Helenas v2.0" />
                    <InfoRow icon={Database} label="Banco de dados" value="Ativo" status="ok" />
                    <InfoRow icon={ShieldCheck} label="Autenticação" value="Persistente" status="ok" />
                    <InfoRow icon={Server} label="Build" value="Latest" />
                </div>
            </div>

            {/* ─── Painel de Segurança ─────────────────────────────── */}
            <div className="border border-border rounded-xl p-5 bg-background/50">
                <div className="flex items-center gap-2 mb-4">
                    <Lock className="w-4 h-4 text-accent" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Segurança</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SecurityRow icon={Zap} label="Rate Limit" status="active" />
                    <SecurityRow icon={ShieldCheck} label="Helmet (Headers)" status="active" />
                    <SecurityRow icon={Globe} label="CORS" status="active" />
                    <SecurityRow icon={Server} label="Analytics" status="active" />
                    <SecurityRow icon={Cloud} label="Cloudflare" status="pending" note="DDoS / WAF" />
                    <SecurityRow icon={Database} label="Redis" status="pending" note="Rate limit distribuído" />
                    <SecurityRow icon={Lock} label="CSP" status="pending" note="Content-Security-Policy" />
                    <SecurityRow icon={ShieldCheck} label="Turnstile" status="pending" note="Anti-bot (contato, login)" />
                    <SecurityRow icon={Cloud} label="Railway" status="pending" note="Deploy produção" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
                    Itens marcados como "Ativo" estão em execução no backend.
                    Itens "Pendente" requerem configuração em produção.
                    Nenhum secret é exibido aqui.
                </p>
            </div>

            <div className="border border-border rounded-xl p-5 bg-background/50">
                <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium mb-3">Entidades do sistema</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {["Product", "Order", "Category", "Collection", "Banner", "Coupon", "Address", "Favorite", "User", "Setting"].map((e) => (
                        <div key={e} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                            <Database className="w-3 h-3 text-accent" strokeWidth={1.5} /> {e}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SecurityRow({ icon: Icon, label, status, note }) {
    const isActive = status === 'active';
    return (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <div className="flex-1">
                <p className="text-sm font-medium">{label}</p>
                {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
            </div>
            <span className={`text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full ${
                isActive
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-amber-500/10 text-amber-600'
            }`}>
                {isActive ? 'Ativo' : 'Pendente'}
            </span>
        </div>
    );
}

function InfoRow({ icon: Icon, label, value, status }) {
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
