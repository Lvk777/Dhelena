import crypto from 'crypto';

/**
 * Melhor Envio Service — Freight calculation, label generation, tracking
 * Uses MELHOR_ENVIO_TOKEN (server-side only)
 * Sandbox: https://sandbox.melhorenvio.com.br/api/v2
 * Production: https://melhorenvio.com.br/api/v2
 */

function getBaseUrl() {
    const mode = process.env.MELHOR_ENVIO_MODE || 'sandbox';
    return mode === 'production'
        ? 'https://melhorenvio.com.br/api/v2'
        : 'https://sandbox.melhorenvio.com.br/api/v2';
}

function getToken() {
    const token = process.env.MELHOR_ENVIO_TOKEN;
    if (!token) throw Object.assign(new Error('MELHOR_ENVIO_TOKEN não configurado'), { status: 500 });
    return token;
}

function isSandbox() {
    return (process.env.MELHOR_ENVIO_MODE || 'sandbox') !== 'production';
}

async function meFetch(path, options = {}) {
    const token = getToken();
    const url = path.startsWith('http') ? path : `${getBaseUrl()}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': process.env.MELHOR_ENVIO_USER_AGENT || "D'Helenas (atendimento@dhelenas.com.br)",
            ...(options.headers || {}),
        },
    });
    const data = await res.json();
    if (!res.ok) {
        const msg = data.message || data.error || `Melhor Envio API error (${res.status})`;
        throw Object.assign(new Error(msg), { status: res.status, meError: data });
    }
    return data;
}

// ─── Test connection ──────────────────────────────────────────
export async function testConnection() {
    try {
        const token = process.env.MELHOR_ENVIO_TOKEN;
        if (!token) return { connected: false, error: 'Token não configurado' };

        const data = await meFetch('/me');
        return {
            connected: true,
            environment: isSandbox() ? 'Sandbox (teste)' : 'Produção',
            company: data.company || data.name || '—',
            email: data.email || '—',
        };
    } catch (err) {
        return { connected: false, error: err.message };
    }
}

// ─── Calculate freight (cotação) ──────────────────────────────
export async function calculateShipping({ fromPostalCode, toPostalCode, products, totalValue }) {
    // Catalog values use the provider's documented units: kilograms and cm.
    const packages = products.map(p => ({
        id: String(p.id || ''),
        height: Number(p.height),
        width: Number(p.width),
        length: Number(p.length),
        weight: Number(p.weight),
        insurance_value: Number(p.insurance_value),
        quantity: p.qty || 1,
    }));

    const body = {
        from: { postal_code: fromPostalCode },
        to: { postal_code: toPostalCode },
        products: packages,
        options: {
            receipt: false,
            own_hand: false,
            collect: false,
        },
    };

    const data = await meFetch('/me/shipment/calculate', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    // Filter and format available shipping options
    const options = [];
    const groups = Array.isArray(data)
        ? [{ carrier: null, services: data }]
        : Object.entries(data || {}).map(([carrier, services]) => ({ carrier, services }));
    for (const group of groups) {
        if (!Array.isArray(group.services)) continue;
        for (const svc of group.services) {
            if (svc.error) continue;
            const price = Number.parseFloat(svc.custom_price ?? svc.price);
            if (!Number.isFinite(price) || price < 0) continue;
            options.push({
                id: svc.id,
                name: svc.name,
                company: svc.company?.name || group.carrier,
                company_id: svc.company?.id,
                service: svc.name,
                price,
                delivery_time: svc.custom_delivery_time ?? svc.delivery_time ?? null,
                delivery_time_min: svc.custom_delivery_range?.min ?? svc.delivery_range?.min ?? null,
                delivery_time_max: svc.custom_delivery_range?.max ?? svc.delivery_range?.max ?? null,
                carrier: group.carrier || svc.company?.name || null,
                packages: Array.isArray(svc.packages) ? svc.packages.map(pkg => ({
                    height: Number(pkg.dimensions?.height),
                    width: Number(pkg.dimensions?.width),
                    length: Number(pkg.dimensions?.length),
                    weight: Number(pkg.weight),
                    insurance_value: Number(pkg.insurance_value || 0),
                })) : [],
            });
        }
    }

    // Sort by price
    options.sort((a, b) => a.price - b.price);

    return options;
}

function participant(data, includeCountry = false) {
    const digits = String(data.document || data.company_document || '').replace(/\D/g, '');
    const result = {
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        complement: data.complement || null,
        number: data.number,
        district: data.district,
        city: data.city,
        state_abbr: data.state,
        postal_code: data.postal_code,
    };
    if (includeCountry) result.country_id = 'BR';
    if (digits.length === 14) {
        result.company_document = digits;
        result.state_register = data.state_register || 'ISENTO';
    } else {
        result.document = digits;
    }
    return result;
}

// ─── Label lifecycle: cart → checkout → generate → print ──────
export async function addShipmentToCart({ from, to, serviceId, products, volumes, orderNumber, totalValue }) {
    if (!Array.isArray(volumes) || volumes.length === 0) {
        throw Object.assign(new Error('Cotação sem volumes confirmados para gerar a etiqueta'), { status: 409 });
    }
    const body = {
        service: Number(serviceId),
        from: participant(from),
        to: participant(to, true),
        products: products.map(p => ({
            name: p.name,
            quantity: Number(p.qty),
            unitary_value: Number(p.price),
        })),
        volumes: volumes.map(volume => ({
            height: Number(volume.height),
            width: Number(volume.width),
            length: Number(volume.length),
            weight: Number(volume.weight),
        })),
        options: {
            insurance_value: totalValue || 0,
            receipt: false,
            own_hand: false,
            reverse: false,
            platform: "D'Helenas",
            tags: [{ tag: orderNumber, url: null }],
        },
    };

    const data = await meFetch('/me/cart', {
        method: 'POST',
        body: JSON.stringify(body),
    });
    const shipmentId = data.id || data.uuid;
    if (!shipmentId) throw Object.assign(new Error('Melhor Envio não retornou o ID do envio'), { status: 502 });
    return { shipment_id: String(shipmentId), status: data.status || 'cart_created' };
}

export async function checkoutShipments(shipmentIds) {
    return meFetch('/me/shipment/checkout', { method: 'POST', body: JSON.stringify({ orders: shipmentIds }) });
}

export async function generateShipments(shipmentIds) {
    return meFetch('/me/shipment/generate', { method: 'POST', body: JSON.stringify({ orders: shipmentIds }) });
}

export async function printShipments(shipmentIds) {
    const data = await meFetch('/me/shipment/print', {
        method: 'POST',
        body: JSON.stringify({ mode: 'public', orders: shipmentIds }),
    });
    return { print_url: data.url || data.print_url || data.link || null };
}

export async function generateLabel(input) {
    const shipment = await addShipmentToCart(input);
    await checkoutShipments([shipment.shipment_id]);
    await generateShipments([shipment.shipment_id]);
    const printed = await printShipments([shipment.shipment_id]);
    const tracking = await getTracking(shipment.shipment_id).catch(() => ({}));
    return [{ ...shipment, status: 'generated', tracking_code: tracking.tracking_code || null, ...printed }];
}

// ─── Get tracking info ────────────────────────────────────────
export async function getTracking(shipmentId) {
    const data = await meFetch('/me/shipment/tracking', {
        method: 'POST',
        body: JSON.stringify({ orders: [String(shipmentId)] }),
    });
    const record = Array.isArray(data)
        ? data[0]
        : data?.[shipmentId] || data?.[String(shipmentId)] || data?.data?.[shipmentId] || data;
    return {
        tracking_code: record?.tracking || record?.tracking_code || null,
        status: record?.status || null,
        posted_at: record?.posted_at || null,
        delivered_at: record?.delivered_at || null,
        history: record?.history || [],
    };
}

// ─── Get tracking by code ─────────────────────────────────────
export async function getTrackingByCode(trackingCode) {
    const data = await meFetch(`/me/orders/search?q=${encodeURIComponent(trackingCode)}`);
    const record = Array.isArray(data) ? data[0] : data;
    return {
        tracking_code: record?.tracking || trackingCode,
        status: record?.status || null,
        posted_at: record?.posted_at || null,
        delivered_at: record?.delivered_at || null,
        history: record?.history || [],
    };
}

// ─── Validate webhook (official Melhor Envio HMAC-SHA256) ─────
export function validateWebhook(req) {
    const secret = process.env.MELHOR_ENVIO_WEBHOOK_SECRET;
    const signature = req.headers['x-me-signature'];
    if (!secret || typeof signature !== 'string' || !Buffer.isBuffer(req.rawBody)) return false;

    // The official X-ME-Signature representation is base64.
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');
    return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
