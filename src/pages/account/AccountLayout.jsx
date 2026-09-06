import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, Truck, Heart, MapPin, User, KeyRound, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const MENU = [
    { to: "/minha-conta", label: "Visão geral", icon: LayoutDashboard, end: true },
    { to: "/minha-conta/pedidos", label: "Meus pedidos", icon: Package },
    { to: "/minha-conta/rastreamento", label: "Rastreamento", icon: Truck },
    { to: "/minha-conta/favoritos", label: "Meus favoritos", icon: Heart },
    { to: "/minha-conta/enderecos", label: "Meus endereços", icon: MapPin },
    { to: "/minha-conta/dados", label: "Meus dados", icon: User },
    { to: "/minha-conta/senha", label: "Alterar senha", icon: KeyRound },
];

export default function AccountLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);
    const firstName = (user?.full_name || user?.email || "").split(" ")[0];

    const handleLogout = () => {
        logout(false);
        navigate("/");
        window.location.href = "/";
    };

    const SidebarContent = () => (
        <>
            <div className="px-6 py-8 border-b border-border">
                <p className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--gold))]">Minha conta</p>
                <h2 className="font-heading text-2xl tracking-[0.04em] mt-1">Olá, {firstName}</h2>
            </div>
            <nav className="flex-1 py-4">
                {MENU.map((m) => (
                    <NavLink
                        key={m.to}
                        to={m.to}
                        end={m.end}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-6 py-3.5 text-sm transition-colors ${isActive ? "bg-[hsl(var(--bone))] text-foreground border-l-2 border-[hsl(var(--gold))]" : "text-foreground/70 hover:text-foreground hover:bg-[hsl(var(--bone))]/50"}`
                        }
                    >
                        <m.icon className="w-4 h-4" strokeWidth={1.5} />
                        <span className="tracking-wide">{m.label}</span>
                    </NavLink>
                ))}
            </nav>
            <div className="border-t border-border p-4">
                <button onClick={handleLogout} className="flex items-center gap-3 px-2 py-3 text-sm text-foreground/70 hover:text-[hsl(var(--rose))] transition-colors w-full">
                    <LogOut className="w-4 h-4" strokeWidth={1.5} />
                    <span className="tracking-wide">Sair da conta</span>
                </button>
            </div>
        </>
    );

    return (
        <div className="min-h-screen bg-background flex flex-col lg:flex-row">
            {/* desktop sidebar */}
            <aside className="hidden lg:flex w-72 flex-col border-r border-border bg-background shrink-0">
                <div className="px-6 py-6 border-b border-border">
                    <NavLink to="/" className="block">
                        <span className="font-heading text-2xl tracking-[0.08em]">D'Helenas</span>
                        <span className="block text-[8px] uppercase tracking-[0.4em] text-[hsl(var(--gold))] mt-1">Método Ponte</span>
                    </NavLink>
                </div>
                <SidebarContent />
            </aside>

            {/* mobile header */}
            <div className="lg:hidden flex items-center justify-between px-5 h-16 border-b border-border sticky top-0 bg-background z-30">
                <NavLink to="/" className="font-heading text-xl tracking-[0.08em]">D'Helenas</NavLink>
                <button onClick={() => setMobileOpen(true)} aria-label="Menu"><Menu className="w-5 h-5" strokeWidth={1.25} /></button>
            </div>

            {/* mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="absolute left-0 top-0 h-full w-72 max-w-[85%] bg-background shadow-xl flex flex-col animate-fade-in">
                        <div className="flex items-center justify-end px-4 h-14 border-b border-border">
                            <button onClick={() => setMobileOpen(false)} aria-label="Fechar"><X className="w-5 h-5" strokeWidth={1.25} /></button>
                        </div>
                        <SidebarContent />
                    </div>
                </div>
            )}

            {/* content */}
            <main className="flex-1 overflow-x-hidden">
                <div className="container-boutique py-10 lg:py-14 max-w-4xl">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}