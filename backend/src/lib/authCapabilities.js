export async function authCapabilities({ env = process.env, request = fetch } = {}) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { available: false, google: false };
    try {
        const url = new URL('/auth/v1/settings', env.SUPABASE_URL);
        if (url.protocol !== 'https:') return { available: false, google: false };
        const response = await request(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) return { available: false, google: false };
        const settings = await response.json();
        return { available: true, google: settings.external?.google === true };
    } catch { return { available: false, google: false }; }
}
