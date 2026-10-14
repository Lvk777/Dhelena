import React from "react";
import { Check } from "lucide-react";
import { orderEventLabel } from '@/lib/orderTimeline';

// Maps order_events to a visual timeline
export default function OrderTimeline({ events = [], paymentStatus = null }) {
    if (!events || events.length === 0) return null;

    return (
        <div>
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-4">Linha do tempo</h3>
            <div className="space-y-0">
                {events.map((ev, i) => {
                    const label = orderEventLabel(ev, paymentStatus);
                    return (
                        <div key={ev.id || i} className="flex items-start gap-4">
                            <div className="flex flex-col items-center">
                                <div className="w-8 h-8 rounded-full border-2 border-[hsl(var(--gold))] bg-[hsl(var(--gold))] flex items-center justify-center shrink-0">
                                    <Check className="w-4 h-4 text-white" strokeWidth={2} />
                                </div>
                                {i < events.length - 1 && <div className="w-px h-8 bg-[hsl(var(--gold))]/40" />}
                            </div>
                            <div className="pb-8">
                                <p className="text-sm font-medium">{label}</p>
                                {ev.created_at && (
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        {new Date(ev.created_at).toLocaleString("pt-BR")}
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
