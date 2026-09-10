import React, { useState, useEffect } from "react";
import { CheckCircle2, XCircle, Settings2 } from "lucide-react";

export default function Integrations() {
    const [integrations, setIntegrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        const token = localStorage.getItem("dhelena_access_token");
        fetch("/api/integrations/status", { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then(data => { setIntegrations(data); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" /></div>;
    }

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.04em] mb-2">Integrações</h1>
            <p className="text-[11px] text-muted-foreground mb-6">Gerencie as credenciais de cada serviço. Secrets são cadastrados na plataforma, nunca no banco ou frontend.</p>

            <div className="grid sm:grid-cols-2 gap-4">
                {integrations.map(int => {
                    const configured = int.status !== "Não configurado" && !int.status.includes("Local");
                    return (
                        <div key={int.key} className="bg-background border border-border p-5">
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <h3 className="font-medium text-sm">{int.name}</h3>
                                    <div className="flex items-center gap-2 mt-1.5">
                                        {configured ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-green-600">
                                                <CheckCircle2 className="w-3.5 h-3.5" /> {int.status}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                                <XCircle className="w-3.5 h-3.5" /> {int.status}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <span className={`text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 border ${int.environment === "Produção" ? "border-green-500/40 text-green-600" : "border-border text-muted-foreground"}`}>
                                    {int.environment}
                                </span>
                            </div>

                            <button
                                onClick={() => setExpanded(expanded === int.key ? null : int.key)}
                                className="w-full mt-2 py-2 text-[11px] uppercase tracking-[0.12em] border border-border hover:border-foreground transition-colors flex items-center justify-center gap-1.5"
                            >
                                <Settings2 className="w-3.5 h-3.5" /> Configurar
                            </button>

                            {expanded === int.key && (
                                <div className="mt-3 p-3 bg-[hsl(var(--bone))]/50 text-[12px] text-muted-foreground leading-relaxed">
                                    <p className="font-medium text-foreground text-[11px] uppercase tracking-[0.1em] mb-1">Como configurar:</p>
                                    <p>{int.hint}</p>
                                    <p className="mt-2 text-[11px]">Cadastre as credenciais na página de Secrets da plataforma Base44. O valor nunca aparece no código, banco ou frontend.</p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
