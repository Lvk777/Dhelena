import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = name => readFile(new URL(`../supabase/auth-email-templates/${name}.html`, import.meta.url), 'utf8');

test('confirmation template builds a same-site token hash link with the official email OTP type', async () => {
    const html = await template('confirm-signup');
    const href = html.match(/href="([^"]+)"/)?.[1];
    assert.ok(href);
    const url = new URL(href.replaceAll('&amp;', '&').replace('{{ .SiteURL }}', 'https://dhelenas.com').replace('{{ .TokenHash }}', 'synthetic-hash'));
    assert.equal(url.origin, 'https://dhelenas.com');
    assert.equal(url.pathname, '/auth/callback');
    const hash = new URLSearchParams(url.hash.slice(1));
    assert.equal(url.searchParams.has('token_hash'), false);
    assert.equal(hash.get('token_hash'), 'synthetic-hash');
    assert.equal(hash.get('type'), 'email');
    assert.equal(url.searchParams.get('flow'), 'signup');
    assert.equal(url.searchParams.get('returnTo'), '/minha-conta/dados');
    assert.match(html, /{{ \.Token }}/);
});

test('recovery template keeps its own token purpose and every Auth template is branded', async () => {
    const recovery = await template('recovery');
    assert.match(recovery, /#token_hash={{ \.TokenHash }}&amp;type=recovery/);
    assert.match(recovery, /flow=recovery/);
    for (const name of ['confirm-signup', 'recovery', 'email-change', 'invite', 'magic-link', 'reauthentication']) {
        const html = await template(name);
        assert.match(html, /lang="pt-BR"/);
        assert.match(html, /D’Helenas/);
        assert.doesNotMatch(html, /Arial|Confirm your email address/);
    }
    assert.match(await template('reauthentication'), /{{ \.Token }}/);
});
