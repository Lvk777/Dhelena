import React, { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, Link } from "react-router-dom";
import {
    LayoutDashboard, Package, ShoppingCart, FolderTree, Layers, Boxes,
    Users, Ticket, Image, BarChart3, Settings, Menu, X, LogOut, ExternalLink, Sun, Moon, ShieldCheck, Tag, Ruler, Plug
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { logAdminAction } from "@/lib/audit";

const MENU = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/pedidos", label: "Pedidos", icon: ShoppingCart },
    { to: "/admin/produtos", label: "Produtos", icon: Package },
    { to: "/admin/categorias", label: "Categorias", icon: FolderTree },
    { to: "/admin/colecoes", label: "Coleções", icon: Layers },
    { to: "/admin/estoque", label: "Estoque", icon: Boxes },
    { to: "/admin/clientes", label: "Clientes", icon: Users },
    { to: "/admin/cupons", label: "Cupons", icon: Ticket },
    { to: "/admin/banners", label: "Banners", icon: Image },
    { to: "/admin/promocoes", label: "Promoções", icon: Tag },
    { to: "/admin/guias-medidas", label: "Guias de Medidas", icon: Ruler },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
    { to: "/admin/auditoria", label: "Auditoria", icon: ShieldCheck },
    { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
    { to: "/admin/integracoes", label: "Integrações", icon: Plug },
];

export default function AdminLayout() {
    const { user, logout } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [theme, setTheme] = useState(() => localStorage.getItem("admin-theme") || "light");

    // On login: load preferred_theme from DB (overrides localStorage)
    useEffect(() => {
        if (user?.preferred_theme) {
            setTheme(user.preferred_theme);
        }
    }, [user]);

    useEffect(() => {
        const root = document.documentElement;
        if (theme === "dark") root.classList.add("dark");
        else root.classList.remove("dark");
        localStorage.setItem("admin-theme", theme);
    }, [theme]);

    useEffect(() => () => document.documentElement.classList.remove("dark"), []);

    // Registrar acesso admin no AuditLog — UMA vez por sessão do navegador.
    // Previne duplicação por remount (navegar fora/volta do /admin) ou StrictMode.
    const loginLogged = useRef(false);
    useEffect(() => {
        if (user?.role === "admin" && !loginLogged.current && !sessionStorage.getItem("dh_admin_login_logged")) {
            loginLogged.current = true;
            sessionStorage.setItem("dh_admin_login_logged", new Date().toISOString());
            logAdminAction("login_admin", "User", user.id, user.email, "Acesso ao painel administrativo");
        }
    }, [user]);

    const toggleTheme = async () => {
        const newTheme = theme === "dark" ? "light" : "dark";
        setTheme(newTheme);
        localStorage.setItem("admin-theme", newTheme);
        if (user?.role === "admin") {
            try { await base44.auth.updateMe({ preferred_theme: newTheme }); } catch { }
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem("dh_admin_login_logged");
        logout(false);
        window.location.href = "/";
    };

    const Sidebar = () => (
        <>
            <div className="px-5 py-5 border-b border-border">
                <Link to="/admin" className="block">
                    <span className="font-heading text-xl tracking-[0.08em]">D'Helenas</span>
                    <span className="block text-[8px] uppercase tracking-[0.3em] text-[hsl(var(--gold))] mt-0.5">Painel administrativo</span>
                </Link>
            </div>
            <nav className="flex-1 py-3 overflow-y-auto">
                {MENU.map((m) => (
                    <NavLink
                        key={m.to}
                        to={m.to}
                        end={m.end}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-5 py-2.5 text-[13px] transition-colors ${isActive ? "bg-[hsl(var(--bone))] text-foreground border-l-2 border-[hsl(var(--gold))]" : "text-foreground/65 hover:text-foreground hover:bg-[hsl(var(--bone))]/50"}`
                        }
                    >
                        <m.icon className="w-4 h-4" strokeWidth={1.5} />
                        <span>{m.label}</span>
                    </NavLink>
                ))}
            </nav>
            <div className="border-t border-border p-3 space-y-1">
                <Link to="/" className="flex items-center gap-3 px-2 py-2 text-[13px] text-foreground/65 hover:text-foreground transition-colors">
                    <ExternalLink className="w-4 h-4" strokeWidth={1.5} /> Ver loja
                </Link>
                <div className="px-2 py-2 text-[11px] text-muted-foreground truncate">{user?.email}</div>
                <button onClick={handleLogout} className="flex items-center gap-3 px-2 py-2 text-[13px] text-foreground/65 hover:text-[hsl(var(--rose))] transition-colors w-full">
                    <LogOut className="w-4 h-4" strokeWidth={1.5} /> Sair
                </button>
            </div>
        </>
    );

    return (
        <div className="min-h-screen bg-[hsl(var(--bone))] flex">
            {/* desktop sidebar */}
            <aside className="hidden lg:flex w-60 flex-col bg-background border-r border-border shrink-0 fixed h-screen">
                <Sidebar />
            </aside>

            {/* mobile header */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center justify-between px-4 z-30">
                <Link to="/admin" className="font-heading text-lg tracking-[0.08em]">D'Helenas <span className="text-[9px] uppercase tracking-[0.2em] text-[hsl(var(--gold))]">Admin</span></Link>
                <div className="flex items-center gap-3">
                    <button onClick={toggleTheme} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Alternar tema">
                        {theme === "dark" ? <Sun className="w-5 h-5" strokeWidth={1.5} /> : <Moon className="w-5 h-5" strokeWidth={1.5} />}
                    </button>
                    <button onClick={() => setMobileOpen(true)} aria-label="Menu"><Menu className="w-5 h-5" strokeWidth={1.25} /></button>
                </div>
            </div>

            {/* mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="absolute left-0 top-0 h-full w-60 max-w-[80%] bg-background shadow-xl flex flex-col animate-fade-in">
                        <div className="flex items-center justify-end px-4 h-14 border-b border-border">
                            <button onClick={() => setMobileOpen(false)}><X className="w-5 h-5" strokeWidth={1.25} /></button>
                        </div>
                        <Sidebar />
                    </div>
                </div>
            )}

            {/* content */}
            <main className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-h-screen">
                <div className="hidden lg:flex items-center justify-end h-12 px-8 border-b border-border bg-background">
                    <button onClick={toggleTheme} className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors" aria-label="Alternar tema">
                        {theme === "dark" ? <><Sun className="w-4 h-4" strokeWidth={1.5} /> Claro</> : <><Moon className="w-4 h-4" strokeWidth={1.5} /> Escuro</>}
                    </button>
                </div>
                <div className="p-5 lg:p-8 max-w-6xl mx-auto">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}