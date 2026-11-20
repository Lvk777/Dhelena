/**
 * Require certificate and hostname verification for the production database.
 * `pg` parses sslmode from the connection URI *after* its `ssl` option, so a
 * URI containing sslmode=no-verify could otherwise silently disable TLS checks.
 */
export function databaseConnectionOptions(connectionString, { production = false, caPem = process.env.DATABASE_SSL_CA_PEM } = {}) {
    const supabase = /supabase/i.test(connectionString);
    if (!production && !supabase) return { connectionString, ssl: false };

    let url;
    try { url = new URL(connectionString); }
    catch { throw new Error('DATABASE_URL inválida.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new Error('DATABASE_URL deve usar PostgreSQL.');
    }
    // Do not accept a URI that explicitly opts out of certificate validation.
    const requestedMode = url.searchParams.get('sslmode')?.toLowerCase();
    if (['disable', 'allow', 'prefer', 'no-verify'].includes(requestedMode)) {
        throw new Error('DATABASE_URL exige verificação do certificado TLS.');
    }
    // pg-connection-string overrides the explicit `ssl` object whenever the
    // connection URI contains sslmode. Remove it and let node TLS validate the
    // certificate and hostname, optionally using Supabase's root certificate.
    url.searchParams.delete('sslmode');
    const ssl = { rejectUnauthorized: true };
    if (caPem) ssl.ca = caPem.replace(/\\n/g, '\n');
    return { connectionString: url.toString(), ssl };
}
