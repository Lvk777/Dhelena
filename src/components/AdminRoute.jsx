import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export default function AdminRoute({ children }) {
    const { user, isLoadingAuth } = useAuth();
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

    if (user.role !== "admin") {
        return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
    }

    return children;
}