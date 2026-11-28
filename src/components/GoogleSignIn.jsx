import React, { useEffect, useState } from 'react';
import GoogleIcon from './GoogleIcon';
import { client } from '@/api/apiClient';
export default function GoogleSignIn({ loading, onClick, label = 'Entrar com Google' }) {
    const [available, setAvailable] = useState(null);
    useEffect(() => { let active = true;
        client.auth.providerStatus().then(status => { if (active) setAvailable(status.google === true); }).catch(() => { if (active) setAvailable(false); });
        return () => { active = false; };
    }, []);
    return <div className="mb-5"><button type="button" onClick={onClick} disabled={loading || available !== true}
        className="w-full min-h-12 flex items-center justify-center gap-2 border border-border bg-background text-sm font-medium hover:border-foreground/40 transition-colors disabled:opacity-60">
        <GoogleIcon className="w-4 h-4" />{label}</button>
        {available === false && <p className="text-xs text-muted-foreground mt-2">O acesso Google está indisponível no momento. Utilize e-mail e senha.</p>}
    </div>;
}
