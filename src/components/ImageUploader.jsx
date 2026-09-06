import React, { useState, useRef, useCallback } from "react";
import { Upload, X, GripVertical, Star, Image as ImageIcon } from "lucide-react";
import { base44 } from "@/api/base44Client";

const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const VALID_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

const RECOMMENDATIONS = [
    "Foto principal",
    "Foto costas",
    "Foto lateral",
    "Foto detalhe",
    "Foto no corpo",
];

export default function ImageUploader({ images = [], onChange, max = 10 }) {
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef(null);

    const [uploadError, setUploadError] = useState("");

    const uploadFiles = useCallback(async (fileList) => {
        setUploadError("");
        // Validar tipo (MIME + extensão), tamanho máximo e bloquear formatos perigosos
        const files = Array.from(fileList).filter((f) => {
            const validMime = ACCEPTED.includes(f.type);
            const validExt = VALID_EXTENSIONS.test(f.name);
            const isSvg = f.type === "image/svg+xml" || /\.svg$/i.test(f.name);
            const isDangerous = /\.(html?|js|exe|bat|sh|php|svg)$/i.test(f.name);
            return (validMime || validExt) && !isSvg && !isDangerous;
        }).filter((f) => {
            if (f.size > MAX_FILE_SIZE) {
                setUploadError(`Arquivo "${f.name}" excede o tamanho máximo de 5MB`);
                return false;
            }
            return true;
        });
        if (!files.length) return;
        setUploading(true);
        try {
            const urls = [];
            for (const file of files) {
                // Normalizar nome: remover acentos, espaços, caracteres especiais
                const ext = file.name.match(VALID_EXTENSIONS)?.[0] || ".jpg";
                const baseName = file.name.replace(/\.[^/.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40);
                const normalizedFile = new File([file], `${baseName || "foto"}-${Date.now()}${ext}`, { type: file.type });
                const { file_url } = await base44.integrations.Core.UploadFile({ file: normalizedFile });
                urls.push(file_url);
            }
            onChange([...images, ...urls].slice(0, max));
        } catch (e) {
            console.error("Upload error:", e);
            setUploadError("Erro ao enviar arquivo. Tente novamente.");
        } finally {
            setUploading(false);
        }
    }, [images, onChange, max]);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        uploadFiles(e.dataTransfer.files);
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

    return (
        <div>
            {/* drop zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-[hsl(var(--gold))] bg-[hsl(var(--gold))]/5" : "border-border hover:border-foreground/30"}`}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    multiple
                    className="hidden"
                    onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }}
                />
                <Upload className="w-7 h-7 mx-auto text-muted-foreground mb-3" strokeWidth={1.25} />
                <p className="text-sm text-foreground">
                    {uploading ? "Enviando..." : "Arraste fotos aqui ou clique para selecionar"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">JPG, PNG ou WEBP · até 5MB cada · até {max} fotos</p>
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
                A primeira foto é a principal. Arraste para reordenar. Recomendamos: {RECOMMENDATIONS.join(" · ")}.
            </p>
        </div>
    );
}