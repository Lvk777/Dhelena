/**
 * Image processing utilities — resize, compress, convert to WEBP.
 * All processing happens client-side via Canvas API (no backend needed).
 */

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const IMAGE_CONSTRAINTS = {
    ACCEPTED_TYPES,
    ACCEPTED_EXTENSIONS,
    MAX_FILE_SIZE,
};

/** Validate a file: type, extension, size. Returns { valid, error }. */
export function validateImageFile(file) {
    const validMime = ACCEPTED_TYPES.includes(file.type);
    const validExt = ACCEPTED_EXTENSIONS.test(file.name);
    const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    const isDangerous = /\.(html?|js|exe|bat|sh|php|svg)$/i.test(file.name);

    if (isSvg || isDangerous) {
        return { valid: false, error: "Formato não suportado. Use JPEG, PNG ou WEBP." };
    }
    if (!validMime && !validExt) {
        return { valid: false, error: "Formato não suportado. Use JPEG, PNG ou WEBP." };
    }
    if (file.size > MAX_FILE_SIZE) {
        return { valid: false, error: `Arquivo excede o tamanho máximo de ${MAX_FILE_SIZE / 1024 / 1024}MB.` };
    }
    return { valid: true };
}

/** Load an image File into an HTMLImageElement. */
export function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível carregar a imagem.")); };
        img.src = url;
    });
}

/** Get image dimensions from a File. Returns { width, height }. */
export async function getDimensions(file) {
    const img = await loadImage(file);
    const dims = { width: img.naturalWidth, height: img.naturalHeight };
    URL.revokeObjectURL(img.src);
    return dims;
}

/** Format bytes into human-readable string. */
export function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Crop + resize an image to target dimensions using canvas.
 * Outputs WEBP when supported, falls back to JPEG.
 *
 * @param {HTMLImageElement} img - source image element
 * @param {{ x: number, y: number, width: number, height: number }} cropArea - crop in source pixels
 * @param {number} targetWidth - output width
 * @param {number} targetHeight - output height
 * @param {number} quality - 0..1
 * @returns {Promise<{ blob: Blob, url: string, format: string }>}
 */
export async function cropAndResize(img, cropArea, targetWidth, targetHeight, quality = 0.85) {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
        img,
        cropArea.x, cropArea.y, cropArea.width, cropArea.height,
        0, 0, targetWidth, targetHeight
    );

    // Try WEBP first, fall back to JPEG
    const webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    const format = webpSupported ? "image/webp" : "image/jpeg";
    const ext = webpSupported ? ".webp" : ".jpg";

    const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, format, quality);
    });

    const url = URL.createObjectURL(blob);
    return { blob, url, format, ext };
}

/**
 * Compute the pixel crop area from react-easy-crop's croppedAreaPixels.
 * Returns { x, y, width, height } in source-image coordinates.
 */
export function computeCropArea(croppedAreaPixels) {
    return {
        x: croppedAreaPixels.x,
        y: croppedAreaPixels.y,
        width: croppedAreaPixels.width,
        height: croppedAreaPixels.height,
    };
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

    // Center-crop to the mobile aspect ratio
    const srcAspect = img.naturalWidth / img.naturalHeight;
    const dstAspect = mobileAspect;

    let sx, sy, sw, sh;
    if (srcAspect > dstAspect) {
        // Source is wider — crop sides
        sh = img.naturalHeight;
        sw = sh * dstAspect;
        sx = (img.naturalWidth - sw) / 2;
        sy = 0;
    } else {
        // Source is taller — crop top/bottom
        sw = img.naturalWidth;
        sh = sw / dstAspect;
        sx = 0;
        sy = (img.naturalHeight - sh) / 2;
    }

    return cropAndResize(img, { x: sx, y: sy, width: sw, height: sh }, targetWidth, targetHeight, quality);
}

/** Convert a Blob to a File with a normalized name. */
export function blobToFile(blob, baseName, ext) {
    const normalizedName = baseName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "-")
        .toLowerCase()
        .slice(0, 40);
    return new File([blob], `${normalizedName || "imagem"}-${Date.now()}${ext}`, { type: blob.type });
}

/**
 * Aspect ratio presets per banner position.
 * Values are width/height ratios.
 */
export const ASPECT_PRESETS = {
    // Home
    home_hero: { desktop: 16 / 7, mobile: 4 / 5, label: "Home Hero" },
    home_after_news: { desktop: 16 / 5, mobile: 4 / 5, label: "Home após novidades" },
    home_between_categories: { desktop: 16 / 5, mobile: 4 / 5, label: "Home entre categorias" },
    home_before_instagram: { desktop: 16 / 5, mobile: 4 / 5, label: "Home antes do Instagram" },
    home_footer_promo: { desktop: 16 / 5, mobile: 4 / 3, label: "Home rodapé" },
    // Product
    product_top: { desktop: 16 / 5, mobile: 4 / 5, label: "Produto topo" },
    product_after_desc: { desktop: 16 / 9, mobile: 1 / 1, label: "Produto após descrição" },
    // Lookbook
    lookbook_top: { desktop: 16 / 7, mobile: 4 / 5, label: "Monte seu Look topo" },
    lookbook_sidebar: { desktop: 3 / 4, mobile: 3 / 4, label: "Monte seu Look lateral" },
    // Cart
    cart_top: { desktop: 16 / 5, mobile: 16 / 9, label: "Carrinho topo" },
    cart_summary: { desktop: 3 / 4, mobile: 3 / 4, label: "Carrinho resumo" },
    // Checkout
    checkout_top: { desktop: 16 / 5, mobile: 16 / 9, label: "Checkout topo" },
    // Other pages
    collections_top: { desktop: 16 / 7, mobile: 4 / 5, label: "Coleções topo" },
    shop_top: { desktop: 16 / 7, mobile: 4 / 5, label: "Loja topo" },
    about_top: { desktop: 16 / 7, mobile: 4 / 5, label: "Nossa História topo" },
    contact_top: { desktop: 16 / 7, mobile: 4 / 5, label: "Contato topo" },
    custom: { desktop: 16 / 9, mobile: 4 / 5, label: "Custom" },
};

/** Default output max dimension (pixels) for desktop and mobile. */
export const OUTPUT_DIMENSIONS = {
    desktop: { maxWidth: 1920, maxHeight: 1200 },
    mobile: { maxWidth: 800, maxHeight: 1000 },
};

/** Compute target output dimensions from an aspect ratio and max bounds. */
export function computeOutputSize(aspectRatio, maxBounds) {
    const { maxWidth, maxHeight } = maxBounds;
    let width = maxWidth;
    let height = Math.round(width / aspectRatio);
    if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * aspectRatio);
    }
    return { width, height };
}
