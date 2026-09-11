import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePublicSettings } from "@/context/PublicSettingsContext";
import { useAuth } from "@/lib/AuthContext";
import ComingSoon from "@/pages/ComingSoon";

// Routes that are NEVER blocked by maintenance mode
const EXEMPT_PREFIXES = ["/admin", "/login", "/cadastro", "/esqueci", "/reset-password", "/api", "/health", "/webhooks"];

export default function MaintenanceGuard({ children }) {
    const { settings, loading } = usePublicSettings();
    const { user } = useAuth();
    const location = useLocation();

    // Wait for settings to load
    if (loading) return children;

    const isMaintenance = settings.maintenance?.maintenance_mode === true;
    const isAdmin = user?.role === "admin";

    // If maintenance is off, or user is admin, allow everything
    if (!isMaintenance || isAdmin) return children;

    // Check if current path is exempt
    const isExempt = EXEMPT_PREFIXES.some((prefix) => location.pathname.startsWith(prefix));

    if (isExempt) return children;

    // If already on /em-breve, show it
    if (location.pathname === "/em-breve") return <ComingSoon />;

    // Redirect all other public routes to /em-breve
    return <Navigate to="/em-breve" replace />;
}
