import React, { useState, useCallback, useEffect } from "react";
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
        if (!imgEl || !croppedAreaPixels) return;
        setProcessing(true);
        setError("");
        try {
            const cropArea = computeCropArea(croppedAreaPixels);
            const { blob, ext } = await cropAndResize(imgEl, cropArea, targetW, targetH, quality, preserveAspectRatio);
            const baseName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "imagem";
            const file = blobToFile(blob, baseName, ext);
            const previewUrl = URL.createObjectURL(blob);
            onConfirm(file, previewUrl, { width: targetW, height: targetH });
        } catch (e) {
            console.error("[CropperModal] Crop error:", e);
            setError("Erro ao processar imagem. Tente novamente.");
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-charcoal/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                    <h2 className="text-sm font-heading tracking-[0.05em]">{title}</h2>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
                        {formatAspectRatio(aspect)} · {targetW}×{targetH}px · WEBP
                    </span>
                    <button type="button" onClick={onCancel} className="p-1.5 hover:bg-muted rounded transition-colors" aria-label="Fechar">
                        <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                </div>

                {/* Cropper area */}
                <div className="relative bg-charcoal" style={{ height: "360px" }}>
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
                <div className="px-5 py-4 space-y-3 border-t border-border">
                    {error && (
                        <p className="text-xs text-rose flex items-center gap-1.5">
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

                    {/* Action buttons */}
                    <div className="flex gap-3">
                        <button type="button" onClick={onCancel} className="btn-outline flex-1 py-2.5 text-sm" disabled={processing}>
                            Cancelar
                        </button>
                        <button type="button" onClick={handleConfirm} disabled={processing || !imgEl}
                            className="btn-gold flex-1 py-2.5 text-sm flex items-center justify-center gap-1.5 disabled:opacity-50">
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
            </div>
        </div>
    );
}
