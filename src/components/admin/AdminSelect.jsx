import React from "react";

export default function AdminSelect({ label, value, onChange, options, placeholder, description, error, required, disabled, full, children }) {
    return (
        <div className={full ? "sm:col-span-2" : ""}>
            {label && (
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    {label}{required && <span className="text-rose ml-1">*</span>}
                </label>
            )}
            <select
                value={value ?? ""}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className={`admin-field cursor-pointer ${error ? "border-rose" : ""}`}
            >
                {placeholder && <option value="">{placeholder}</option>}
                {options
                    ? options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))
                    : children}
            </select>
            {description && !error && <p className="text-[11px] text-muted-foreground mt-1.5">{description}</p>}
            {error && <p className="text-[11px] text-rose mt-1.5">{error}</p>}
        </div>
    );
}