import React, { useState, useRef, useId, useCallback, useEffect } from "react";
import {
    Upload, X, Check, AlertCircle, RefreshCw, Trash2, Crop as CropIcon,
    Image as ImageIcon, Loader2,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import CropperModal from "@/components/admin/CropperModal";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import {
    validateImageFile, getDimensions, formatFileSize, formatAspectRatio,
    cropAndResize, computeCropArea, blobToFile, generateMobileVersion,
    IMAGE_PRESETS, computeOutputSize, BANNER_POSITION_PRESETS,
} from "@/lib/imageProcessor";

/**
 * Reusable single-image uploader with crop, resize, preview, and metadata.
 * Each instance is fully independent — its own state, input, and ID.
 *
 * Props:
 *  - label: string
 *  - value: string (image URL) or ""
 *  - onChange: (url) => void
 *  - preset: string (key into IMAGE_PRESETS) — defines aspect, dimensions, quality
 *  - description: string
 *  - error: string (from parent validation)
 *  - required: boolean
 *  - compact: boolean (default true — smaller empty state)
 *  - showAspectLabel: boolean (default true)
 */

const STATES = { IDLE: "idle", VALIDATING: "validating", CROPPING: "cropping", UPLOADING: "uploading", DONE: "done", ERROR: "error" };

export default function AdminImageUploader({
    label, value, onChange, preset = "banner_horizontal_desktop",
    description, error, required = false, showAspectLabel = true,
}) {
    const uid = useId();
    const inputRef = useRef(null);
    const objectUrlRef = useRef("");

    const [status, setStatus] = useState(STATES.IDLE);
    const [errorMsg, setErrorMsg] = useState("");
    const [fileInfo, setFileInfo] = useState(null); // { name, size, width, height, format }
    const [pendingFile, setPendingFile] = useState(null); // raw File before crop
    const [showCropper, setShowCropper] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    const presetData = IMAGE_PRESETS[preset] || IMAGE_PRESETS.banner_horizontal_desktop;
    const outputSize = computeOutputSize(presetData.aspect, presetData.maxWidth, presetData.maxHeight);

    // Clean up object URLs on unmount or value change
    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = "";
            }
        };
    }, []);

    const setStatusUrl = useCallback((url) => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
    }, []);

    const startUpload = useCallback(async (file) => {
        setStatus(STATES.UPLOADING);
        setErrorMsg("");
        try {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            onChange(file_url);
            setStatus(STATES.DONE);
        } catch (e) {
            console.error("[AdminImageUploader] Upload error:", e);
            setErrorMsg(e?.message || "Não foi possível enviar a imagem.");
            setStatus(STATES.ERROR);
        }
    }, [onChange]);

    const handleFile = useCallback(async (file) => {
        setErrorMsg("");
        setStatus(STATES.VALIDATING);

        const validation = validateImageFile(file);
        if (!validation.valid) {
            setErrorMsg(validation.error);
            setStatus(STATES.ERROR);
            return;
        }

        try {
            const { img, dims } = await getDimensions(file);
            URL.revokeObjectURL(img.src);
            setFileInfo({ name: file.name, size: file.size, width: dims.width, height: dims.height });
        } catch {
            setErrorMsg("Arquivo de imagem corrompido ou inválido.");
            setStatus(STATES.ERROR);
            return;
        }

        // Open cropper
        setPendingFile(file);
        setShowCropper(true);
        setStatus(STATES.CROPPING);
    }, []);

    const handleCropConfirm = useCallback(async (file, previewUrl, dimensions) => {
        setShowCropper(false);
        setPendingFile(null);
        setStatusUrl(previewUrl);
        setFileInfo(prev => ({
            ...prev,
            width: dimensions.width,
            height: dimensions.height,
            size: file.size,
        }));
        await startUpload(file);
    }, [startUpload, setStatusUrl]);

    const handleCropCancel = useCallback(() => {
        setShowCropper(false);
        setPendingFile(null);
        setStatus(value ? STATES.DONE : STATES.IDLE);
    }, [value]);

    const handleRetry = useCallback(() => {
        if (pendingFile) {
            setShowCropper(true);
            setStatus(STATES.CROPPING);
        } else {
            inputRef.current?.click();
        }
    }, [pendingFile]);

    const handleInputChange = (e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = "";
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    };

    const confirmRemove = () => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = "";
        }
        onChange("");
        setFileInfo(null);
        setPendingFile(null);
        setStatus(STATES.IDLE);
        setErrorMsg("");
        setShowRemoveConfirm(false);
    };

    const isBusy = status === STATES.UPLOADING || status === STATES.VALIDATING || status === STATES.CROPPING;
    const hasImage = !!value;
    const aspectStr = formatAspectRatio(presetData.aspect);

    return (
        <div>
            {/* Label */}
            {label && (
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        {label}{required && <span className="text-rose ml-0.5">*</span>}
                    </label>
                    {showAspectLabel && (
                        <span className="text-[10px] text-muted-foreground/70">{aspectStr}</span>
                    )}
                </div>
            )}

            {/* --- Attached state --- */}
            {hasImage && status !== STATES.ERROR && (
                <div className="rounded-lg border border-border overflow-hidden bg-bone">
                    {/* Preview */}
                    <div className="relative bg-muted" style={{ aspectRatio: String(presetData.aspect), maxHeight: "200px" }}>
                        <img src={value} alt={label || "preview"} className="w-full h-full object-cover" />
                        {status === STATES.DONE && (
                            <div className="absolute top-1.5 right-1.5 bg-green-500/90 text-white text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <Check className="w-2.5 h-2.5" strokeWidth={2} /> Anexada
                            </div>
                        )}
                        {status === STATES.UPLOADING && (
                            <div className="absolute inset-0 bg-charcoal/50 flex items-center justify-center">
                                <div className="flex items-center gap-2 text-white text-xs">
                                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Enviando...
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Metadata + actions */}
                    <div className="px-2.5 py-2 bg-background border-t border-border space-y-1.5">
                        {fileInfo && (
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                                <span className="truncate max-w-[120px]">{fileInfo.name}</span>
                                {fileInfo.width && <span>{fileInfo.width}×{fileInfo.height}px</span>}
                                <span>{formatFileSize(fileInfo.size)}</span>
                                <span className="text-foreground/50">WEBP</span>
                            </div>
                        )}
                        <div className="flex gap-1.5">
                            <button type="button" onClick={() => inputRef.current?.click()} disabled={isBusy}
                                className="flex-1 text-[9px] uppercase tracking-[0.1em] py-1.5 border border-border rounded hover:bg-muted transition-colors flex items-center justify-center gap-1 disabled:opacity-50">
                                <RefreshCw className="w-3 h-3" strokeWidth={1.5} /> Trocar
                            </button>
                            <button type="button" onClick={() => setShowRemoveConfirm(true)} disabled={isBusy}
                                className="flex-1 text-[9px] uppercase tracking-[0.1em] py-1.5 border border-rose/30 text-rose rounded hover:bg-rose/5 transition-colors flex items-center justify-center gap-1 disabled:opacity-50">
                                <Trash2 className="w-3 h-3" strokeWidth={1.5} /> Remover
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Error state --- */}
            {status === STATES.ERROR && !hasImage && (
                <div
                    className="rounded-lg border-2 border-rose/30 bg-rose/5 p-4 text-center"
                    style={{ minHeight: "100px" }}
                >
                    <AlertCircle className="w-6 h-6 text-rose mx-auto mb-2" strokeWidth={1.5} />
                    <p className="text-xs text-rose mb-3">{errorMsg || "Não foi possível enviar a imagem."}</p>
                    <button type="button" onClick={handleRetry}
                        className="text-[10px] uppercase tracking-[0.1em] px-4 py-1.5 border border-rose/40 text-rose rounded hover:bg-rose/10 transition-colors">
                        Tentar novamente
                    </button>
                </div>
            )}

            {/* --- Empty / idle state --- */}
            {!hasImage && status !== STATES.ERROR && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => !isBusy && inputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !isBusy) { e.preventDefault(); inputRef.current?.click(); } }}
                    className={`border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                        dragOver ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/30"
                    } ${isBusy ? "pointer-events-none opacity-60" : ""}`}
                    style={{ minHeight: "120px", maxHeight: "160px" }}
                >
                    {isBusy ? (
                        <>
                            <span className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                            <p className="text-[11px] text-muted-foreground">
                                {status === STATES.VALIDATING ? "Selecionando..." :
                                 status === STATES.CROPPING ? "Ajustando..." : "Enviando..."}
                            </p>
                        </>
                    ) : (
                        <>
                            <Upload className="w-5 h-5 text-muted-foreground" strokeWidth={1.25} />
                            <p className="text-[11px] text-foreground font-medium">Enviar imagem</p>
                            <p className="text-[10px] text-muted-foreground">ou arraste aqui</p>
                            <p className="text-[9px] text-muted-foreground/60">JPEG, PNG ou WEBP · até 10 MB</p>
                        </>
                    )}
                </div>
            )}

            {description && <p className="text-[11px] text-muted-foreground mt-1.5">{description}</p>}
            {error && <p className="text-xs text-rose mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>}

            {/* Hidden file input — unique per instance */}
            <input
                ref={inputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleInputChange}
                id={`img-upload-${uid}`}
            />

            {/* Cropper modal */}
            {showCropper && pendingFile && (
                <CropperModal
                    imageFile={pendingFile}
                    preset={presetData}
                    outputSize={outputSize}
                    title={`Ajustar Imagem — ${presetData.label || label || "Imagem"}`}
                    onConfirm={handleCropConfirm}
                    onCancel={handleCropCancel}
                />
            )}

            {/* Remove confirmation */}
            <AdminConfirmDialog
                open={showRemoveConfirm}
                onClose={() => setShowRemoveConfirm(false)}
                onConfirm={confirmRemove}
                title="Remover imagem"
                message="Deseja remover esta imagem?"
                confirmLabel="Remover"
            />
        </div>
    );
}
