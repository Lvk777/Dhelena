import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { client } from '@/api/apiClient';
import AuthLayout from '@/components/AuthLayout';
export default function AuthCallback() {
    const navigate = useNavigate();
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        Promise.resolve().then(() => client.auth.finishCallback())
            .then(result => { if (active) navigate(result.path, { replace: true }); })
            .catch(err => { if (active) setError(err?.message || 'Não foi possível validar o link. Solicite outro ou tente entrar novamente.'); });
        return () => { active = false; };
    }, [navigate]);
    return <AuthLayout title={error ? 'Não foi possível concluir' : 'Confirmando seu acesso'} subtitle="D’Helenas — acesso seguro">
        {error ? <><p role="alert" className="text-sm text-destructive mb-5">{error}</p><Link to="/login" className="btn-gold w-full">Entrar</Link><Link to="/reenviar-confirmacao" className="block mt-5 text-sm underline">Reenviar confirmação de cadastro</Link><Link to="/esqueci-minha-senha" className="block mt-3 text-sm underline">Solicitar recuperação de senha</Link></>
            : <p role="status" className="text-sm">Aguarde enquanto validamos seu acesso.</p>}
    </AuthLayout>;
}
