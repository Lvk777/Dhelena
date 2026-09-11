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
    // Build package data from products
    // Each product should have: weight (g), height (cm), width (cm), length (cm)
    // If product doesn't have dimensions, use defaults
    const DEFAULT_WEIGHT = 300;  // 300g
    const DEFAULT_HEIGHT = 10;   // 10cm
    const DEFAULT_WIDTH = 15;     // 15cm
    const DEFAULT_LENGTH = 20;   // 20cm

    const packages = products.map(p => ({
        height: p.height || DEFAULT_HEIGHT,
        width: p.width || DEFAULT_WIDTH,
        length: p.length || DEFAULT_LENGTH,
        weight: p.weight || DEFAULT_WEIGHT,
        insurance_value: totalValue || 0,
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
    for (const carrier of Object.keys(data || {})) {
        const services = data[carrier];
        if (!Array.isArray(services)) continue;
        for (const svc of services) {
            if (svc.error) continue;
            options.push({
                id: svc.id,
                name: svc.name,
                company: svc.company?.name || carrier,
                company_id: svc.company?.id,
                service: svc.name,
                price: parseFloat(svc.price) || 0,
                delivery_time: svc.delivery_time || null,  // days
                delivery_time_min: svc.delivery_time_min || null,
                delivery_time_max: svc.delivery_time_max || null,
                carrier: carrier,
            });
        }
    }

    // Sort by price
    options.sort((a, b) => a.price - b.price);

    return options;
}

// ─── Generate label (comprar envio) ────────────────────────────
export async function generateLabel({ from, to, serviceId, products, orderNumber, totalValue }) {
    const body = {
        service: serviceId,
        agency: null,
        from: {
            name: from.name,
            phone: from.phone,
            email: from.email,
            document: from.document,
            company_document: from.company_document || null,
            state_register: from.state_register || null,
            address: from.address,
            complement: from.complement || null,
            number: from.number,
            district: from.district,
            city: from.city,
            state_abbr: from.state,
            country_id: 'BR',
            postal_code: from.postal_code,
        },
        to: {
            name: to.name,
            phone: to.phone,
            email: to.email,
            document: to.document,
            address: to.address,
            complement: to.complement || null,
            number: to.number,
            district: to.district,
            city: to.city,
            state_abbr: to.state,
            country_id: 'BR',
            postal_code: to.postal_code,
        },
        products: products.map(p => ({
            name: p.name,
            quantity: p.qty,
            unitary_value: p.price,
        })),
        package: {
            height: products[0]?.height || 10,
            width: products[0]?.width || 15,
            length: products[0]?.length || 20,
        },
        options: {
            insurance_value: totalValue || 0,
            receipt: false,
            own_hand: false,
            collect: false,
            non_commercial: true,
        },
        tags: [
            { tag: `Pedido: ${orderNumber}` },
        ],
    };

    const data = await meFetch('/me/shipment/print', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    // Response contains the generated label(s)
    const labels = Array.isArray(data) ? data : [data];
    return labels.map(label => ({
        shipment_id: label.id || label.uuid,
        status: label.status,
        tracking_code: label.tracking_code || label.objects?.[0]?.tracking_code || null,
        service: label.service || serviceId,
        price: label.price || null,
        print_url: label.print_url || null,
    }));
}

// ─── Get tracking info ────────────────────────────────────────
export async function getTracking(shipmentId) {
    const data = await meFetch(`/me/shipment/tracking/${shipmentId}`);
    return {
        tracking_code: data.tracking || null,
        status: data.status || null,
        posted_at: data.posted_at || null,
        delivered_at: data.delivered_at || null,
        history: data.history || [],
    };
}

// ─── Get tracking by code ─────────────────────────────────────
export async function getTrackingByCode(trackingCode) {
    const data = await meFetch(`/me/shipment/tracking?q=${trackingCode}`);
    return {
        tracking_code: data.tracking || trackingCode,
        status: data.status || null,
        posted_at: data.posted_at || null,
        delivered_at: data.delivered_at || null,
        history: data.history || [],
    };
}

// ─── Validate webhook (Melhor Envio uses token in header) ─────
export function validateWebhook(req) {
    const token = process.env.MELHOR_ENVIO_TOKEN;
    if (!token) return false;

    // Melhor Envio sends the webhook token in the header
    const headerToken = req.headers['x-hub-signature'] || req.headers['authorization']?.replace('Bearer ', '') || req.body?.webhook_token;

    if (!headerToken) return false;

    return headerToken === token;
}
