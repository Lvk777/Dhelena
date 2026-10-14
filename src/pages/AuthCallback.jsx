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
            .catch(() => { if (active) setError('Link inválido, expirado ou autenticação cancelada. Solicite um novo link ou tente entrar novamente.'); });
        return () => { active = false; };
    }, [navigate]);
    return <AuthLayout title={error ? 'Não foi possível concluir' : 'Confirmando seu acesso'} subtitle="D’Helenas — acesso seguro">
        {error ? <><p role="alert" className="text-sm text-destructive mb-5">{error}</p><Link to="/login" className="btn-gold w-full">Voltar para entrar</Link><Link to="/esqueci-minha-senha" className="block mt-5 text-sm underline">Solicitar outro link de recuperação</Link></>
            : <p role="status" className="text-sm">Aguarde enquanto validamos seu acesso.</p>}
    </AuthLayout>;
}
