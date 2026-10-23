import React from "react";

export default function AdminToggle({ label, checked, onChange, description = "", icon: Icon = null }) {
    return (
        <div className="flex items-start justify-between gap-4 py-1.5">
            <div className="min-w-0">
                {label && <p className="text-sm font-medium flex items-center gap-2">{Icon && <Icon className="w-4 h-4 text-accent" strokeWidth={1.5} />}{label}</p>}
                {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
            </div>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? "bg-accent" : "bg-muted"}`}
                aria-label={label || "toggle"}
            >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : ""}`} />
            </button>
        </div>
    );
}
