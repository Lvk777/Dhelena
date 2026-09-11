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

    // Wait for settings to load
    if (loading) return children;

    const isMaintenance = settings.maintenance?.maintenance_mode === true;
    const isAdmin = user?.role === "admin";

    const redirect = getMaintenanceRedirect({ maintenanceEnabled: isMaintenance, isAdmin, pathname: location.pathname });
    if (!redirect) return location.pathname === "/em-breve" ? <ComingSoon /> : children;
    return <Navigate to={redirect} replace />;
}
