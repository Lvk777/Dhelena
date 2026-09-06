import React from "react";

export default function AdminTextarea({ label, value, onChange, rows = 3, placeholder, description, error, required, full }) {
    return (
        <div className={full ? "sm:col-span-2" : ""}>
            {label && (
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    {label}{required && <span className="text-rose ml-1">*</span>}
                </label>
            )}
            <textarea
                value={value ?? ""}
                onChange={(e) => onChange(e.target.value)}
                rows={rows}
                placeholder={placeholder}
                className={`admin-field ${error ? "border-rose" : ""}`}
            />
            {description && !error && <p className="text-[11px] text-muted-foreground mt-1.5">{description}</p>}
            {error && <p className="text-[11px] text-rose mt-1.5">{error}</p>}
        </div>
    );
}