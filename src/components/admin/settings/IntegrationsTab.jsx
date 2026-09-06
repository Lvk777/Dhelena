import React, { useState } from "react";
import { CreditCard, Truck, Mail, Check, Copy, AlertCircle, Plug } from "lucide-react";

export default function IntegrationsTab() {
    const [copied, setCopied] = useState(false);
    const webhookUrl = "Disponível após publicar o app e criar a função de webhook";

    const copyWebhook = () => {
        navigator.clipboard?.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-5">
            <IntegrationCard icon={CreditCard} name="Mercado Pago" status="Não configurado" environment="—" description="Gateway de pagamentos (Pix, cartão, boleto)" />
            <IntegrationCard icon={Truck} name="Melhor Envio" status="Não configurado" environment="—" description="Cotação e compra de fretes com transportadoras" />
            <IntegrationCard icon={Mail} name="E-mail transacional" status="Ativo" environment="Base44" description="Envio de e-mails transacionais via integração nativa" />

            <div className="border border-border rounded-xl p-5 bg-background/50">
                <div className="flex items-center gap-2 mb-4">
                    <Plug className="w-4 h-4 text-accent" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Webhooks</h3>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Webhook do Mercado Pago</label>
                        <div className="flex gap-2">
                            <input readOnly value={webhookUrl} className="admin-field flex-1 text-xs" />
                            <button onClick={copyWebhook} className="btn-outline px-4 text-xs whitespace-nowrap">
                                {copied ? <Check className="w-4 h-4 text-accent" strokeWidth={1.5} /> : <Copy className="w-4 h-4" strokeWidth={1.5} />} Copiar
                            </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1.5">Configure esta URL no painel do Mercado Pago → Notificações/IPN</p>
                    </div>
                </div>
            </div>

            <div className="flex items-start gap-2 p-4 bg-muted/30 rounded-lg border border-border">
                <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
                <p className="text-xs text-muted-foreground">
                    Secrets privados (Access Tokens, API Keys) devem ser configurados exclusivamente no ambiente seguro da Base44 (Dashboard → Settings → Environment Variables). Nunca armazene credenciais privadas no banco de dados.
                </p>
            </div>
        </div>
    );
}

function IntegrationCard({ icon: Icon, name, status, environment, description }) {
    const isActive = status === "Ativo" || status === "Conectado";
    return (
        <div className="border border-border rounded-xl p-5 bg-background/50">
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <Icon className="w-6 h-6 text-accent" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">{name}</h3>
                        <span className={`text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded ${isActive ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>{status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Ambiente: {environment}</p>
                </div>
                <button onClick={() => alert(`Configure os secrets necessários no ambiente seguro da Base44 (Dashboard → Settings → Environment Variables) para ativar ${name}.`)} className="btn-outline text-xs whitespace-nowrap">
                    Configurar
                </button>
            </div>
        </div>
    );
}