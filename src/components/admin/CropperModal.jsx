import React, { useState, useCallback, useRef } from "react";
import Cropper from "react-easy-crop";
import { X, ZoomIn, Check, RotateCw } from "lucide-react";
import { cropAndResize, computeCropArea, blobToFile } from "@/lib/imageProcessor";

/**
 * Modal for cropping an image to a specific aspect ratio.
 * Outputs a processed (resized, compressed, WEBP) image.
 *
 * @param {File|Blob} imageFile - the raw image to crop
 * @param {number} aspect - width/height ratio for the crop area
 * @param {{ width: number, height: number }} outputSize - target output dimensions
 * @param {string} title - modal title
 * @param {(file: File, previewUrl: string, dimensions: {width, height}) => void} onConfirm
 * @param {() => void} onCancel
 */
export default function CropperModal({ imageFile, aspect, outputSize, title = "Ajustar Imagem", onConfirm, onCancel }) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState("");
    const imgElRef = useRef(null);
    const [imageUrl, setImageUrl] = useState("");

    // Load image on mount
    React.useEffect(() => {
        if (!imageFile) return;
        const url = URL.createObjectURL(imageFile);
        setImageUrl(url);
        const img = new Image();
        img.onload = () => { imgElRef.current = img; };
        img.src = url;
        return () => URL.revokeObjectURL(url);
    }, [imageFile]);

    const onCropComplete = useCallback((_, croppedPixels) => {
        setCroppedAreaPixels(croppedPixels);
    }, []);

    const handleConfirm = async () => {
        if (!imgElRef.current || !croppedAreaPixels) return;
        setProcessing(true);
        setError("");
        try {
            const cropArea = computeCropArea(croppedAreaPixels);

            // If rotation is set, apply it by drawing rotated
            let img = imgElRef.current;
            if (rotation !== 0) {
                const rotCanvas = document.createElement("canvas");
                const ctx = rotCanvas.getContext("2d");
                const rad = (rotation * Math.PI) / 180;
                rotCanvas.width = Math.abs(img.naturalWidth * Math.cos(rad)) + Math.abs(img.naturalHeight * Math.sin(rad));
                rotCanvas.height = Math.abs(img.naturalWidth * Math.sin(rad)) + Math.abs(img.naturalHeight * Math.cos(rad));
                ctx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
                ctx.rotate(rad);
                ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
                const rotImg = new Image();
                rotImg.src = rotCanvas.toDataURL("image/png");
                await new Promise(r => { rotImg.onload = r; });
                img = rotImg;
                // Recompute crop area relative to rotated image — use full image as fallback
                cropArea.x = 0;
                cropArea.y = 0;
                cropArea.width = img.naturalWidth;
                cropArea.height = img.naturalHeight;
            }

            const { blob, ext } = await cropAndResize(
                img,
                cropArea,
                outputSize.width,
                outputSize.height,
                0.85
            );

            const baseName = imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : "imagem";
            const file = blobToFile(blob, baseName, ext);
            const previewUrl = URL.createObjectURL(blob);
            const dimensions = { width: outputSize.width, height: outputSize.height };
            onConfirm(file, previewUrl, dimensions);
        } catch (e) {
            console.error("Crop error:", e);
            setError("Erro ao processar imagem. Tente novamente.");
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-charcoal/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <h2 className="text-sm font-heading tracking-[0.05em]">{title}</h2>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-1.5 hover:bg-muted rounded transition-colors"
                        aria-label="Fechar"
                    >
                        <X className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                </div>

                {/* Cropper area */}
                <div className="relative bg-charcoal" style={{ height: "400px" }}>
                    {imageUrl && (
                        <Cropper
                            image={imageUrl}
                            crop={crop}
                            zoom={zoom}
                            rotation={rotation}
                            aspect={aspect}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onRotationChange={setRotation}
                            onCropComplete={onCropComplete}
                            restrictPosition={true}
                            cropSize={{ width: 400, height: 400 / aspect }}
                        />
                    )}
                </div>

                {/* Controls */}
                <div className="px-5 py-4 space-y-4 border-t border-border">
                    {error && (
                        <p className="text-xs text-rose flex items-center gap-1">
                            <X className="w-3 h-3" /> {error}
                        </p>
                    )}

                    {/* Zoom slider */}
                    <div className="flex items-center gap-3">
                        <ZoomIn className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                        <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.1}
                            value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            className="flex-1 accent-[hsl(var(--gold))]"
                            aria-label="Zoom"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">{zoom.toFixed(1)}x</span>
                    </div>

                    {/* Rotation */}
                    <div className="flex items-center gap-3">
                        <RotateCw className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                        <input
                            type="range"
                            min={0}
                            max={360}
                            step={1}
                            value={rotation}
                            onChange={(e) => setRotation(parseInt(e.target.value))}
                            className="flex-1 accent-[hsl(var(--gold))]"
                            aria-label="Rotação"
                        />
                        <button
                            type="button"
                            onClick={() => setRotation(0)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                        >
                            Resetar
                        </button>
                    </div>

                    {/* Aspect info */}
                    <p className="text-[11px] text-muted-foreground">
                        Proporção: <span className="text-foreground">{(aspect).toFixed(2)}:1</span> · Saída: <span className="text-foreground">{outputSize.width}×{outputSize.height}px</span>
                    </p>

                    {/* Action buttons */}
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="btn-outline flex-1 py-2.5 text-sm"
                            disabled={processing}
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={processing}
                            className="btn-gold flex-1 py-2.5 text-sm flex items-center justify-center gap-1.5"
                        >
                            {processing ? (
                                <>
                                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    Processando...
                                </>
                            ) : (
                                <>
                                    <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    Usar imagem
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
