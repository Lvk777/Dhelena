import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** A password input with its own visibility state, so adjacent fields stay independent. */
export default function PasswordInput({ id, visibilityLabel = 'senha', leadingIcon: Icon = null, className = '', style = undefined, ...inputProps }) {
    const [visible, setVisible] = useState(false);
    const action = `${visible ? 'Ocultar' : 'Mostrar'} ${visibilityLabel}`;

    return <span className="relative block">
        {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
        <input {...inputProps} id={id} type={visible ? 'text' : 'password'} className={className} style={{ ...style, paddingRight: '3.5rem' }} />
        <button
            type="button"
            onClick={() => setVisible(value => !value)}
            aria-label={action}
            aria-pressed={visible}
            aria-controls={id}
            title={action}
            className="absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--gold))]"
        >
            {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
    </span>;
}
