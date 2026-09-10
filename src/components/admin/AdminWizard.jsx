import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Check, X, AlertTriangle } from "lucide-react";

/**
 * Reusable multi-step wizard for admin forms.
 *
 * Props:
 *  - title:       string — wizard title shown in header
 *  - subtitle:    string — optional subtitle
 *  - icon:        lucide icon component
 *  - steps:       array of { id, label, icon? } — step definitions
 *  - validateStep:(stepIndex) => object | null — returns error map or null if valid
 *  - onSave:      (status) => Promise<void> — called on final step
 *  - onClose:     () => void — called when user closes
 *  - saveLabel:   string — label for final save button (default "Salvar")
 *  - draftLabel:  string | null — if provided, shows "save draft" button
 *  - onSaveDraft: (status) => Promise<void> — called when draft is saved
 *  - saving:      boolean — disables buttons while saving
 *  - children:    render-prop: (step, formProps) => ReactNode — renders current step
 *
 * Features:
 *  - Step progress bar (horizontal on desktop, compact on mobile)
 *  - Per-step validation before advancing
 *  - Data preservation across steps (parent owns state)
 *  - Unsaved changes warning on close
 *  - Dark/light mode compatible via theme tokens
 */
export default function AdminWizard({
    title,
    subtitle,
    icon: Icon,
    steps = [],
    validateStep,
    onSave,
    onClose,
    saveLabel = "Salvar",
    draftLabel,
    onSaveDraft,
    saving = false,
    children,
}) {
    const [currentStep, setCurrentStep] = useState(0);
    const [stepErrors, setStepErrors] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const scrollRef = useRef(null);

    const isLastStep = currentStep === steps.length - 1;

    // Scroll to top on step change
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [currentStep]);

    const handleNext = () => {
        const errors = validateStep ? validateStep(currentStep) : null;
        if (errors && Object.keys(errors).length > 0) {
            setStepErrors(errors);
            return;
        }
        setStepErrors(null);
        setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
    };

    const handleBack = () => {
        setStepErrors(null);
        setCurrentStep((s) => Math.max(s - 1, 0));
    };

    const handleSave = () => {
        const errors = validateStep ? validateStep(currentStep) : null;
        if (errors && Object.keys(errors).length > 0) {
            setStepErrors(errors);
            return;
        }
        onSave?.("published");
    };

    const handleDraft = () => {
        onSaveDraft?.("draft");
    };

    const handleClose = () => {
        if (dirty) {
            setShowCloseConfirm(true);
        } else {
            onClose?.();
        }
    };

    // Mark dirty on any render after first mount
    useEffect(() => { setDirty(true); }, []);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={handleClose} />

            {/* Wizard container */}
            <div className="relative bg-background w-full sm:max-w-4xl max-h-[100vh] sm:max-h-[92vh] rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col animate-fade-rise overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-border shrink-0">
                    <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                            {Icon && (
                                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                                    <Icon className="w-5 h-5 text-accent" strokeWidth={1.5} />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h2 className="font-heading text-xl tracking-wide truncate">{title}</h2>
                                {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
                            </div>
                        </div>
                        <button onClick={handleClose} className="p-2 hover:bg-muted rounded-lg transition-colors shrink-0" aria-label="Fechar">
                            <X className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                    </div>

                    {/* Step progress — desktop horizontal */}
                    <div className="hidden sm:flex items-center gap-1 mt-5">
                        {steps.map((step, i) => {
                            const isActive = i === currentStep;
                            const isDone = i < currentStep;
                            const StepIcon = step.icon;
                            return (
                                <React.Fragment key={step.id}>
                                    {i > 0 && (
                                        <div className={`h-px flex-1 min-w-[12px] transition-colors ${isDone ? "bg-accent" : "bg-border"}`} />
                                    )}
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium border-2 transition-all ${
                                            isActive ? "border-accent bg-accent text-background"
                                            : isDone ? "border-accent bg-accent/10 text-accent"
                                            : "border-border text-muted-foreground"
                                        }`}>
                                            {isDone ? <Check className="w-3.5 h-3.5" strokeWidth={2} /> : StepIcon ? <StepIcon className="w-3.5 h-3.5" /> : i + 1}
                                        </div>
                                        <span className={`text-[11px] uppercase tracking-[0.1em] whitespace-nowrap ${isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                            {step.label}
                                        </span>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>

                    {/* Step progress — mobile compact */}
                    <div className="sm:hidden mt-3">
                        <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                            Etapa {currentStep + 1} de {steps.length}
                        </p>
                        <p className="text-sm font-medium mt-0.5">{steps[currentStep]?.label}</p>
                        <div className="flex gap-1 mt-2">
                            {steps.map((_, i) => (
                                <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= currentStep ? "bg-accent" : "bg-border"}`} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Body — scrollable */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto admin-scroll px-6 py-5">
                    {typeof children === "function"
                        ? children(steps[currentStep], { currentStep, stepErrors, setStepErrors })
                        : children}
                </div>

                {/* Footer — sticky */}
                <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 shrink-0 bg-background">
                    <div className="flex gap-2">
                        <button
                            onClick={handleBack}
                            disabled={currentStep === 0}
                            className="btn-ghost flex items-center gap-1.5 disabled:opacity-30 disabled:pointer-events-none"
                        >
                            <ChevronLeft className="w-4 h-4" strokeWidth={1.5} /> Voltar
                        </button>
                        {draftLabel && !isLastStep && (
                            <button onClick={handleDraft} disabled={saving} className="btn-outline text-sm">
                                {draftLabel}
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {isLastStep ? (
                            <button onClick={handleSave} disabled={saving} className="btn-gold flex items-center gap-1.5">
                                {saving ? <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" /> : <Check className="w-4 h-4" strokeWidth={1.5} />}
                                {saveLabel}
                            </button>
                        ) : (
                            <button onClick={handleNext} className="btn-gold flex items-center gap-1.5">
                                Próximo <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Unsaved changes confirmation */}
                {showCloseConfirm && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-charcoal/60 backdrop-blur-sm animate-fade-in">
                        <div className="bg-background border border-border rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 text-center">
                            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-4" strokeWidth={1.5} />
                            <p className="text-sm font-medium mb-1">Você tem alterações não salvas.</p>
                            <p className="text-xs text-muted-foreground mb-5">Se sair agora, as alterações serão perdidas.</p>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => setShowCloseConfirm(false)} className="btn-gold w-full py-2.5 text-sm">
                                    Continuar editando
                                </button>
                                <button onClick={() => { setShowCloseConfirm(false); onClose?.(); }} className="btn-outline w-full py-2.5 text-sm">
                                    Sair sem salvar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
