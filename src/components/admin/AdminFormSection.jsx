import React from "react";

export default function AdminFormSection({ title, description, children, icon: Icon }) {
    return (
        <div className="border border-border rounded-xl p-5 bg-background/50">
            {title && (
                <div className="flex items-center gap-2 mb-1">
                    {Icon && <Icon className="w-4 h-4 text-accent" strokeWidth={1.5} />}
                    <h3 className="text-[11px] uppercase tracking-[0.2em] text-foreground font-medium">{title}</h3>
                </div>
            )}
            {description && <p className="text-xs text-muted-foreground mb-4">{description}</p>}
            <div className={title || description ? "mt-3" : ""}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
            </div>
        </div>
    );
}