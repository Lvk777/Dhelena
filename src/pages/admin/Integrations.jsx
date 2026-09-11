import React, { useState, useEffect } from "react";
import {
    Database, CreditCard, Truck, Mail, MessageCircle, Cloud,
    CheckCircle2, XCircle, Save, Lock, Power, Loader2, AlertTriangle, Zap
} from "lucide-react";
import AdminModal from "@/components/admin/AdminModal";
import AdminInput from "@/components/admin/AdminInput";
import AdminSelect from "@/components/admin/AdminSelect";

const INTEGRATION_DEFS = [
    {
        key: "supabase",
        name: "Supabase",
        icon: Cloud,
        description: "Banco de dados, autenticação e armazenamento de arquivos.",
        fields: [
            { key: "supabase_url", label: "Supabase URL", type: "url", placeholder: "https://xxxx.supabase.co", sensitive: false },
            { key: "supabase_anon_key", label: "Anon Key", type: "text", placeholder: "eyJhbGci...", sensitive: true },
            { key: "supabase_service_role_key", label: "Service Role Key", type: "text", placeholder: "NUNCA exibido — digite para definir", sensitive: true },
        ],
    },
    {
        key: "database",
        name: "Banco de Dados",
        icon: Database,
        description: "PostgreSQL — conexão principal do backend.",
        fields: [
            { key: "database_url", label: "DATABASE_URL", type: "text", placeholder: "NUNCA exibido — digite para definir", sensitive: true },
        ],
    },
    {
        key: "mercado_pago",
        name: "Mercado Pago",
        icon: CreditCard,
        description: "Gateway de pagamentos — Pix, cartão de crédito e boleto.",
        fields: [
            { key: "mercado_pago_access_token", label: "Access Token", type: "text", placeholder: "NUNCA exibido — digite para definir", sensitive: true },
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
            { key: "melhor_envio_token", label: "Token", type: "text", placeholder: "NUNCA exibido — digite para definir", sensitive: true },
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
            { key: "whatsapp_access_token", label: "Access Token", type: "text", placeholder: "NUNCA exibido — digite para definir", sensitive: true },
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
            { key: "resend_api_key", label: "Resend API Key", type: "text", placeholder: "NUNCA exibido — digite para definir", sensitive: true },
            { key: "email_from", label: "E-mail remetente", type: "email", placeholder: "contato@dhelenas.com.br", sensitive: false },
            { key: "email_from_name", label: "Nome remetente", type: "text", placeholder: "D'Helenas", sensitive: false },
        ],
    },
];

export default function Integrations() {
    const [configs, setConfigs] = useState({});
    const [envStatus, setEnvStatus] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingDef, setEditingDef] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(null);
    const [testResult, setTestResult] = useState(null);
    const [showConfirmSave, setShowConfirmSave] = useState(false);

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
            if (f.sensitive) {
                formData[f.key] = "";
            } else {
                const raw = existing?.config_data?.[f.key];
                formData[f.key] = typeof raw === "object" ? "" : (raw || "");
            }
        });
        setEditForm(formData);
        setEditingDef(def);
        setTestResult(null);
        setTesting(null);
    };

    const handleSave = async () => {
        // Check if this is a critical integration (payment, shipping)
        const isCritical = true;
        if (isCritical && !showConfirmSave) {
            setShowConfirmSave(true);
            return;
        }
        setShowConfirmSave(false);
        setSaving(true);
        try {
            const res = await fetch(`/api/integrations/config/${editingDef.key}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                    service_name: editingDef.name,
                    description: editingDef.description,
                    config_data: editForm,
                    is_active: configs[editingDef.key]?.is_active ?? false,
                }),
            });
            const saved = await res.json();
            setConfigs(prev => ({ ...prev, [editingDef.key]: saved }));
            setEditingDef(null);
        } catch { /* */ }
        finally { setSaving(false); }
    };

    const handleTestConnection = async () => {
        setTesting("loading");
        setTestResult(null);
        try {
            // Save first if there are unsaved changes, then test
            const res = await fetch(`/api/integrations/test/${editingDef.key}`, {
                method: "POST",
                headers,
                body: JSON.stringify({ config_data: editForm }),
            });
            const result = await res.json();
            if (result.success) {
                setTesting("success");
                setTestResult("Conectado");
            } else {
                setTesting("error");
                setTestResult("Falhou");
            }
        } catch {
            setTesting("error");
            setTestResult("Falhou");
        }
    };

    const toggleActive = async (def) => {
        const res = await fetch(`/api/integrations/config/${def.key}/toggle`, {
            method: "PATCH", headers,
        });
        const updated = await res.json();
        setConfigs(prev => ({ ...prev, [def.key]: updated }));
    };

    const getFieldStatus = (def, field) => {
        const cfg = configs[def.key];
        if (!cfg) return null;
        const fieldVal = cfg.config_data?.[field.key];
        if (field.sensitive) {
            if (typeof fieldVal === "object" && fieldVal !== null) return fieldVal;
            if (typeof fieldVal === "string" && fieldVal.includes("****")) return { configured: true, masked_value: fieldVal };
        }
        return null;
    };

    if (loading) {
        return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" /></div>;
    }

    return (
        <div>
            <div className="mb-6">
                <h1 className="font-heading text-2xl tracking-[0.04em]">Integrações</h1>
                <p className="text-[11px] text-muted-foreground mt-1">
                    Configure e gerencie credenciais de cada serviço. Secrets são criptografados (AES-256-GCM) e nunca exibidos.
                </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
                {INTEGRATION_DEFS.map(def => {
                    const cfg = configs[def.key];
                    const env = getEnvStatus(def.key);
                    const envConfigured = env && env.status !== "Não configurado";
                    const dbActive = cfg?.is_active ?? false;
                    const dbSensitiveConfigured = def.fields.some(f => getFieldStatus(def, f.key)?.configured);
                    const isConfigured = envConfigured || dbActive || dbSensitiveConfigured;

                    return (
                        <div key={def.key} className="bg-background border border-border rounded-lg overflow-hidden">
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

                                <div className="flex gap-2 mt-4">
                                    <button
                                        onClick={() => startEdit(def)}
                                        className="flex-1 py-2 text-[11px] uppercase tracking-[0.12em] border border-border hover:border-foreground transition-colors"
                                    >
                                        Editar
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
                        </div>
                    );
                })}
            </div>

            {/* Integration Modal */}
            {editingDef && (
                <AdminModal
                    open
                    onClose={() => { setEditingDef(null); setShowConfirmSave(false); setTestResult(null); setTesting(null); }}
                    title={editingDef.name}
                    subtitle={editingDef.description}
                    size="md"
                    icon={editingDef.icon}
                    footer={
                        <>
                            <button onClick={handleTestConnection} disabled={testing === "loading"} className="btn-outline flex items-center gap-1.5">
                                {testing === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                Testar conexão
                            </button>
                            <button onClick={() => { setEditingDef(null); setShowConfirmSave(false); setTestResult(null); }} className="btn-ghost">Cancelar</button>
                            <button onClick={handleSave} disabled={saving} className="btn-gold flex items-center gap-1.5">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                            </button>
                        </>
                    }
                >
                    <div className="space-y-4">
                        {/* Test result banner — only shows after explicit test action */}
                        {testing === "loading" && (
                            <div className="flex items-center gap-2 p-3 rounded-lg text-sm bg-muted text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" /> Testando conexão...
                            </div>
                        )}
                        {testing && testing !== "loading" && (
                            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                                testing === "success" ? "bg-green-50 text-green-700 border border-green-200"
                                : "bg-red-50 text-red-700 border border-red-200"
                            }`}>
                                {testing === "success" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                {testResult}
                            </div>
                        )}

                        {/* Fields */}
                        {editingDef.fields.map(field => {
                            const fieldStatus = getFieldStatus(editingDef, field.key);
                            const isConfiguredField = fieldStatus?.configured;
                            const maskedValue = fieldStatus?.masked_value;

                            return (
                                <div key={field.key}>
                                    {field.type === "select" ? (
                                        <AdminSelect
                                            label={field.label}
                                            value={editForm[field.key] || ""}
                                            onChange={(v) => setEditForm(prev => ({ ...prev, [field.key]: v }))}
                                            options={field.options.map(o => ({ value: o, label: o === "sandbox" ? "Sandbox" : "Produção" }))}
                                        />
                                    ) : (
                                        <AdminInput
                                            label={field.label}
                                            value={editForm[field.key] || ""}
                                            onChange={(v) => setEditForm(prev => ({ ...prev, [field.key]: v }))}
                                            placeholder={field.placeholder}
                                            type={field.sensitive ? "password" : "text"}
                                        />
                                    )}
                                    {field.sensitive && isConfiguredField && (
                                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3 text-green-500" /> Configurado ({maskedValue}) — deixe vazio para manter
                                        </p>
                                    )}
                                    {field.sensitive && !isConfiguredField && (
                                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                                            <Lock className="w-2.5 h-2.5" /> Não configurado — digite o valor para definir
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Confirmation dialog for critical integrations */}
                    {showConfirmSave && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-charcoal/60 backdrop-blur-sm animate-fade-in">
                            <div className="bg-background border border-border rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 text-center">
                                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-4" strokeWidth={1.5} />
                                <p className="text-sm font-medium mb-1">Confirmar alteração</p>
                                <p className="text-xs text-muted-foreground mb-5">
                                    Deseja atualizar as credenciais desta integração?
                                </p>
                                <div className="flex flex-col gap-2">
                                    <button onClick={() => handleSave()} className="btn-gold w-full py-2.5 text-sm">
                                        Sim, salvar alterações
                                    </button>
                                    <button onClick={() => setShowConfirmSave(false)} className="btn-outline w-full py-2.5 text-sm">
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </AdminModal>
            )}
        </div>
    );
}
