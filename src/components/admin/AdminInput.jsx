import React from "react";

export default function AdminInput({ label, value, onChange, type = "text", placeholder = "", description = "", error = "", required = false, disabled = false, full = false, icon: Icon = null, mono = false, min = undefined, max = undefined, step = undefined }) {
    const id = React.useId();
    return (
        <div className={full ? "sm:col-span-2" : ""}>
            {label && (
                <label htmlFor={id} className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    {label}{required && <span className="text-rose-ink ml-1">*</span>}
                </label>
            )}
            <div className="relative">
                {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" strokeWidth={1.5} />}
                <input
                    id={id}
                    aria-invalid={!!error}
                    aria-describedby={description || error ? `${id}-feedback` : undefined}
                    type={type}
                    value={value ?? ""}
                    onChange={(e) => onChange(type === "number" ? e.target.value : e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    min={min}
                    max={max}
                    step={step}
                    className={`admin-field ${Icon ? "pl-10" : ""} ${mono ? "font-mono" : ""} ${error ? "border-rose" : ""}`}
                />
            </div>
            {description && !error && <p id={`${id}-feedback`} className="text-[11px] text-muted-foreground mt-1.5">{description}</p>}
            {error && <p id={`${id}-feedback`} role="alert" className="text-[11px] text-rose-ink mt-1.5">{error}</p>}
        </div>
    );
}
