import React, { useState, useEffect, useMemo } from "react";
import { Store, ShoppingBag, MapPin, Truck, CreditCard, Plug, Mail, Share2, Search, FileText, Server, Save, Loader2, Check, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import GeneralTab from "@/components/admin/settings/GeneralTab";
import { logAdminAction } from "@/lib/audit";
import StoreTab from "@/components/admin/settings/StoreTab";
import AddressTab from "@/components/admin/settings/AddressTab";
import ShippingTab from "@/components/admin/settings/ShippingTab";
import PaymentsTab from "@/components/admin/settings/PaymentsTab";
import IntegrationsTab from "@/components/admin/settings/IntegrationsTab";
import EmailsTab from "@/components/admin/settings/EmailsTab";
import SocialTab from "@/components/admin/settings/SocialTab";
import SeoTab from "@/components/admin/settings/SeoTab";
import PoliciesTab from "@/components/admin/settings/PoliciesTab";
import SystemTab from "@/components/admin/settings/SystemTab";

const DEFAULTS = {
    general: { store_name: "D'Helenas", trade_name: "", company_name: "", cnpj: "", email: "", phone: "", whatsapp: "", logo: "", logo_dark: "", favicon: "", currency: "BRL", timezone: "America/Sao_Paulo" },
    store: { top_bar_text: "Frete grátis acima de R$ 499 · Parcelamos em até 6x", free_shipping_threshold: 499, max_installments: 6, interest_free_installments: 6, allow_out_of_stock: false, show_low_stock: true, low_stock_threshold: 3 },
    address: { cep: "", street: "", number: "", complement: "", district: "", city: "", state: "SP" },
    shipping: { pickup_enabled: true, pickup_name: "Retirada na boutique", pickup_instructions: "", pickup_time: "", free_shipping_enabled: true, free_shipping_threshold: 499, melhor_envio_enabled: false, melhor_envio_mode: "sandbox" },
    payments: { mercado_pago_enabled: false, mercado_pago_mode: "sandbox", pix_enabled: true, card_enabled: true, boleto_enabled: false, max_installments: 6, interest_free_installments: 6, pix_discount: 5 },
    emails: { sender_name: "D'Helenas", sender_email: "", reply_to: "", order_received: true, payment_approved: true, order_separation: true, order_shipped: true, order_delivered: true, order_cancelled: true },
    social: { instagram: "", facebook: "", tiktok: "", whatsapp: "" },
    seo: { default_title: "D'Helenas — Boutique Digital", default_description: "", sharing_image: "", ga_id: "", meta_pixel_id: "" },
    policies: { return_policy: "", privacy_policy: "", terms_of_use: "", shipping_policy: "" },
};

const PUBLIC_KEYS = ["general", "store", "shipping", "social", "seo", "policies"];

const TABS = [
    { key: "general", label: "Geral", icon: Store, component: GeneralTab },
    { key: "store", label: "Loja", icon: ShoppingBag, component: StoreTab },
    { key: "address", label: "Endereço", icon: MapPin, component: AddressTab },
    { key: "shipping", label: "Entrega", icon: Truck, component: ShippingTab },
    { key: "payments", label: "Pagamentos", icon: CreditCard, component: PaymentsTab },
    { key: "integrations", label: "Integrações", icon: Plug, component: IntegrationsTab },
    { key: "emails", label: "E-mails", icon: Mail, component: EmailsTab },
    { key: "social", label: "Redes Sociais", icon: Share2, component: SocialTab },
    { key: "seo", label: "SEO", icon: Search, component: SeoTab },
    { key: "policies", label: "Políticas", icon: FileText, component: PoliciesTab },
    { key: "system", label: "Sistema", icon: Server, component: SystemTab },
];

export default function Settings() {
    const [activeTab, setActiveTab] = useState("general");
    const [settings, setSettings] = useState({});
    const [recordIds, setRecordIds] = useState({});
    const [originalSettings, setOriginalSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedMessage, setSavedMessage] = useState("");

    useEffect(() => { loadSettings(); }, []);

    const hasChanges = useMemo(() => JSON.stringify(settings) !== JSON.stringify(originalSettings), [settings, originalSettings]);

    useEffect(() => {
        const handler = (e) => { if (hasChanges) { e.preventDefault(); e.returnValue = ""; } };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasChanges]);

    const loadSettings = async () => {
        try {
            const records = await base44.entities.Setting.list();
            const ids = {}, data = {};
            records.forEach((r) => { ids[r.key] = r.id; data[r.key] = r.value; });
            const merged = {};
            for (const key of Object.keys(DEFAULTS)) {
                merged[key] = { ...DEFAULTS[key], ...(data[key] || {}) };
            }
            setSettings(merged);
            setRecordIds(ids);
            setOriginalSettings(JSON.parse(JSON.stringify(merged)));
        } catch {
            const merged = { ...DEFAULTS };
            setSettings(merged);
            setOriginalSettings(JSON.parse(JSON.stringify(merged)));
        } finally {
            setLoading(false);
        }
    };

    const updateSection = (key, data) => setSettings((s) => ({ ...s, [key]: data }));

    const save = async () => {
        setSaving(true);
        try {
            for (const key of Object.keys(DEFAULTS)) {
                if (JSON.stringify(settings[key]) === JSON.stringify(originalSettings[key])) continue;
                if (recordIds[key]) {
                    await base44.entities.Setting.update(recordIds[key], { value: settings[key] });
                } else {
                    const rec = await base44.entities.Setting.create({ key, value: settings[key], is_public: PUBLIC_KEYS.includes(key) });
                    recordIds[key] = rec.id;
                }
            }
            setOriginalSettings(JSON.parse(JSON.stringify(settings)));
            setRecordIds({ ...recordIds });
            setSavedMessage("Alterações salvas com sucesso.");
            await logAdminAction("settings_update", "Setting", "", "Configurações", "Configurações da loja atualizadas");
            setTimeout(() => setSavedMessage(""), 3000);
        } catch (e) {
            console.error("Erro ao salvar configurações:", e);
        } finally {
            setSaving(false);
        }
    };

    const ActiveComponent = TABS.find((t) => t.key === activeTab)?.component;

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Configurações</h1>

            {/* Tabs */}
            <div className="flex gap-1 overflow-x-auto no-scrollbar mb-6 border-b border-border -mx-1 px-1">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${activeTab === tab.key ? "border-accent text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                    >
                        <tab.icon className="w-4 h-4" strokeWidth={1.5} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading ? (
                <div className="h-64 bg-background animate-pulse rounded-lg" />
            ) : (
                <div className="max-w-3xl">
                    {ActiveComponent && <ActiveComponent data={settings[activeTab] || {}} onChange={(data) => updateSection(activeTab, data)} />}
                </div>
            )}

            {/* Save bar */}
            {hasChanges && !loading && (
                <div className="sticky bottom-0 left-0 right-0 bg-background border-t border-border p-4 flex items-center justify-between gap-4 mt-6 -mx-5 lg:-mx-8 px-5 lg:px-8 shadow-lg z-10">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-accent" strokeWidth={1.5} /> Existem alterações não salvas
                    </p>
                    <button onClick={save} disabled={saving} className="btn-gold">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" strokeWidth={1.5} />} Salvar alterações
                    </button>
                </div>
            )}

            {/* Success message */}
            {savedMessage && (
                <div className="fixed bottom-6 right-6 z-50 bg-foreground text-background px-5 py-3 rounded-lg shadow-xl flex items-center gap-2 animate-fade-rise">
                    <Check className="w-4 h-4" strokeWidth={2} /> {savedMessage}
                </div>
            )}
        </div>
    );
}