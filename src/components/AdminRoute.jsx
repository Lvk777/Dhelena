import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export default function AdminRoute({ children }) {
    const { user, isLoadingAuth, authError, checkUserAuth } = useAuth();
    const location = useLocation();

    if (isLoadingAuth) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-background">
                <div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} state={{ from: location.pathname }} replace />;
    }

    if (authError) return <main role="alert" className="p-8 text-center"><p>Não foi possível verificar sua permissão.</p><button className="btn-gold mt-4" onClick={() => checkUserAuth()}>Tentar novamente</button></main>;
    if (user.role !== "admin") {
        return <Navigate to="/minha-conta" replace />;
    }

    if (user.admin_mfa_required && user.auth_aal !== 'aal2') {
        return <Navigate to="/minha-conta/senha" replace />;
    }

    return children;
}
