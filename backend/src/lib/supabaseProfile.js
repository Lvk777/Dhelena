const fields = 'id, email, full_name, phone, cpf, birth_date, role';

function profileError(message, status = 503) {
    return Object.assign(new Error(message), { status });
}

async function syncConfirmedEmail(db, profile, user) {
    const email = user.email.trim().toLowerCase();
    if (profile.email?.toLowerCase() === email) return profile;
    try {
        const result = await db.query(`UPDATE profiles SET email = $1, updated_at = now() WHERE id = $2 RETURNING ${fields}`, [email, profile.id]);
        if (!result.rows[0]) throw profileError('Perfil indisponível.');
        return { ...result.rows[0], ...(profile.identity_linked ? { identity_linked: true } : {}) };
    } catch (error) {
        if (error.code === '23505') throw profileError('Alteração de e-mail exige verificação de identidade.', 409);
        throw error;
    }
}

// Call only with the user returned by auth.getUser(accessToken), never a
// decoded token, request body, or user-editable metadata object.
export async function ensureSupabaseProfile(db, user) {
    if (!user?.id || !user.email || user.is_anonymous || !user.email_confirmed_at) {
        throw profileError('Confirme seu e-mail para acessar o perfil.', 401);
    }
    const email = user.email.trim().toLowerCase();
    // An independently verified link takes precedence over a customer profile
    // that Auth provisioning may have created for the same immutable UUID.
    // The link table is private and never populated from an email match.
    const schema = await db.query("SELECT to_regclass('public.profile_auth_links') AS relation");
    let linkedProfile = null;
    if (schema.rows[0]?.relation) {
        const linked = await db.query(`SELECT p.id,p.email,p.full_name,p.phone,p.cpf,p.birth_date,p.role
            FROM profiles p JOIN profile_auth_links l ON l.profile_id = p.id WHERE l.auth_user_id = $1`, [user.id]);
        if (linked.rows.length > 1) throw profileError('Identidade ambígua.', 409);
        if (linked.rows[0]) linkedProfile = { ...linked.rows[0], identity_linked: true };
    }
    const existing = await db.query(`SELECT ${fields} FROM profiles WHERE id = $1 LIMIT 1`, [user.id]);
    if (linkedProfile) {
        const shadow = existing.rows[0];
        if (!shadow || shadow.role !== 'customer' || shadow.email?.toLowerCase() !== email) {
            throw profileError('Vínculo administrativo exige reconciliação.', 409);
        }
        // Preserve both stored emails and histories. Expose the verified
        // Auth address to the current session without writing either row.
        return { ...linkedProfile, email };
    }
    if (existing.rows.length) return syncConfirmedEmail(db, existing.rows[0], user);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        // Serialize first requests for the same verified email. UUID uniqueness
        // also handles a concurrent email change or an Auth profile trigger.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`supabase-profile:${email}`]);
        const byId = await client.query(`SELECT ${fields} FROM profiles WHERE id = $1 LIMIT 1`, [user.id]);
        let profile = byId.rows[0];
        // A link created concurrently with this first request becomes
        // effective on the next request; this transaction never grants it.
        if (!profile) {
            const legacy = await client.query(
                `SELECT ${fields} FROM profiles WHERE lower(email) = $1 LIMIT 2 FOR UPDATE`, [email]);
            if (legacy.rows.length > 1) throw profileError('Perfil exige reconciliação.', 409);
            // A verified mailbox is insufficient proof of ownership of a
            // privileged legacy profile. Require an explicit, reviewed link.
            if (legacy.rows[0]?.role === 'admin' && legacy.rows[0].id !== user.id) {
                throw profileError('Perfil administrativo exige vinculação verificada.', 409);
            }
            // Preserve legacy UUIDs and their orders. Only the verified Auth
            // email may use this compatibility path; do not rewrite role or ID.
            profile = legacy.rows[0];
        }
        if (!profile) {
            const fullName = typeof user.user_metadata?.full_name === 'string'
                ? user.user_metadata.full_name.trim().slice(0, 200) || null : null;
            const created = await client.query(
                `INSERT INTO profiles (id, email, password_hash, full_name, role)
                 VALUES ($1, $2, '!supabase-auth-only', $3, 'customer')
                 ON CONFLICT DO NOTHING RETURNING ${fields}`, [user.id, email, fullName]);
            profile = created.rows[0];
            if (!profile) {
                const concurrent = await client.query(`SELECT ${fields} FROM profiles WHERE id = $1 LIMIT 1`, [user.id]);
                profile = concurrent.rows[0];
            }
            if (!profile) throw profileError('Perfil exige reconciliação.', 409);
        }
        if (profile.id === user.id || profile.identity_linked) profile = await syncConfirmedEmail(client, profile, user);
        await client.query('COMMIT');
        return profile;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function authenticateSupabaseProfile(admin, db, token, onVerifiedUser = () => {}) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) {
        if (error && (!error.status || error.status >= 500)) {
            throw profileError('Autenticação temporariamente indisponível.');
        }
        return null;
    }
    onVerifiedUser(data.user);
    return ensureSupabaseProfile(db, data.user);
}
