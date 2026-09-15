import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { useAuth } from "@/lib/AuthContext";
import ComingSoon from "@/pages/ComingSoon";
import { getMaintenanceRedirect } from "@/lib/maintenance";

export default function MaintenanceGuard({ children }) {
    const { settings, loading } = usePublicSettings();
    const { user } = useAuth();
    const location = useLocation();

    // Do not render guarded routes until maintenance status is known. Otherwise a
    // nested auth guard can redirect before maintenance gets a chance to run.
    if (loading) {
        return (
            <div className="fixed inset-0 flex items-center justify-center" role="status" aria-label="Carregando loja">
                <div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin" />
            </div>
        );
    }

    const isMaintenance = settings.maintenance?.maintenance_mode === true;
    const isAdmin = user?.role === "admin";

    const redirect = getMaintenanceRedirect({ maintenanceEnabled: isMaintenance, isAdmin, pathname: location.pathname });
    if (!redirect) return location.pathname === "/em-breve" ? <ComingSoon /> : children;
    return <Navigate to={redirect} replace />;
}
