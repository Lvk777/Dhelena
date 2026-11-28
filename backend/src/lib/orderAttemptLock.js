// Serialize provider creation and administrative absence checks for one order.
export const orderAttemptLockSql = "hashtextextended('pix-attempt:' || $1::text, 0)";

// Keep reservation and persistence on the lock-owning connection. Waiting
// advisory locks must not exhaust the pool while the holder asks for another.
export async function withAttemptTransaction(client, callback) {
    await client.query('BEGIN');
    try {
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}
