const DATABASE_CODES = new Set([
    '08001', '08006', '22001', '22003', '22P02', '23502', '23503', '23505',
    '40001', '40P01', '42501', '42703', '42P01', '53300', '57014',
]);
const SYSTEM_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
    'EACCES', 'ENOENT', 'ENOSPC', 'ERR_NETWORK', 'UND_ERR_CONNECT_TIMEOUT',
    'LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE',
]);
const ERROR_TYPES = new Set(['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'MulterError']);

export function safeErrorMetadata(error) {
    const result = { error_type: 'Error', error_code: null, http_status: 500 };
    // Never copy message, stack, detail, query, request, config, headers or payload.
    try {
        const code = error?.code || error?.cause?.code;
        if (DATABASE_CODES.has(code)) {
            result.error_type = 'DatabaseError';
            result.error_code = code;
        } else {
            if (SYSTEM_CODES.has(code)) result.error_code = code;
            const name = error?.name;
            if (ERROR_TYPES.has(name)) result.error_type = name;
        }
        const status = error?.status ?? error?.statusCode;
        if (Number.isInteger(status) && status >= 400 && status <= 599) result.http_status = status;
    } catch {
        // Hostile getters are not allowed to break an error handler.
    }
    return result;
}

export function logSafeError(event, error, level = 'error') {
    const eventName = typeof event === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(event) ? event : 'backend_error';
    const record = { event: eventName, ...safeErrorMetadata(error) };
    console[level === 'warn' ? 'warn' : 'error'](JSON.stringify(record));
}
