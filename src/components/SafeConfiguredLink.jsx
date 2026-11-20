import React from 'react';
import { Link } from 'react-router-dom';
import { usePublicSettings } from '@/context/PublicSettingsContext';
import { safeNavigation } from '../../backend/src/lib/navigation.js';

export default function SafeConfiguredLink({ to, children, className = '', ...props }) {
    const { settings } = usePublicSettings();
    const link = safeNavigation(to, {
        origin: typeof window === 'undefined' ? 'https://dhelenas.com' : window.location.origin,
        allowedOrigins: settings.general?.external_link_origins || [],
    });
    if (!link) return null;
    const classes = `min-w-0 max-w-full [overflow-wrap:anywhere] [&>svg]:shrink-0 ${className}`;
    return link.external
        ? <a {...props} className={classes} href={link.href} target="_blank" rel="noopener noreferrer">{children}</a>
        : <Link {...props} className={classes} to={link.href}>{children}</Link>;
}
