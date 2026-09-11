export const MAINTENANCE_EXEMPT_PREFIXES = [
    '/admin', '/login', '/cadastro', '/esqueci', '/reset-password', '/api', '/health', '/webhooks',
];

/** Returns the maintenance destination, or null when the current route remains available. */
export function getMaintenanceRedirect({ maintenanceEnabled, isAdmin, pathname }) {
    if (!maintenanceEnabled || isAdmin || pathname === '/em-breve') return null;
    if (MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
    return '/em-breve';
}
