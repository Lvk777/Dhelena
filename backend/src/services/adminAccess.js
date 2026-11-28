import { pool, withTransaction } from '../config/db.js';
const failure = (status, message) => Object.assign(new Error(message), { status });
export async function accessReadiness(db = pool, env = process.env) {
    if (env.ADMIN_ACCESS_MANAGEMENT_ENABLED !== 'true') return false;
    const { rows } = await db.query("SELECT to_regclass('public.admin_authorities') AS relation");
    return !!rows[0]?.relation;
}
export async function readAdminAccess(actor, { db = pool, env = process.env } = {}) {
    if (!await accessReadiness(db, env)) return { available: false, can_manage: false, collaborators: [] };
    const owner = await db.query("SELECT profile_id FROM admin_authorities WHERE profile_id=$1 AND authority='owner' AND active=true", [actor.id]);
    if (actor.role !== 'admin' || actor.authProvider !== 'supabase' || actor.identityVerified !== true || !owner.rows.length) return { available: true, can_manage: false, collaborators: [] };
    const collaborators = await db.query(`SELECT p.id,p.full_name,p.email,p.role,a.active,a.authority FROM profiles p
        LEFT JOIN admin_authorities a ON a.profile_id=p.id WHERE p.role='admin' OR a.profile_id IS NOT NULL ORDER BY p.full_name`);
    return { available: true, can_manage: true, collaborators: collaborators.rows };
}
export async function changeAdminAccess(actor, targetId, body, { db = pool, env = process.env, transaction = withTransaction } = {}) {
    if (actor.role !== 'admin' || actor.authProvider !== 'supabase' || actor.identityVerified !== true) throw failure(403, 'Autoridade não comprovada.');
    if (!await accessReadiness(db, env)) throw failure(503, 'Gerenciamento de colaboradores ainda indisponível.');
    if (!body || Object.keys(body).some(k => k !== 'grant') || typeof body.grant !== 'boolean'
        || typeof targetId !== 'string' || !/^[0-9a-f-]{36}$/i.test(targetId) || targetId === actor.id) throw failure(400, 'Solicitação de acesso inválida.');
    return transaction(async client => {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        // One authority lock serializes grants, revocations and checks for stale owners.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dhelenas-admin-access',0))");
        const currentActor = await client.query("SELECT p.id FROM profiles p JOIN admin_authorities a ON a.profile_id=p.id WHERE p.id=$1 AND p.role='admin' AND a.authority='owner' AND a.active=true FOR UPDATE OF p,a", [actor.id]);
        if (!currentActor.rows.length) throw failure(403, 'Somente a proprietária autorizada pode gerenciar acessos.');
        const target = await client.query('SELECT id,role FROM profiles WHERE id=$1 FOR UPDATE', [targetId]);
        if (!target.rows.length) throw failure(404, 'Conta não encontrada.');
        const authority = await client.query('SELECT authority,active FROM admin_authorities WHERE profile_id=$1 FOR UPDATE', [targetId]);
        if (authority.rows[0]?.authority === 'owner') throw failure(403, 'A autoridade da proprietária não pode ser alterada por este fluxo.');
        const role = body.grant ? 'admin' : 'customer';
        if (target.rows[0].role === role && authority.rows[0]?.active === body.grant) return { success: true, unchanged: true };
        await client.query('UPDATE profiles SET role=$1, updated_at=now() WHERE id=$2', [role, targetId]);
        await client.query("INSERT INTO admin_authorities(profile_id,authority,active) VALUES($1,'staff',$2) ON CONFLICT(profile_id) DO UPDATE SET active=$2,updated_at=now()", [targetId, body.grant]);
        await client.query("INSERT INTO audit_logs(action,entity_type,entity_id,changes) VALUES('administrative_access_changed','profile',$1,$2)", [targetId, JSON.stringify({ actor_id: actor.id, before: target.rows[0].role, after: role })]);
        return { success: true };
    });
}
