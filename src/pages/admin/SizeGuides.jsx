import React, { useState, useEffect } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, X } from "lucide-react";

const GUIDE_TYPES = ["Feminino padrão", "Vestidos", "Blusas", "Calças", "Conjuntos"];
const DEFAULT_ROWS = [
    { size: "PP", bust: "", waist: "", hip: "", low_waist: "", length: "" },
    { size: "P", bust: "", waist: "", hip: "", low_waist: "", length: "" },
    { size: "M", bust: "", waist: "", hip: "", low_waist: "", length: "" },
    { size: "G", bust: "", waist: "", hip: "", low_waist: "", length: "" },
    { size: "GG", bust: "", waist: "", hip: "", low_waist: "", length: "" },
];

export default function SizeGuides() {
    const [guides, setGuides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null); // guide being edited

    const load = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem("dhelena_access_token");
            const res = await fetch("/api/size-guides", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            const data = await res.json();
            setGuides(data || []);
        } catch { /* */ }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async (guide) => {
        const token = localStorage.getItem("dhelena_access_token");
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
        if (guide.id) {
            await fetch(`/api/size-guides/${guide.id}`, { method: "PATCH", headers, body: JSON.stringify(guide) });
        } else {
            await fetch("/api/size-guides", { method: "POST", headers, body: JSON.stringify(guide) });
        }
        setEditing(null);
        load();
    };

    const handleDelete = async (id) => {
        if (!confirm("Excluir este guia?")) return;
        const token = localStorage.getItem("dhelena_access_token");
        await fetch(`/api/size-guides/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        load();
    };

    if (editing) return <GuideEditor guide={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.04em]">Guias de Medidas</h1>
                <button onClick={() => setEditing({ name: "", type: "Feminino padrão", rows: DEFAULT_ROWS })} className="btn-gold px-4 py-2 text-sm flex items-center gap-2">
                    <Plus className="w-4 h-4" strokeWidth={1.5} /> Novo Guia
                </button>
            </div>

            {loading ? (
                <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin mx-auto" /></div>
            ) : guides.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum guia cadastrado.</p>
            ) : (
                <div className="space-y-3">
                    {guides.map(g => (
                        <div key={g.id} className="bg-background border border-border p-4 flex items-center justify-between">
                            <div>
                                <p className="font-medium text-sm">{g.name}</p>
                                <p className="text-[11px] text-muted-foreground">{g.type} · {g.rows?.length || 0} tamanhos</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setEditing(g)} className="text-[11px] uppercase tracking-[0.12em] text-foreground/70 hover:text-foreground border border-border px-3 py-1.5">Editar</button>
                                <button onClick={() => handleDelete(g.id)} className="text-muted-foreground hover:text-[hsl(var(--rose))] p-1.5"><Trash2 className="w-4 h-4" strokeWidth={1.25} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function GuideEditor({ guide, onSave, onCancel }) {
    const [name, setName] = useState(guide.name || "");
    const [type, setType] = useState(guide.type || "Feminino padrão");
    const [rows, setRows] = useState(guide.rows?.length ? guide.rows : DEFAULT_ROWS);

    const updateRow = (i, field, val) => {
        setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
    };
    const addRow = () => setRows(prev => [...prev, { size: "", bust: "", waist: "", hip: "", low_waist: "", length: "" }]);
    const removeRow = (i) => setRows(prev => prev.filter((_, idx) => idx !== i));
    const moveRow = (i, dir) => {
        setRows(prev => {
            const next = [...prev];
            const j = i + dir;
            if (j < 0 || j >= next.length) return prev;
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="font-heading text-2xl tracking-[0.04em]">{guide.id ? "Editar Guia" : "Novo Guia"}</h1>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4 max-w-2xl">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Nome</label>
                        <input value={name} onChange={e => setName(e.target.value)} className="w-full border border-border px-3 py-2 text-sm" placeholder="Ex: Feminino Padrão" />
                    </div>
                    <div>
                        <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-1.5">Tipo</label>
                        <select value={type} onChange={e => setType(e.target.value)} className="w-full border border-border px-3 py-2 text-sm bg-background">
                            {GUIDE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground block mb-2">Medidas (cm)</label>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 px-2 text-[10px] uppercase">Tamanho</th>
                                    <th className="text-left py-2 px-2 text-[10px] uppercase">Busto</th>
                                    <th className="text-left py-2 px-2 text-[10px] uppercase">Cintura</th>
                                    <th className="text-left py-2 px-2 text-[10px] uppercase">Quadril</th>
                                    <th className="text-left py-2 px-2 text-[10px] uppercase">Cint. Baixa</th>
                                    <th className="text-left py-2 px-2 text-[10px] uppercase">Compr.</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i} className="border-b border-border/50">
                                        <td className="py-1.5 px-2"><input value={r.size} onChange={e => updateRow(i, "size", e.target.value)} className="w-16 border border-border px-2 py-1 text-sm" /></td>
                                        <td className="py-1.5 px-2"><input value={r.bust || ""} onChange={e => updateRow(i, "bust", e.target.value)} className="w-20 border border-border px-2 py-1 text-sm" /></td>
                                        <td className="py-1.5 px-2"><input value={r.waist || ""} onChange={e => updateRow(i, "waist", e.target.value)} className="w-20 border border-border px-2 py-1 text-sm" /></td>
                                        <td className="py-1.5 px-2"><input value={r.hip || ""} onChange={e => updateRow(i, "hip", e.target.value)} className="w-20 border border-border px-2 py-1 text-sm" /></td>
                                        <td className="py-1.5 px-2"><input value={r.low_waist || ""} onChange={e => updateRow(i, "low_waist", e.target.value)} className="w-20 border border-border px-2 py-1 text-sm" /></td>
                                        <td className="py-1.5 px-2"><input value={r.length || ""} onChange={e => updateRow(i, "length", e.target.value)} className="w-20 border border-border px-2 py-1 text-sm" /></td>
                                        <td className="py-1.5 px-2">
                                            <div className="flex gap-0.5">
                                                <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => removeRow(i)} className="p-0.5 text-muted-foreground hover:text-[hsl(var(--rose))]"><X className="w-3.5 h-3.5" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button onClick={addRow} className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--gold))] flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar tamanho</button>
                </div>

                <div className="flex gap-3 pt-4">
                    <button onClick={() => onSave({ ...guide, name, type, rows })} disabled={!name} className="btn-gold px-6 py-2.5 text-sm disabled:opacity-40">Salvar Guia</button>
                    <button onClick={onCancel} className="btn-outline px-6 py-2.5 text-sm">Cancelar</button>
                </div>
            </div>
        </div>
    );
}
