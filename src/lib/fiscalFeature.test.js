import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test('fiscal import remains hidden unless the dedicated build flag is explicitly enabled', async () => {
    vi.stubEnv('VITE_FISCAL_XML_IMPORT_ENABLED', 'false');
    vi.resetModules();
    expect((await import('./fiscalFeature.js')).fiscalXmlImportEnabled).toBe(false);
    vi.stubEnv('VITE_FISCAL_XML_IMPORT_ENABLED', 'true');
    vi.resetModules();
    expect((await import('./fiscalFeature.js')).fiscalXmlImportEnabled).toBe(true);
});
