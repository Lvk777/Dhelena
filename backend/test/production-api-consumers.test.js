import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Core storefront and admin consumers never fetch API paths from the SPA domain', () => {
    for (const path of ['pages/Contact.jsx', 'components/PromoComponents.jsx', 'components/SizeGuideModal.jsx', 'pages/admin/SizeGuides.jsx', 'pages/admin/Promotions.jsx', 'lib/analytics.js']) {
        const source = fs.readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8');
        assert.equal(/fetch\s*\(\s*['"`]\/api\//.test(source), false, path);
    }
});

test('Optional analytics is not activated by default and never includes auth query values or a full referrer', () => {
    const source = fs.readFileSync(new URL('../../src/lib/analytics.js', import.meta.url), 'utf8');
    assert.ok(source.includes("VITE_ANALYTICS_ENABLED === 'true'"));
    assert.ok(source.includes('if (!ENABLED) return;'));
    assert.ok(!source.includes('page: window.location.pathname + window.location.search'));
    assert.ok(source.includes('new URL(document.referrer).origin'));
});

test('Public boutique pages do not invent business identity, legal terms or garment measurements', () => {
    for (const path of ['components/layout/Footer.jsx', 'pages/ComingSoon.jsx', 'pages/Contact.jsx', 'pages/Home.jsx', 'pages/ProductDetail.jsx', 'components/SizeGuideModal.jsx']) {
        const source = fs.readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8');
        for (const placeholder of ['Silvestre & Sousa', 'Rua das Flores', '5500000000000', '@dhelenas.oficial', 'A primeira troca é por nossa conta', 'DEFAULT_GUIDE']) assert.equal(source.includes(placeholder), false, path + ': ' + placeholder);
    }
});

test('Customer tracking stays in the owned order instead of assuming a carrier or external link', () => {
    const source = fs.readFileSync(new URL('../../src/pages/account/Tracking.jsx', import.meta.url), 'utf8');
    assert.ok(source.includes('to={`/minha-conta/pedidos/${order.id}`}'));
    assert.ok(!source.includes('linkcorreios.com.br'));
    assert.ok(source.includes('order.shipping_carrier'));
    assert.ok(!source.includes('href={order.tracking_link}'));
});
