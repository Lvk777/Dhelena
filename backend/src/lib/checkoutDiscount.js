function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

export function checkoutCents(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw invalid('Valor monetário inválido');
    const cents = Math.round((amount + Number.EPSILON * Math.max(1, amount)) * 100);
    if (!Number.isSafeInteger(cents)) throw invalid('Valor monetário inválido');
    return cents;
}

export function pixDiscountOffer(paymentConfig = {}, env = process.env) {
    const percentage = paymentConfig.pix_discount;
    const enabled = env.PIX_DISCOUNT_ENABLED === 'true' && paymentConfig.pix_enabled !== false
        && paymentConfig.pix_discount_enabled === true && validPixDiscountPercentage(percentage)
        && percentage > 0;
    return { enabled, percentage: enabled ? percentage : 0 };
}

export function validPixDiscountPercentage(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 30
        && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function pixDiscountCents(productCents, percentage) {
    return Math.round(productCents * Math.round(percentage * 100) / 10000);
}

// Preserve the existing coupon/promotion choice. Pix never stacks with a
// coupon, a sale price, or a monetary campaign, including mixed baskets.
export function checkoutDiscount({ subtotal, lines, couponCode = '', couponDiscount = 0,
    promotions = [], paymentMethod, paymentConfig = {}, env = process.env }) {
    const base = checkoutCents(subtotal);
    let coupon = Math.min(base, checkoutCents(couponDiscount));
    const appliedPromo = promotions.find(promo =>
        (!promo.min_items || lines.length >= Number(promo.min_items))
        && (!promo.min_value || base >= checkoutCents(promo.min_value))
        && (!promo.applicable_category || lines.some(line => String(line.product_category || '')
            .toLowerCase().includes(String(promo.applicable_category).toLowerCase()))));
    let promotion = appliedPromo ? Number(appliedPromo.discount_percent) > 0
        ? Math.round(base * Number(appliedPromo.discount_percent) / 100)
        : checkoutCents(appliedPromo.discount_fixed || 0) : 0;
    if (!Number.isSafeInteger(promotion) || promotion < 0) throw invalid('Promoção inválida', 500);
    promotion = Math.min(base, promotion);
    if (appliedPromo && !appliedPromo.stacks_with_coupon) {
        if (promotion > coupon) coupon = 0;
        else promotion = 0;
    }
    promotion = Math.min(promotion, base - coupon);
    const offer = pixDiscountOffer(paymentConfig, env);
    const reason = !offer.enabled ? 'offer_disabled' : paymentMethod !== 'pix' ? 'payment_method'
        : couponCode ? 'coupon' : lines.some(line => line.price_promotion) || promotion > 0
            ? 'price_promotion' : null;
    const pix = reason ? 0 : pixDiscountCents(base, offer.percentage);
    return {
        discount: (coupon + promotion + pix) / 100,
        discount_breakdown: { coupon: coupon / 100, promotion: promotion / 100, pix: pix / 100 },
        pix_discount_reason: reason, pix_discount_percentage: offer.percentage,
        appliedPromo: appliedPromo || null,
    };
}

export function assertCheckoutPriceAcknowledged(expected, actual, required = false) {
    if (!expected && !required) return;
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
        throw invalid('Revise o total do pedido antes de confirmar.', 409);
    }
    for (const field of ['subtotal', 'discount', 'shipping_cost', 'total']) {
        if (expected[field] == null || checkoutCents(expected[field]) !== checkoutCents(actual[field])) {
            throw invalid('O total mudou. Revise os descontos e o frete antes de confirmar.', 409);
        }
    }
}
