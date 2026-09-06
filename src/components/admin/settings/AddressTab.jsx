import React from "react";
import { MapPin } from "lucide-react";
import AddressFields from "@/components/AddressFields";

export default function AddressTab({ data, onChange }) {
    const set = (k, v) => onChange({ ...data, [k]: v });
    return (
        <div className="space-y-5">
            <div className="border border-border rounded-xl p-5 bg-background/50">
                <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-4 h-4 text-accent" strokeWidth={1.5} />
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">Endereço da loja</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-4">Este endereço será usado como origem para cálculo de frete</p>
                <AddressFields form={data} set={set} errors={{}} />
            </div>
        </div>
    );
}