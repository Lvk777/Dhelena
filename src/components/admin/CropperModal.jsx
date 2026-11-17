import React, { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { X, ZoomIn, Check, AlertCircle } from "lucide-react";
import { cropAndResize, computeCropArea, blobToFile, formatAspectRatio, checkImageQuality } from "@/lib/imageProcessor";

/**
 * Modal for cropping an image to a specific aspect ratio.
 * Outputs a processed (resized, compressed, WEBP) image blob.
 */
export default function CropperModal({ imageFile, preset, title = "Ajustar Imagem", onConfirm, onCancel }) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [imgEl, setImgEl] = useState(null);
    const [qualityWarning, setQualityWarning] = useState(null);
    const processingRef = React.useRef(false);

    const { aspect, maxWidth: targetW, maxHeight: targetH, quality = 0.85, preserveAspectRatio = false } = preset;

    // Load image
    useEffect(() => {
        if (!imageFile) return;
        const url = URL.createObjectURL(imageFile);
        setImageUrl(url);
        const img = new Image();
        img.onload = () => setImgEl(img);
        img.onerror = () => setError("Não foi possível carregar a imagem. O arquivo pode estar corrompido.");
        img.src = url;
        return () => URL.revokeObjectURL(url);
    }, [imageFile]);

    const onCropComplete = useCallback((_, croppedPixels) => {
        setCroppedAreaPixels(croppedPixels);
        if (imgEl) {
            const area = computeCropArea(croppedPixels);
            const q = checkImageQuality(imgEl, area, targetW, targetH);
            setQualityWarning(q.tooSmall ? q.message : null);
        }
    }, [imgEl, targetW, targetH]);

    const handleConfirm = async () => {
        if (processingRef.current || !imgEl || !croppedAreaPixels) return;
        processingRef.current = true;
        setProcessing(true);
        setError("");
        let previewUrl;
        try {
            const cropArea = computeCropArea(croppedAreaPixels);
            const { blob, ext } = await cropAndResize(imgEl, cropArea, targetW, targetH, quality, preserveAspectRatio);
            const baseName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "imagem";
            const file = blobToFile(blob, baseName, ext);
            previewUrl = URL.createObjectURL(blob);
            await onConfirm(file, previewUrl, { width: targetW, height: targetH });
        } catch (e) {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setError("Não foi possível processar ou enviar a imagem. Tente novamente.");
        } finally {
            processingRef.current = false;
            setProcessing(false);
        }
    };

    return createPortal(
        <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-charcoal/60 backdrop-blur-sm p-2 sm:p-4">
            <div role="dialog" aria-modal="true" aria-label={title} className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-border shrink-0">
                    <h2 className="text-sm font-heading tracking-[0.05em]">{title}</h2>
                    <span className="hidden sm:block text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
                        {formatAspectRatio(aspect)} · {targetW}×{targetH}px · WEBP
                    </span>
                    <button type="button" onClick={onCancel} disabled={processing} className="min-w-11 min-h-11 flex items-center justify-center hover:bg-muted rounded transition-colors" aria-label="Fechar recorte">
                        <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                {/* Cropper area */}
                <div className="relative bg-charcoal h-[min(42dvh,360px)] min-h-[120px]">
                    {imageUrl && (
                        <Cropper
                            image={imageUrl}
                            crop={crop}
                            zoom={zoom}
                            aspect={aspect}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropComplete={onCropComplete}
                            restrictPosition={true}
                        />
                    )}
                </div>

                {/* Controls */}
                <div className="px-4 sm:px-5 py-3 space-y-3 border-t border-border">
                    {error && (
                        <p className="text-xs text-rose-ink flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5" /> {error}
                        </p>
                    )}
                    {qualityWarning && !error && (
                        <p className="text-xs text-amber-500 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5" /> {qualityWarning}
                        </p>
                    )}

                    {/* Zoom slider */}
                    <div className="flex items-center gap-3">
                        <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                        <input
                            type="range" min={1} max={3} step={0.1} value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            className="flex-1 accent-[hsl(var(--gold))]"
                            aria-label="Zoom"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">{zoom.toFixed(1)}x</span>
                    </div>

                </div>
                </div>
                    {/* Action buttons remain visible as warnings and zoom content scroll. */}
                    <div className="flex gap-3 px-4 sm:px-5 py-3 border-t border-border bg-background shrink-0">
                        <button type="button" onClick={onCancel} className="btn-outline flex-1 min-w-0 min-h-11 px-2 sm:px-4 tracking-normal text-sm" disabled={processing}>Cancelar</button>
                        <button type="button" onClick={handleConfirm} disabled={processing || !imgEl || !croppedAreaPixels}
                            className="btn-gold flex-1 min-w-0 min-h-11 px-2 sm:px-4 tracking-normal text-sm flex items-center justify-center gap-1.5 disabled:opacity-50">
                            {processing ? (
                                <>
                                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    Processando...
                                </>
                            ) : (
                                <>
                                    <Check className="w-3.5 h-3.5" strokeWidth={1.5} /> Usar imagem
                                </>
                            )}
                        </button>
                </div>
            </div>
        </div>, document.body
    );
}
