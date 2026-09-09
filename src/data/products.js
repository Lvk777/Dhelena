// Helper functions and static constants for D'Helenas store.
// Product/category/collection/banner data now comes from the database via CatalogContext.

const IMG_BASE = "https://media.base44.com/images/public/6a9b39c904f395072f289bf5";
const img = (slug) => `${IMG_BASE}/${slug}`;

export const HERO_IMAGE = img("ca5732fc0_generated_db5c1f89.jpg");
export const ABOUT_IMAGE = "https://media.base44.com/images/public/6a9cb96c35367ad0608d2e70/c1c14d892_Nossahistriadhelenas.jpg";
export const LOOK_IMAGE = img("b30f6cddb_generated_048b13fa.jpg");

export const CATEGORY_IMAGES = {
    vestidos: img("de2108912_generated_b3a4de3c.jpg"),
    conjuntos: img("2c7257aca_generated_ae00107f.jpg"),
    blusas: img("5b1981267_generated_3d3235dd.jpg"),
    calcas: img("2cc9318e6_generated_c7c5f6ef.jpg"),
    acessorios: img("38d0b8849_generated_e157ded6.jpg"),
};

export const COLOR_SWATCHES = {
    rosa_claro: { name: "Rosa claro", hex: "#E6B0B8" },
    rosa_queimado: { name: "Rosa queimado", hex: "#D98C96" },
    off_white: { name: "Off-white", hex: "#F9F7F5" },
    bege: { name: "Bege", hex: "#E8DDCF" },
    dourado: { name: "Dourado", hex: "#DAAF37" },
    preto: { name: "Preto", hex: "#2D2926" },
    caramelo: { name: "Caramelo", hex: "#B98A6B" },
};

export const SIZES_LIST = ["PP", "P", "M", "G", "GG"];

export const formatBRL = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const installmentValue = (price, installments) =>
    (price || 0) / (installments || 1);

export const totalStock = (product) =>
    (product?.colors || []).reduce(
        (sum, c) => sum + Object.values(c.stock || {}).reduce((a, b) => a + (b || 0), 0),
        0
    );

export const isLowStock = (product) => {
    const t = totalStock(product);
    return t > 0 && t <= 6;
};

export const isAvailable = (product) => totalStock(product) > 0;

export const stockFor = (product, colorId, size) => {
    const color = (product?.colors || []).find((c) => c.id === colorId);
    return color?.stock?.[size] ?? 0;
};

// Order status labels and timeline
export const ORDER_STATUS = {
    recebido: { label: "Pedido recebido", step: 0 },
    pagamento_aprovado: { label: "Pagamento aprovado", step: 1 },
    em_separacao: { label: "Em separação", step: 2 },
    enviado: { label: "Enviado", step: 3 },
    em_transporte: { label: "Em transporte", step: 4 },
    saiu_entrega: { label: "Saiu para entrega", step: 5 },
    entregue: { label: "Entregue", step: 6 },
    cancelado: { label: "Cancelado", step: -1 },
};

export const ORDER_TIMELINE = [
    "recebido",
    "pagamento_aprovado",
    "em_separacao",
    "enviado",
    "em_transporte",
    "saiu_entrega",
    "entregue",
];

export const PAYMENT_LABELS = {
    pix: "Pix",
    credito: "Cartão de crédito",
    debito: "Cartão de débito",
};

export const SHIPPING_LABELS = {
    padrao: "Entrega padrão",
    expressa: "Entrega expressa",
    retirada: "Retirada na boutique",
};