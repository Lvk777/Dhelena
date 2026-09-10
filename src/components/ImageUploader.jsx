import React, { useState, useRef, useCallback } from "react";
import { Upload, X, GripVertical, Star, Image as ImageIcon, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import CropperModal from "@/components/admin/CropperModal";
import {
    validateImageFile, getDimensions, formatFileSize,
    cropAndResize, computeCropArea, blobToFile,
    IMAGE_PRESETS, computeOutputSize,
} from "@/lib/imageProcessor";

const RECOMMENDATIONS = [
    "Foto principal",
    "Foto costas",
    "Foto lateral",
    "Foto detalhe",
    "Foto no corpo",
];

const PRODUCT_PRESET = IMAGE_PRESETS.product_image;

export default function ImageUploader({ images = [], onChange, max = 10 }) {
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [pendingFiles, setPendingFiles] = useState([]);
    const [cropIndex, setCropIndex] = useState(0);
    const inputRef = useRef(null);

    const handleFiles = useCallback(async (fileList) => {
        setUploadError("");
        const files = Array.from(fileList);
        if (!files.length) return;

        // Validate all files first
        for (const file of files) {
            const v = validateImageFile(file);
            if (!v.valid) { setUploadError(v.error); return; }
        }

        if (images.length + files.length > max) {
            setUploadError(`Máximo de ${max} fotos.`);
            return;
        }

        // Queue files for cropping one by one
        setPendingFiles(files);
        setCropIndex(0);
    }, [images.length, max]);

    const handleCropConfirm = useCallback(async (file, previewUrl) => {
        setUploading(true);
        try {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            onChange([...images, file_url]);
        } catch (e) {
            console.error("[ImageUploader] Upload error:", e);
            setUploadError("Erro ao enviar arquivo. Tente novamente.");
        } finally {
            setUploading(false);
            URL.revokeObjectURL(previewUrl);

            // Move to next file or finish
            const nextIndex = cropIndex + 1;
            if (nextIndex < pendingFiles.length) {
                setCropIndex(nextIndex);
            } else {
                setPendingFiles([]);
                setCropIndex(0);
            }
        }
    }, [images, onChange, cropIndex, pendingFiles.length]);

    const handleCropCancel = useCallback(() => {
        setPendingFiles([]);
        setCropIndex(0);
    }, []);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
    };

    const removeImage = (idx) => {
        onChange(images.filter((_, i) => i !== idx));
    };

    const moveImage = (idx, dir) => {
        const next = [...images];
        const swap = idx + dir;
        if (swap < 0 || swap >= next.length) return;
        [next[idx], next[swap]] = [next[swap], next[idx]];
        onChange(next);
    };

    const outputSize = computeOutputSize(PRODUCT_PRESET.aspect, PRODUCT_PRESET.maxWidth, PRODUCT_PRESET.maxHeight);

    return (
        <div>
            {/* drop zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !uploading && inputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/30"} ${uploading ? "pointer-events-none opacity-60" : ""}`}
                style={{ minHeight: "120px", maxHeight: "160px" }}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    multiple
                    className="hidden"
                    onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
                />
                {uploading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                        <span className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                        <p className="text-[11px] text-muted-foreground">Enviando...</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-1">
                        <Upload className="w-5 h-5 text-muted-foreground" strokeWidth={1.25} />
                        <p className="text-[11px] text-foreground font-medium">Enviar fotos</p>
                        <p className="text-[10px] text-muted-foreground">ou arraste aqui</p>
                        <p className="text-[9px] text-muted-foreground/60">JPG, PNG ou WEBP · até 10MB · {max} fotos max</p>
                    </div>
                )}
                {uploadError && <p className="text-[11px] text-[hsl(var(--rose))] mt-2">{uploadError}</p>}
            </div>

            {/* previews */}
            {images.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-4">
                    {images.map((url, idx) => (
                        <div key={idx} className="relative group aspect-[3/4] bg-bone overflow-hidden rounded border border-border">
                            <img src={url} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex flex-col justify-between p-1.5">
                                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                                        className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center hover:bg-white"
                                    >
                                        <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="flex gap-0.5">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); moveImage(idx, -1); }}
                                            disabled={idx === 0}
                                            className="w-6 h-6 rounded bg-white/90 flex items-center justify-center hover:bg-white disabled:opacity-30"
                                        >
                                            <GripVertical className="w-3 h-3 rotate-180" strokeWidth={1.5} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); moveImage(idx, 1); }}
                                            disabled={idx === images.length - 1}
                                            className="w-6 h-6 rounded bg-white/90 flex items-center justify-center hover:bg-white disabled:opacity-30"
                                        >
                                            <GripVertical className="w-3 h-3" strokeWidth={1.5} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {idx === 0 && (
                                <div className="absolute top-1.5 left-1.5 bg-[hsl(var(--gold))] text-white text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 flex items-center gap-0.5">
                                    <Star className="w-2.5 h-2.5 fill-white" strokeWidth={0} /> Principal
                                </div>
                            )}
                            <div className="absolute bottom-1 left-1.5 text-[8px] uppercase tracking-[0.1em] text-white/80">
                                {RECOMMENDATIONS[idx] || `Foto ${idx + 1}`}
                            </div>
                        </div>
                    ))}
                    {images.length < max && (
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="aspect-[3/4] border-2 border-dashed border-border rounded flex flex-col items-center justify-center hover:border-foreground/30 transition-colors"
                        >
                            <ImageIcon className="w-6 h-6 text-muted-foreground mb-1" strokeWidth={1} />
                            <span className="text-[10px] text-muted-foreground">Adicionar</span>
                        </button>
                    )}
                </div>
            )}

            <p className="text-[11px] text-muted-foreground mt-3">
                A primeira foto e a principal. Arraste para reordenar. Recomendamos: {RECOMMENDATIONS.join(" · ")}.
            </p>

            {/* Cropper modal for multi-image upload */}
            {pendingFiles.length > 0 && pendingFiles[cropIndex] && (
                <CropperModal
                    imageFile={pendingFiles[cropIndex]}
                    preset={PRODUCT_PRESET}
                    outputSize={outputSize}
                    title={`Ajustar foto ${cropIndex + 1} de ${pendingFiles.length}`}
                    onConfirm={handleCropConfirm}
                    onCancel={handleCropCancel}
                />
            )}
        </div>
    );
}
