import React, { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Star, X, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import AddressFields from "@/components/AddressFields";
import { validateCEP } from "@/lib/forms";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";

export default function Addresses() {
    const [addresses, setAddresses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const load = () => {
        setLoading(true);
        base44.entities.Address.list("-created_date", 50)
            .then(setAddresses)
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const setPrimary = async (id) => {
        // Unset all, then set the chosen one
        for (const a of addresses) {
            if (a.is_primary) await base44.entities.Address.update(a.id, { is_primary: false });
        }
        await base44.entities.Address.update(id, { is_primary: true });
        load();
    };

    const confirmDelete = async () => {
        setDeleting(true);
        try { await base44.entities.Address.delete(deleteTarget.id); setDeleteTarget(null); load(); }
        catch { } finally { setDeleting(false); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-3xl tracking-[0.03em]">Meus endereços</h1>
                <button onClick={() => setEditing({})} className="btn-ghost text-[hsl(var(--rose))]">
                    <Plus className="w-4 h-4" strokeWidth={1.5} /> Novo endereço
                </button>
            </div>

            {loading ? (
                <div className="h-32 bg-bone animate-pulse" />
            ) : addresses.length === 0 ? (
                <div className="bg-[hsl(var(--bone))] p-12 text-center">
                    <MapPin className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground">Você ainda não cadastrou endereços.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {addresses.map((a) => (
                        <div key={a.id} className="bg-[hsl(var(--bone))] p-6">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    {a.is_primary && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--gold))] mb-2"><Star className="w-3 h-3 fill-[hsl(var(--gold))]" strokeWidth={0} /> Principal</span>}
                                    <p className="text-sm font-medium">{a.street}, {a.number}{a.complement ? ` - ${a.complement}` : ""}</p>
                                    <p className="text-sm text-muted-foreground mt-1">{a.district} · {a.city}/{a.state}</p>
                                    <p className="text-[11px] text-muted-foreground mt-1">CEP {a.cep}</p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button onClick={() => setEditing(a)} className="p-2 hover:bg-background transition-colors" aria-label="Editar"><Pencil className="w-4 h-4" strokeWidth={1.25} /></button>
                                    <button onClick={() => setDeleteTarget(a)} className="p-2 hover:bg-background transition-colors" aria-label="Excluir"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                                </div>
                            </div>
                            {!a.is_primary && (
                                <button onClick={() => setPrimary(a.id)} className="btn-ghost text-xs mt-4">Definir como principal</button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {editing && <AddressForm address={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

            <AdminConfirmDialog
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Excluir endereço"
                message="Você está prestes a excluir este endereço."
                confirmLabel="Excluir"
                loading={deleting}
            />
        </div>
    );
}

function AddressForm({ address, onClose, onSaved }) {
    const [form, setForm] = useState({
        label: address.label || "",
        cep: address.cep || "",
        street: address.street || "",
        number: address.number || "",
        complement: address.complement || "",
        district: address.district || "",
        city: address.city || "",
        state: address.state || "SP",
        is_primary: address.is_primary || false,
    });
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState({});

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const save = async () => {
        const e = {};
        if (!validateCEP(form.cep)) e.cep = "Informe um CEP válido";
        if (!form.street.trim()) e.street = "Informe a rua";
        if (!form.number.trim()) e.number = "Informe o número";
        if (!form.district.trim()) e.district = "Informe o bairro";
        if (!form.city.trim()) e.city = "Informe a cidade";
        setErrors(e);
        if (Object.keys(e).length > 0) return;
        setSaving(true);
        try {
            if (address.id) {
                await base44.entities.Address.update(address.id, form);
            } else {
                await base44.entities.Address.create(form);
            }
            onSaved();
        } catch (e) {
            console.error("Erro ao salvar endereço:", e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-background w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="font-heading text-2xl">{address.id ? "Editar endereço" : "Novo endereço"}</h2>
                    <button onClick={onClose}><X className="w-5 h-5" strokeWidth={1.25} /></button>
                </div>
                <AddressFields form={form} set={set} errors={errors} />
                <button onClick={save} disabled={saving} className="btn-gold w-full mt-6">{saving ? "Salvando..." : "Salvar endereço"}</button>
            </div>
        </div>
    );
}