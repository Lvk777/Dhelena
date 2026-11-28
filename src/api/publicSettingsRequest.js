import { apiUrl } from './apiBase.js';

// Maintenance must be readable without a customer/admin session. A stale or
// unlinked Auth profile must never hide the public maintenance state.
export async function fetchPublicSettingsRecords(apiBase, fetchImpl = fetch) {
    const response = await fetchImpl(apiUrl(apiBase, '/settings?is_public=true'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
    });
    if (!response.ok) throw new Error('Não foi possível verificar o estado da loja.');

    const records = await response.json();
    const maintenance = Array.isArray(records) ? records.filter(row => row?.key === 'maintenance') : [];
    if (maintenance.length !== 1 || maintenance[0].is_public !== true
        || typeof maintenance[0].value?.maintenance_mode !== 'boolean') {
        throw new Error('Resposta de manutenção inválida.');
    }
    return records;
}
