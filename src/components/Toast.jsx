import React from "react";
import { useStore } from "@/context/StoreContext";
import { Check, X } from "lucide-react";

export default function Toast() {
    const { toast } = useStore();
    if (!toast) return null;
    const isError = toast.type === 'error';
    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] animate-fade-rise">
            <div className="flex items-center gap-2 bg-[hsl(var(--charcoal))] text-bone px-5 py-3 shadow-lg text-sm tracking-wide">
                {isError
                    ? <X className="w-4 h-4 text-red-400" strokeWidth={2} />
                    : <Check className="w-4 h-4 text-[hsl(var(--gold))]" strokeWidth={1.5} />
                }
                <span>{toast.message}</span>
            </div>
        </div>
    );
}
