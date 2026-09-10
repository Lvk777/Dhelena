import React, { useState, useRef, useCallback, useEffect } from "react";
import {
    Upload, Loader2, X, ImageIcon, Check, AlertCircle,
    Monitor, Smartphone, RefreshCw, Trash2, Wand2, FileImage,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import CropperModal from "@/components/admin/CropperModal";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import {
    validateImageFile, loadImage, getDimensions, formatFileSize,
    cropAndResize, computeCropArea, blobToFile, generateMobileVersion,
    ASPECT_PRESETS, OUTPUT_DIMENSIONS, computeOutputSize,
} from "@/lib/imageProcessor";

/**
 * Reusable image uploader with crop, resize, preview, and metadata.
 *
 * Props:
 *  - label: string
 *  - value: string (image URL) or null
 *  - onChange: (url) => void
 *  - aspect: number (width/height) — used if no `preset`
 *  - preset: string (key into ASPECT_PRESETS, e.g. "home_hero")
 *  - description: string
 *  - error: string
 *  - full: boolean (full-width wrapper)
 *  - enableCrop: boolean (default true)
 *  - enableMobile: boolean — show mobile variant fields (default false)
 *  - mobileValue: string (mobile image URL) or null
 *  - onMobileChange: (url) => void
 *  - mobileAspect: number
 *  - required: boolean
 */

const UPLOAD_STATES = {
    IDLE: "idle",
    SELECTING: "selecting",
    UPLOADING: "uploading",
    PROCESSING: "processing",
    DONE: "done",
    ERROR: "error",
};

export default function AdminImageUploader({
    label,
    value,
    onChange,
    aspect = 16 / 9,
    preset = null,
    description,
    error,
    full,
    enableCrop = true,
    enableMobile = false,
    mobileValue,
    onMobileChange,
    mobileAspect,
    required = false,
}) {
    const [status, setStatus] = useState(UPLOAD_STATES.IDLE);
    const [statusMsg, setStatusMsg] = useState("");
    const [errorMsg, setErrorMsg] = useState("");
    const [fileInfo, setFileInfo] = useState(null); // { name, dimensions, size }
    const [pendingFile, setPendingFile] = useState(null);
    const [cropMode, setCropMode] = useState(null); // "desktop" | "mobile" | null
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const [removeTarget, setRemoveTarget] = useState(null); // "desktop" | "mobile"
    const [generatingMobile, setGeneratingMobile] = useState(false);
    const inputRef = useRef(null);
    const dragOverRef = useRef(false);
    const [dragOver, setDragOver] = useState(false);

    // Resolve aspect ratios
    const desktopAspect = preset ? (ASPECT_PRESETS[preset]?.desktop || aspect) : aspect;
    const resolvedMobileAspect = preset
        ? (ASPECT_PRESETS[preset]?.mobile || 4 / 5)
        : (mobileAspect || 4 / 5);

    const desktopOutput = computeOutputSize(desktopAspect, OUTPUT_DIMENSIONS.desktop);
    const mobileOutput = computeOutputSize(resolvedMobileAspect, OUTPUT_DIMENSIONS.mobile);

    // Load metadata when value changes (e.g. editing existing)
    useEffect(() => {
        if (value && !fileInfo) {
            // We don't have the original file, just show minimal info
            setFileInfo({ name: "imagem existente", dimensions: null, size: null });
        }
        if (!value) {
            setFileInfo(null);
            setStatus(UPLOAD_STATES.IDLE);
        }
    }, [value]);

    const handleFileSelected = useCallback(async (file) => {
        setErrorMsg("");
        setStatusMsg("");

        // Validate
        const validation = validateImageFile(file);
        if (!validation.valid) {
            setErrorMsg(validation.error);
            setStatus(UPLOAD_STATES.ERROR);
            setStatusMsg("Erro no upload");
            return;
        }

        setStatus(UPLOAD_STATES.SELECTING);
        setStatusMsg("Selecionando...");

        try {
            // Get dimensions
            const dims = await getDimensions(file);
            setFileInfo({
                name: file.name,
                dimensions: dims,
                size: file.size,
            });

            if (enableCrop) {
                // Open cropper
                setPendingFile(file);
                setCropMode("desktop");
                setStatus(UPLOAD_STATES.IDLE);
            } else {
                // No crop — just upload
                await uploadFile(file);
            }
        } catch (e) {
            console.error("Image load error:", e);
            setErrorMsg("Não foi possível carregar a imagem.");
            setStatus(UPLOAD_STATES.ERROR);
        }
    }, [enableCrop]);

    const uploadFile = useCallback(async (file) => {
        setStatus(UPLOAD_STATES.UPLOADING);
        setStatusMsg("Enviando...");
        try {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            onChange(file_url);
            setStatus(UPLOAD_STATES.DONE);
            setStatusMsg("Imagem anexada");
        } catch (e) {
            console.error("Upload error:", e);
            setErrorMsg("Erro ao enviar arquivo. Tente novamente.");
            setStatus(UPLOAD_STATES.ERROR);
        }
    }, [onChange]);

    const handleCropConfirm = useCallback(async (file, previewUrl, dimensions) => {
        // Close cropper
        setCropMode(null);
        setPendingFile(null);

        // Update file info with processed dimensions
        setFileInfo(prev => ({
            ...prev,
            dimensions: dimensions,
            size: file.size,
        }));

        await uploadFile(file);
    }, [uploadFile]);

    const handleCropCancel = useCallback(() => {
        setCropMode(null);
        setPendingFile(null);
        setStatus(UPLOAD_STATES.IDLE);
        setStatusMsg("");
    }, []);

    const handleRemove = useCallback((target) => {
        setShowRemoveConfirm(true);
        setRemoveTarget(target);
    }, []);

    const confirmRemove = useCallback(() => {
        if (removeTarget === "desktop") {
            onChange("");
            setFileInfo(null);
        } else if (removeTarget === "mobile" && onMobileChange) {
            onMobileChange("");
        }
        setStatus(UPLOAD_STATES.IDLE);
        setStatusMsg("");
        setErrorMsg("");
        setShowRemoveConfirm(false);
        setRemoveTarget(null);
    }, [removeTarget, onChange, onMobileChange]);

    const handleSwap = useCallback(() => {
        inputRef.current?.click();
    }, []);

    const handleGenerateMobile = useCallback(async () => {
        if (!value) return;
        setGeneratingMobile(true);
        try {
            const { blob, ext } = await generateMobileVersion(
                value,
                resolvedMobileAspect,
                mobileOutput.width,
                mobileOutput.height
            );
            const file = blobToFile(blob, "mobile-version", ext);
            setStatus(UPLOAD_STATES.UPLOADING);
            setStatusMsg("Gerando versão mobile...");
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            onMobileChange(file_url);
            setStatus(UPLOAD_STATES.DONE);
            setStatusMsg("Imagem anexada");
        } catch (e) {
            console.error("Mobile generation error:", e);
            setErrorMsg("Erro ao gerar versão mobile.");
            setStatus(UPLOAD_STATES.ERROR);
        } finally {
            setGeneratingMobile(false);
        }
    }, [value, resolvedMobileAspect, mobileOutput, onMobileChange]);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelected(file);
    }, [handleFileSelected]);

    const handleInputChange = (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelected(file);
        e.target.value = "";
    };

    const isBusy = status === UPLOAD_STATES.UPLOADING || status === UPLOAD_STATES.PROCESSING || generatingMobile;

    // Render a single image slot (desktop or mobile)
    const renderSlot = ({ slotValue, slotOnChange, slotAspect, slotLabel, slotIcon: Icon, isMobile = false }) => {
        const hasImage = !!slotValue;

        return (
            <div className={full ? "sm:col-span-2" : ""}>
                {slotLabel && (
                    <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Icon className="w-3 h-3" strokeWidth={1.5} /> {slotLabel}
                        {required && !isMobile && <span className="text-rose">*</span>}
                    </label>
                )}

                {hasImage ? (
                    /* --- Image attached state --- */
                    <div className="rounded-lg border border-border overflow-hidden bg-bone">
                        {/* Preview */}
                        <div className="relative" style={{ aspectRatio: String(slotAspect) }}>
                            <img src={slotValue} alt={slotLabel || "preview"} className="w-full h-full object-cover" />
                            {status === UPLOAD_STATES.DONE && !isMobile && (
                                <div className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded flex items-center gap-1">
                                    <Check className="w-2.5 h-2.5" strokeWidth={2} /> Anexada
                                </div>
                            )}
                            {status === UPLOAD_STATES.UPLOADING && !isMobile && (
                                <div className="absolute inset-0 bg-charcoal/50 flex items-center justify-center">
                                    <div className="flex items-center gap-2 text-white text-xs">
                                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        {statusMsg}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Metadata bar */}
                        <div className="px-3 py-2.5 space-y-1 bg-background border-t border-border">
                            {fileInfo && !isMobile && (
                                <>
                                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <FileImage className="w-3 h-3" strokeWidth={1.5} />
                                        <span className="truncate flex-1">{fileInfo.name}</span>
                                    </div>
                                    <div className="flex gap-3 text-[10px] text-muted-foreground/80">
                                        {fileInfo.dimensions && (
                                            <span>{fileInfo.dimensions.width}×{fileInfo.dimensions.height}px</span>
                                        )}
                                        {fileInfo.size && (
                                            <span>{formatFileSize(fileInfo.size)}</span>
                                        )}
                                        <span className="text-foreground/60">WEBP</span>
                                    </div>
                                </>
                            )}
                            {isMobile && (
                                <p className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
                                    <Smartphone className="w-3 h-3" /> Versão mobile
                                </p>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={handleSwap}
                                    disabled={isBusy}
                                    className="flex-1 text-[10px] uppercase tracking-[0.1em] py-1.5 border border-border rounded hover:bg-muted transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                                >
                                    <RefreshCw className="w-3 h-3" strokeWidth={1.5} /> Trocar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleRemove(isMobile ? "mobile" : "desktop")}
                                    disabled={isBusy}
                                    className="flex-1 text-[10px] uppercase tracking-[0.1em] py-1.5 border border-rose/30 text-rose rounded hover:bg-rose/5 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                                >
                                    <Trash2 className="w-3 h-3" strokeWidth={1.5} /> Remover
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* --- Empty state / drop zone --- */
                    <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => !isBusy && inputRef.current?.click()}
                        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                            dragOver
                                ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5"
                                : "border-border hover:border-foreground/30"
                        } ${isBusy ? "pointer-events-none opacity-60" : ""}`}
                        style={{ aspectRatio: String(slotAspect) }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    >
                        {isBusy ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <span className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                                <p className="text-xs text-muted-foreground">{statusMsg || "Processando..."}</p>
                            </div>
                        ) : status === UPLOAD_STATES.ERROR && !isMobile ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <AlertCircle className="w-6 h-6 text-rose" strokeWidth={1.5} />
                                <p className="text-xs text-rose">{errorMsg}</p>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                                    className="text-[10px] text-muted-foreground underline"
                                >
                                    Tentar novamente
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <Upload className="w-6 h-6 text-muted-foreground" strokeWidth={1.25} />
                                <p className="text-xs text-foreground">
                                    {isMobile ? "Enviar imagem mobile" : "Enviar imagem"}
                                </p>
                                <p className="text-[10px] text-muted-foreground">ou arraste aqui</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={full ? "sm:col-span-2" : ""}>
            {label && !enableMobile && (
                <label className="block text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    {label}{required && <span className="text-rose">*</span>}
                </label>
            )}

            {enableMobile ? (
                <div className="space-y-5">
                    {/* Desktop slot */}
                    {renderSlot({
                        slotValue: value,
                        slotOnChange: onChange,
                        slotAspect: desktopAspect,
                        slotLabel: "Imagem Desktop" + (required ? " (obrigatória)" : ""),
                        slotIcon: Monitor,
                    })}

                    {/* Mobile slot */}
                    {renderSlot({
                        slotValue: mobileValue,
                        slotOnChange: onMobileChange,
                        slotAspect: resolvedMobileAspect,
                        slotLabel: "Imagem Mobile",
                        slotIcon: Smartphone,
                        isMobile: true,
                    })}

                    {/* Generate mobile button */}
                    {value && !mobileValue && (
                        <button
                            type="button"
                            onClick={handleGenerateMobile}
                            disabled={generatingMobile}
                            className="btn-outline w-full py-2.5 text-xs flex items-center justify-center gap-1.5"
                        >
                            {generatingMobile ? (
                                <>
                                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    Gerando versão mobile...
                                </>
                            ) : (
                                <>
                                    <Wand2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    Gerar versão mobile
                                </>
                            )}
                        </button>
                    )}

                    {/* Fallback warning */}
                    {value && !mobileValue && (
                        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={1.5} />
                            Imagem mobile não enviada. A versão desktop será adaptada automaticamente.
                        </p>
                    )}
                </div>
            ) : (
                renderSlot({
                    slotValue: value,
                    slotOnChange: onChange,
                    slotAspect: desktopAspect,
                    slotLabel: label,
                    slotIcon: ImageIcon,
                })
            )}

            {description && <p className="text-[11px] text-muted-foreground mt-1.5">{description}</p>}
            {error && <p className="text-xs text-rose mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>}

            {/* Hidden file input */}
            <input
                ref={inputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleInputChange}
            />

            {/* Cropper modal */}
            {cropMode && pendingFile && (
                <CropperModal
                    imageFile={pendingFile}
                    aspect={cropMode === "desktop" ? desktopAspect : resolvedMobileAspect}
                    outputSize={cropMode === "desktop" ? desktopOutput : mobileOutput}
                    title={cropMode === "desktop" ? "Ajustar Imagem — Desktop" : "Ajustar Imagem — Mobile"}
                    onConfirm={handleCropConfirm}
                    onCancel={handleCropCancel}
                />
            )}

            {/* Remove confirmation */}
            <AdminConfirmDialog
                open={showRemoveConfirm}
                onClose={() => { setShowRemoveConfirm(false); setRemoveTarget(null); }}
                onConfirm={confirmRemove}
                title="Remover imagem"
                message="Deseja remover esta imagem?"
                confirmLabel="Remover"
            />
        </div>
    );
}
