/**
 * Image processing utilities — resize, compress, convert to WEBP.
 * All processing happens client-side via Canvas API.
 */

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const IMAGE_CONSTRAINTS = { ACCEPTED_TYPES, ACCEPTED_EXTENSIONS, MAX_FILE_SIZE };

/**
 * Presets per use case. Each defines: aspect, maxWidth, maxHeight, quality.
 */
export const IMAGE_PRESETS = {
    home_hero_desktop:   { aspect: 16 / 7,  maxWidth: 1920, maxHeight: 1200, quality: 0.85, label: "Home Hero Desktop" },
    home_hero_mobile:    { aspect: 4 / 5,   maxWidth: 800,  maxHeight: 1000, quality: 0.80, label: "Home Hero Mobile" },
    banner_horizontal_desktop: { aspect: 16 / 5, maxWidth: 1920, maxHeight: 800, quality: 0.85, label: "Banner Desktop" },
    banner_horizontal_mobile:  { aspect: 4 / 5,  maxWidth: 800,  maxHeight: 1000, quality: 0.80, label: "Banner Mobile" },
    collection_cover:    { aspect: 3 / 4,   maxWidth: 800,  maxHeight: 1067, quality: 0.85, label: "Capa de Coleção" },
    collection_banner:   { aspect: 16 / 9,  maxWidth: 1920, maxHeight: 1080, quality: 0.85, label: "Banner de Coleção" },
    product_image:       { aspect: 3 / 4,   maxWidth: 1000, maxHeight: 1333, quality: 0.85, label: "Imagem de Produto" },
    promotion_banner:   { aspect: 16 / 5,  maxWidth: 1920, maxHeight: 600,  quality: 0.85, label: "Banner de Promoção" },
    category_image:      { aspect: 3 / 4,   maxWidth: 800,  maxHeight: 1067, quality: 0.85, label: "Imagem de Categoria" },
    logo:                { aspect: 3 / 1,   maxWidth: 600,  maxHeight: 200,  quality: 0.90, label: "Logo", preserveAspectRatio: true },
    favicon:             { aspect: 1 / 1,   maxWidth: 64,   maxHeight: 64,   quality: 0.90, label: "Favicon" },
    og_image:            { aspect: 1.91 / 1, maxWidth: 1200, maxHeight: 630, quality: 0.85, label: "Imagem OG" },
};

/**
 * Banner position → preset mapping (desktop + mobile).
 */
export const BANNER_POSITION_PRESETS = {
    home_hero:               { desktop: "home_hero_desktop",          mobile: "home_hero_mobile" },
    home_after_news:         { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    home_between_categories: { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    home_before_instagram:   { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    home_footer_promo:       { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    product_top:             { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    product_after_desc:      { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    lookbook_top:            { desktop: "home_hero_desktop",            mobile: "home_hero_mobile" },
    lookbook_sidebar:        { desktop: "collection_cover",             mobile: "collection_cover" },
    cart_top:                { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    cart_summary:            { desktop: "collection_cover",             mobile: "collection_cover" },
    checkout_top:            { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
    collections_top:         { desktop: "home_hero_desktop",            mobile: "home_hero_mobile" },
    shop_top:                { desktop: "home_hero_desktop",            mobile: "home_hero_mobile" },
    about_top:               { desktop: "home_hero_desktop",            mobile: "home_hero_mobile" },
    contact_top:            { desktop: "home_hero_desktop",            mobile: "home_hero_mobile" },
    custom:                 { desktop: "banner_horizontal_desktop",   mobile: "banner_horizontal_mobile" },
};

/** Validate a file: type, extension, size. Returns { valid, error }. */
export function validateImageFile(file) {
    if (!file) return { valid: false, error: "Nenhum arquivo selecionado." };
    const validMime = ACCEPTED_TYPES.includes(file.type);
    const validExt = ACCEPTED_EXTENSIONS.test(file.name);
    const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    const isDangerous = /\.(html?|js|exe|bat|sh|php|svg)$/i.test(file.name);

    if (isSvg || isDangerous || (!validMime && !validExt))
        return { valid: false, error: "Formato não suportado. Use JPEG, PNG ou WEBP." };
    if (file.size > MAX_FILE_SIZE)
        return { valid: false, error: `Arquivo excede o tamanho máximo de ${MAX_FILE_SIZE / 1024 / 1024}MB.` };
    return { valid: true };
}

/** Load an image File into an HTMLImageElement. Rejects if not decodable. */
export function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Arquivo de imagem corrompido ou inválido.")); };
        img.src = url;
    });
}

/** Get image dimensions from a File. Returns { width, height }. */
export async function getDimensions(file) {
    const img = await loadImage(file);
    const dims = { width: img.naturalWidth, height: img.naturalHeight };
    URL.revokeObjectURL(img.src);
    return { img, dims };
}

/** Format bytes into human-readable string. */
export function formatFileSize(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format an aspect ratio number to a human-readable ratio string. */
export function formatAspectRatio(ratio) {
    // Try common ratios
    const commons = { "1.78": "16:9", "2.29": "16:7", "3.20": "16:5", "0.75": "3:4", "0.80": "4:5", "1.00": "1:1", "3.00": "3:1", "1.91": "1.91:1" };
    const key = ratio.toFixed(2);
    if (commons[key]) return commons[key];
    // Try to express as a ratio with small integers
    for (let h = 1; h <= 20; h++) {
        const w = Math.round(ratio * h);
        if (Math.abs(w / h - ratio) < 0.01) return `${w}:${h}`;
    }
    return `${ratio.toFixed(2)}:1`;
}

/**
 * Crop + resize an image to target dimensions using canvas.
 * Outputs WEBP when supported, falls back to JPEG.
 */
export async function cropAndResize(img, cropArea, targetWidth, targetHeight, quality = 0.85, preserveAspectRatio = false) {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (preserveAspectRatio) {
        // Fit image inside target without distorting (contain)
        const srcAspect = cropArea.width / cropArea.height;
        const dstAspect = targetWidth / targetHeight;
        let dx, dy, dw, dh;
        if (srcAspect > dstAspect) {
            dw = targetWidth;
            dh = targetWidth / srcAspect;
            dx = 0;
            dy = (targetHeight - dh) / 2;
        } else {
            dh = targetHeight;
            dw = targetHeight * srcAspect;
            dx = (targetWidth - dw) / 2;
            dy = 0;
        }
        // Fill background white for transparency
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, cropArea.x, cropArea.y, cropArea.width, cropArea.height, dx, dy, dw, dh);
    } else {
        ctx.drawImage(img, cropArea.x, cropArea.y, cropArea.width, cropArea.height, 0, 0, targetWidth, targetHeight);
    }

    const webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    const format = webpSupported ? "image/webp" : "image/jpeg";
    const ext = webpSupported ? ".webp" : ".jpg";

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
    return { blob, format, ext };
}

/** Compute the pixel crop area from react-easy-crop's croppedAreaPixels. */
export function computeCropArea(croppedAreaPixels) {
    return {
        x: croppedAreaPixels.x,
        y: croppedAreaPixels.y,
        width: croppedAreaPixels.width,
        height: croppedAreaPixels.height,
    };
}

/**
 * Check if the source image is too small for the target dimensions.
 * Returns { tooSmall, message } — message is null if OK.
 */
export function checkImageQuality(img, cropArea, targetWidth, targetHeight) {
    const cropW = cropArea.width;
    const cropH = cropArea.height;
    // If the crop area is smaller than target, we'd be upscaling
    if (cropW < targetWidth * 0.7 || cropH < targetHeight * 0.7) {
        return {
            tooSmall: true,
            message: "Esta imagem pode perder qualidade nesta posição. Considere enviar uma imagem maior.",
        };
    }
    return { tooSmall: false, message: null };
}

/** Generate a mobile-cropped version from an existing image URL. */
export async function generateMobileVersion(imageUrl, mobileAspect, targetWidth, targetHeight, quality = 0.8) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
    });

    const srcAspect = img.naturalWidth / img.naturalHeight;
    const dstAspect = mobileAspect;
    let sx, sy, sw, sh;
    if (srcAspect > dstAspect) {
        sh = img.naturalHeight;
        sw = sh * dstAspect;
        sx = (img.naturalWidth - sw) / 2;
        sy = 0;
    } else {
        sw = img.naturalWidth;
        sh = sw / dstAspect;
        sx = 0;
        sy = (img.naturalHeight - sh) / 2;
    }
    return cropAndResize(img, { x: sx, y: sy, width: sw, height: sh }, targetWidth, targetHeight, quality);
}

/** Convert a Blob to a File with a normalized name. */
export function blobToFile(blob, baseName, ext) {
    const normalizedName = (baseName || "imagem")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40);
    return new File([blob], `${normalizedName}-${Date.now()}${ext}`, { type: blob.type });
}

/** Compute target output dimensions from an aspect ratio and max bounds. */
export function computeOutputSize(aspectRatio, maxWidth, maxHeight) {
    let width = maxWidth;
    let height = Math.round(width / aspectRatio);
    if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * aspectRatio);
    }
    return { width, height };
}
