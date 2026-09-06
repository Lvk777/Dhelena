import React from "react";
import { Server, Database, ShieldCheck, GitBranch } from "lucide-react";

export default function SystemTab() {
    return (
        <div className="space-y-5">
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