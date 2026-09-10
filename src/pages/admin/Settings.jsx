import React, { useState, useEffect, useMemo } from "react";
import { Store, ShoppingBag, MapPin, Truck, CreditCard, Mail, Share2, Search, FileText, Server, Save, Loader2, Check, AlertCircle, Shield, History, Menu, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import GeneralTab from "@/components/admin/settings/GeneralTab";
import { logAdminAction } from "@/lib/audit";
import StoreTab from "@/components/admin/settings/StoreTab";
import AddressTab from "@/components/admin/settings/AddressTab";
import ShippingTab from "@/components/admin/settings/ShippingTab";
import PaymentsTab from "@/components/admin/settings/PaymentsTab";
import EmailsTab from "@/components/admin/settings/EmailsTab";
import SocialTab from "@/components/admin/settings/SocialTab";
import SeoTab from "@/components/admin/settings/SeoTab";
import PoliciesTab from "@/components/admin/settings/PoliciesTab";
import SystemTab from "@/components/admin/settings/SystemTab";
import SecurityTab from "@/components/admin/settings/SecurityTab";
import LoginHistoryTab from "@/components/admin/settings/LoginHistoryTab";

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

const SECTIONS = [
    { key: "general", label: "Geral", icon: Store, component: GeneralTab },
    { key: "store", label: "Loja", icon: ShoppingBag, component: StoreTab },
    { key: "address", label: "Endereço", icon: MapPin, component: AddressTab },
    { key: "shipping", label: "Entrega", icon: Truck, component: ShippingTab },
    { key: "payments", label: "Pagamentos", icon: CreditCard, component: PaymentsTab },
    { key: "emails", label: "E-mails", icon: Mail, component: EmailsTab },
    { key: "social", label: "Redes Sociais", icon: Share2, component: SocialTab },
    { key: "seo", label: "SEO", icon: Search, component: SeoTab },
    { key: "policies", label: "Políticas", icon: FileText, component: PoliciesTab },
    { key: "system", label: "Sistema", icon: Server, component: SystemTab },
    { key: "security", label: "Segurança", icon: Shield, component: SecurityTab },
    { key: "login_history", label: "Histórico de Login", icon: History, component: LoginHistoryTab },
];

// Sections that don't use the standard settings save flow
const NON_SETTING_SECTIONS = ["security", "login_history"];

export default function Settings() {
    const [activeSection, setActiveSection] = useState("general");
    const [settings, setSettings] = useState({});
    const [recordIds, setRecordIds] = useState({});
    const [originalSettings, setOriginalSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedMessage, setSavedMessage] = useState("");
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => { loadSettings(); }, []);

    const isNonSetting = NON_SETTING_SECTIONS.includes(activeSection);
    const hasChanges = useMemo(() => !isNonSetting && JSON.stringify(settings) !== JSON.stringify(originalSettings), [settings, originalSettings, isNonSetting]);

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

    const ActiveComponent = SECTIONS.find((s) => s.key === activeSection)?.component;

    const Sidebar = () => (
        <nav className="flex-1 py-2 overflow-y-auto admin-settings-nav">
            {SECTIONS.map((section) => (
                <button
                    key={section.key}
                    onClick={() => { setActiveSection(section.key); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-3 w-full px-4 py-2.5 text-[13px] transition-colors text-left ${
                        activeSection === section.key
                            ? "bg-[hsl(var(--bone))] text-foreground font-medium border-l-2 border-[hsl(var(--gold))]"
                            : "text-foreground/65 hover:text-foreground hover:bg-[hsl(var(--bone))]/50"
                    }`}
                >
                    <section.icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{section.label}</span>
                </button>
            ))}
        </nav>
    );

    return (
        <div>
            <h1 className="font-heading text-2xl tracking-[0.03em] mb-6">Configurações</h1>

            <div className="flex gap-6">
                {/* Desktop sidebar */}
                <aside className="hidden lg:flex w-56 flex-col bg-background border border-border rounded-lg shrink-0 self-start sticky top-2 max-h-[calc(100vh-6rem)]">
                    <Sidebar />
                </aside>

                {/* Mobile select trigger */}
                <div className="lg:hidden w-full mb-4">
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="flex items-center justify-between w-full px-4 py-3 bg-background border border-border rounded-lg text-sm"
                    >
                        <span className="flex items-center gap-2">
                            {(() => { const s = SECTIONS.find(s => s.key === activeSection); return s ? <><s.icon className="w-4 h-4" strokeWidth={1.5} /> {s.label}</> : null; })()}
                        </span>
                        <Menu className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                    {mobileMenuOpen && (
                        <div className="absolute z-40 mt-1 w-[calc(100%-2rem)] bg-background border border-border rounded-lg shadow-lg">
                            <div className="flex justify-end p-2">
                                <button onClick={() => setMobileMenuOpen(false)}><X className="w-4 h-4" strokeWidth={1.5} /></button>
                            </div>
                            <div className="pb-2">
                                {SECTIONS.map((section) => (
                                    <button
                                        key={section.key}
                                        onClick={() => { setActiveSection(section.key); setMobileMenuOpen(false); }}
                                        className={`flex items-center gap-3 w-full px-4 py-2.5 text-[13px] transition-colors text-left ${
                                            activeSection === section.key ? "bg-[hsl(var(--bone))] text-foreground font-medium" : "text-foreground/65 hover:text-foreground hover:bg-[hsl(var(--bone))]/50"
                                        }`}
                                    >
                                        <section.icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                                        <span>{section.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Content area */}
                <div className="flex-1 min-w-0">
                    {loading ? (
                        <div className="h-64 bg-background animate-pulse rounded-lg" />
                    ) : (
                        <div className="max-w-2xl">
                            {ActiveComponent && <ActiveComponent data={settings[activeSection] || {}} onChange={(data) => updateSection(activeSection, data)} />}
                        </div>
                    )}
                </div>
            </div>

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
