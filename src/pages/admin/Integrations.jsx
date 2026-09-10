import React, { useState, useEffect } from "react";
import {
    Database, CreditCard, Truck, Mail, MessageCircle, Cloud,
    CheckCircle2, XCircle, Save, X, Lock, Eye, EyeOff, Power, Loader2
} from "lucide-react";

const INTEGRATION_DEFS = [
    {
        key: "supabase",
        name: "Supabase",
        icon: Cloud,
        description: "Banco de dados, autenticação e armazenamento de arquivos.",
        fields: [
            { key: "supabase_url", label: "Supabase URL", type: "url", placeholder: "https://xxxx.supabase.co", sensitive: false },
            { key: "supabase_anon_key", label: "Anon Key", type: "text", placeholder: "eyJhbGci...", sensitive: true },
            { key: "supabase_service_role_key", label: "Service Role Key", type: "text", placeholder: "eyJhbGci...", sensitive: true },
        ],
    },
    {
        key: "database",
        name: "Banco de Dados",
        icon: Database,
        description: "PostgreSQL — conexão principal do backend.",
        fields: [
            { key: "database_url", label: "DATABASE_URL", type: "text", placeholder: "postgresql://user:pass@host:5432/db", sensitive: true },
        ],
    },
    {
        key: "mercado_pago",
        name: "Mercado Pago",
        icon: CreditCard,
        description: "Gateway de pagamentos — Pix, cartão de crédito e boleto.",
        fields: [
            { key: "mercado_pago_access_token", label: "Access Token", type: "text", placeholder: "APP_USR-xxxx", sensitive: true },
            { key: "mercado_pago_public_key", label: "Public Key", type: "text", placeholder: "APP_USR-xxxx", sensitive: false },
            { key: "mercado_pago_webhook_url", label: "Webhook URL", type: "url", placeholder: "https://...", sensitive: false },
        ],
    },
    {
        key: "melhor_envio",
        name: "Melhor Envio",
        icon: Truck,
        description: "Cotação e compra de fretes com transportadoras.",
        fields: [
            { key: "melhor_envio_token", label: "Token", type: "text", placeholder: "Bearer xxxx", sensitive: true },
            { key: "melhor_envio_postal_code", label: "CEP de Origem", type: "text", placeholder: "00000-000", sensitive: false },
            { key: "melhor_envio_mode", label: "Ambiente", type: "select", options: ["sandbox", "production"], sensitive: false },
        ],
    },
    {
        key: "whatsapp",
        name: "WhatsApp Business",
        icon: MessageCircle,
        description: "Mensagens automáticas de pedidos via WhatsApp Cloud API.",
        fields: [
            { key: "whatsapp_access_token", label: "Access Token", type: "text", placeholder: "EAAG...", sensitive: true },
            { key: "whatsapp_phone_number_id", label: "Phone Number ID", type: "text", placeholder: "000000...", sensitive: false },
            { key: "whatsapp_verify_token", label: "Verify Token (Webhook)", type: "text", placeholder: "meu-token", sensitive: false },
        ],
    },
    {
        key: "email",
        name: "E-mail Transacional",
        icon: Mail,
        description: "Envio de e-mails de pedidos, recuperação de senha e notificações.",
        fields: [
            { key: "resend_api_key", label: "Resend API Key", type: "text", placeholder: "re_xxxx", sensitive: true },
            { key: "email_from", label: "E-mail remetente", type: "email", placeholder: "contato@dhelenas.com.br", sensitive: false },
            { key: "email_from_name", label: "Nome remetente", type: "text", placeholder: "D'Helenas", sensitive: false },
        ],
    },
];

export default function Integrations() {
    const [configs, setConfigs] = useState({});
    const [envStatus, setEnvStatus] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingKey, setEditingKey] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [saving, setSaving] = useState(false);

    const token = localStorage.getItem("dhelena_access_token");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    useEffect(() => {
        Promise.all([
            fetch("/api/integrations/config", { headers }).then(r => r.json()),
            fetch("/api/integrations/status", { headers }).then(r => r.json()),
        ]).then(([cfgs, envs]) => {
            const cfgMap = {};
            (cfgs || []).forEach(c => { cfgMap[c.service_key] = c; });
            setConfigs(cfgMap);
            setEnvStatus(envs || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const getEnvStatus = (key) => envStatus.find(e => e.key === key);

    const startEdit = (def) => {
        const existing = configs[def.key];
        const formData = {};
        def.fields.forEach(f => {
            formData[f.key] = existing?.config_data?.[f.key] || "";
        });
        setEditForm(formData);
        setEditingKey(def.key);
    };

    const handleSave = async (def) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/integrations/config/${def.key}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                    service_name: def.name,
                    description: def.description,
                    config_data: editForm,
                    is_active: configs[def.key]?.is_active ?? false,
                }),
            });
            const saved = await res.json();
            setConfigs(prev => ({ ...prev, [def.key]: saved }));
            setEditingKey(null);
        } catch { /* */ }
        finally { setSaving(false); }
    };

    const toggleActive = async (def) => {
        const res = await fetch(`/api/integrations/config/${def.key}/toggle`, {
            method: "PATCH", headers,
        });
        const updated = await res.json();
        setConfigs(prev => ({ ...prev, [def.key]: updated }));
    };

    if (loading) {
        return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" /></div>;
    }

    return (
        <div>
            <div className="mb-6">
                <h1 className="font-heading text-2xl tracking-[0.04em]">Integrações</h1>
                <p className="text-[11px] text-muted-foreground mt-1">
                    Configure e gerencie credenciais de cada serviço. Tokens e chaves são exibidos mascarados por segurança.
                </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
                {INTEGRATION_DEFS.map(def => {
                    const cfg = configs[def.key];
                    const env = getEnvStatus(def.key);
                    const envConfigured = env && env.status !== "Não configurado";
                    const dbActive = cfg?.is_active ?? false;
                    const isConfigured = envConfigured || dbActive;
                    const isEditing = editingKey === def.key;

                    return (
                        <div key={def.key} className="bg-background border border-border rounded-lg overflow-hidden">
                            {/* Header */}
                            <div className="p-5">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-start gap-3">
                                        <div className="w-11 h-11 rounded-lg bg-[hsl(var(--gold))]/10 flex items-center justify-center shrink-0">
                                            <def.icon className="w-5 h-5 text-[hsl(var(--gold))]" strokeWidth={1.5} />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-sm">{def.name}</h3>
                                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{def.description}</p>
                                        </div>
                                    </div>
                                    <span className={`inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full whitespace-nowrap ${
                                        isConfigured ? "bg-green-50 text-green-700 border border-green-200" : "bg-muted text-muted-foreground"
                                    }`}>
                                        {isConfigured ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        {isConfigured ? "Configurado" : "Pendente"}
                                    </span>
                                </div>

                                {/* Status badges */}
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {envConfigured && (
                                        <span className="text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 border border-[hsl(var(--gold))]/30 text-[hsl(var(--gold))]">
                                            Env / {env.environment}
                                        </span>
                                    )}
                                    {dbActive && (
                                        <span className="text-[9px] uppercase tracking-[0.1em] px-2 py-0.5 border border-green-500/30 text-green-600">
                                            Ativo no painel
                                        </span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 mt-4">
                                    <button
                                        onClick={() => isEditing ? setEditingKey(null) : startEdit(def)}
                                        className="flex-1 py-2 text-[11px] uppercase tracking-[0.12em] border border-border hover:border-foreground transition-colors"
                                    >
                                        {isEditing ? "Fechar" : "Editar"}
                                    </button>
                                    <button
                                        onClick={() => toggleActive(def)}
                                        disabled={!cfg && !envConfigured}
                                        className={`p-2 border transition-colors disabled:opacity-30 ${dbActive ? "border-green-500/40 text-green-600" : "border-border text-muted-foreground hover:text-foreground"}`}
                                        title={dbActive ? "Desativar" : "Ativar"}
                                    >
                                        <Power className="w-4 h-4" strokeWidth={1.5} />
                                    </button>
                                </div>
                            </div>

                            {/* Edit form */}
                            {isEditing && (
                                <div className="border-t border-border p-5 bg-[hsl(var(--bone))]/30 space-y-3">
                                    {def.fields.map(field => {
                                        const val = editForm[field.key] || "";
                                        const isMasked = typeof val === "string" && val.includes("****");
                                        return (
                                            <div key={field.key}>
                                                <label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1.5 mb-1">
                                                    {field.label}
                                                    {field.sensitive && <Lock className="w-3 h-3" />}
                                                </label>
                                                {field.type === "select" ? (
                                                    <select
                                                        value={val}
                                                        onChange={e => setEditForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                        className="w-full border border-border px-3 py-2 text-sm bg-background"
                                                    >
                                                        <option value="">Selecione...</option>
                                                        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type={field.type === "url" ? "url" : "text"}
                                                        value={isMasked ? "" : val}
                                                        placeholder={isMasked ? val : field.placeholder}
                                                        onChange={e => setEditForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                        className="w-full border border-border px-3 py-2 text-sm bg-background"
                                                    />
                                                )}
                                                {isMasked && (
                                                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                                                        <Lock className="w-2.5 h-2.5" /> Valor já salvo — digite um novo para substituir
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <div className="flex gap-2 pt-2">
                                        <button
                                            onClick={() => handleSave(def)}
                                            disabled={saving}
                                            className="btn-gold px-4 py-2 text-[11px] flex items-center gap-1.5"
                                        >
                                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Salvar
                                        </button>
                                        <button onClick={() => setEditingKey(null)} className="btn-outline px-4 py-2 text-[11px]">Cancelar</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
