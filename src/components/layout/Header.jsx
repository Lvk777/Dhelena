import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Search, Heart, User, ShoppingBag, Menu, X, ShieldCheck } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/lib/AuthContext";
import { usePublicSettings } from "@/context/PublicSettingsContext";

const NAV = [
    { label: "Início", to: "/" },
    { label: "Novidades", to: "/loja?filtro=novidades" },
    { label: "Roupas", to: "/loja?cat=vestidos" },
    { label: "Acessórios", to: "/loja?cat=acessorios" },
    { label: "Coleções", to: "/colecoes" },
    { label: "Sobre", to: "/sobre" },
    { label: "Contato", to: "/contato" },
];

export default function Header() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [q, setQ] = useState("");
    const { cartCount, favorites, setCartOpen } = useStore();
    const { isAuthenticated, user } = useAuth();
    const { settings, freeShippingThreshold } = usePublicSettings();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 24);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);

    const submitSearch = (e) => {
        e.preventDefault();
        if (!q.trim()) return;
        navigate(`/loja?q=${encodeURIComponent(q.trim())}`);
        setSearchOpen(false);
        setQ("");
    };

    return (
        <>
            {/* announcement bar */}
            <div className="bg-[hsl(var(--rose))] text-white text-[10px] tracking-[0.3em] uppercase text-center py-2 px-4">
                {(settings.store.top_bar_text || "").replace(/R\$\s*[\d.,]+/g, `R$ ${(freeShippingThreshold || 499).toLocaleString("pt-BR")}`)}
            </div>

            <header className={`sticky top-0 z-50 transition-all duration-500 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-[0_1px_0_0_rgba(0,0,0,0.04)]" : "bg-background"}`}>
                <div className="container-boutique">
                    <div className={`grid grid-cols-3 items-center transition-all duration-500 ${scrolled ? "h-16" : "h-20"}`}>
                        {/* left: mobile menu + mobile search, or desktop nav */}
                        <div className="justify-self-start flex items-center gap-0.5 sm:gap-1">
                            {/* mobile menu */}
                            <button
                                className="lg:hidden p-2 -ml-2 text-foreground"
                                onClick={() => setMobileOpen(true)}
                                aria-label="Abrir menu"
                            >
                                <Menu className="w-5 h-5" strokeWidth={1.25} />
                            </button>

                            {/* mobile search button beside menu */}
                            <button
                                onClick={() => setSearchOpen((s) => !s)}
                                className="lg:hidden p-2 text-foreground/80 hover:text-foreground transition-colors"
                                aria-label="Buscar"
                            >
                                <Search className="w-[18px] h-[18px]" strokeWidth={1.25} />
                            </button>

                            {/* nav desktop */}
                            <nav className="hidden lg:flex items-center gap-7">
                                {NAV.slice(0, 4).map((n) => (
                                    <Link key={n.label} to={n.to} className="link-underline text-[11px] uppercase tracking-[0.2em] text-foreground/75 hover:text-foreground transition-colors">
                                        {n.label}
                                    </Link>
                                ))}
                            </nav>
                        </div>

                        {/* logo */}
                        <Link to="/" className="justify-self-center text-center group">
                            <span className="block font-heading text-2xl sm:text-[28px] leading-none tracking-[0.08em] text-foreground">
                                D'Helenas
                            </span>
                            <span className="hidden sm:block text-[8px] uppercase tracking-[0.4em] text-[hsl(var(--gold))] mt-1">
                                Método Ponte
                            </span>
                        </Link>

                        {/* right nav + icons */}
                        <div className="justify-self-end flex items-center gap-1 sm:gap-2">
                            <nav className="hidden lg:flex items-center gap-7 mr-2">
                                {NAV.slice(4).map((n) => (
                                    <Link key={n.label} to={n.to} className="link-underline text-[11px] uppercase tracking-[0.2em] text-foreground/75 hover:text-foreground transition-colors">
                                        {n.label}
                                    </Link>
                                ))}
                            </nav>
                            {/* search on desktop */}
                            <button onClick={() => setSearchOpen((s) => !s)} className="hidden lg:block p-2 text-foreground/80 hover:text-foreground transition-colors" aria-label="Buscar">
                                <Search className="w-[18px] h-[18px]" strokeWidth={1.25} />
                            </button>
                            <Link to="/favoritos" className="p-2 text-foreground/80 hover:text-foreground transition-colors relative" aria-label="Favoritos">
                                <Heart className="w-[18px] h-[18px]" strokeWidth={1.25} />
                                {favorites.length > 0 && (
                                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[hsl(var(--rose))] text-white text-[9px] flex items-center justify-center">{favorites.length}</span>
                                )}
                            </Link>
                            <Link to={isAuthenticated ? "/minha-conta" : "/login"} className="p-2 text-foreground/80 hover:text-foreground transition-colors hidden sm:block" aria-label="Minha conta">
                                <User className="w-[18px] h-[18px]" strokeWidth={1.25} />
                            </Link>
                            {user?.role === "admin" && (
                                <Link to="/admin" className="p-2 text-[hsl(var(--gold))] hover:text-foreground transition-colors hidden sm:flex items-center gap-1" title="Painel Administrativo" aria-label="Admin">
                                    <ShieldCheck className="w-[18px] h-[18px]" strokeWidth={1.5} />
                                    <span className="text-[10px] uppercase tracking-wider font-semibold hidden md:inline">Admin</span>
                                </Link>
                            )}
                            <button onClick={() => setCartOpen(true)} className="p-2 text-foreground/80 hover:text-foreground transition-colors relative" aria-label="Sacola">
                                <ShoppingBag className="w-[18px] h-[18px]" strokeWidth={1.25} />
                                {cartCount > 0 && (
                                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[hsl(var(--gold))] text-white text-[9px] flex items-center justify-center">{cartCount}</span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* search bar */}
                {searchOpen && (
                    <div className="border-t border-border bg-background animate-fade-in">
                        <form onSubmit={submitSearch} className="container-boutique py-5 flex items-center gap-3">
                            <Search className="w-4 h-4 text-muted-foreground" strokeWidth={1.25} />
                            <input
                                autoFocus
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="O que você procura?"
                                className="flex-1 bg-transparent text-sm font-body tracking-wide placeholder:text-muted-foreground/60 focus:outline-none"
                            />
                            <button type="button" onClick={() => setSearchOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-4 h-4" strokeWidth={1.25} />
                            </button>
                        </form>
                    </div>
                )}
            </header>

            {/* mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-[60] lg:hidden">
                    <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
                    <div className="absolute left-0 top-0 h-full w-[82%] max-w-sm bg-background shadow-xl flex flex-col animate-fade-in">
                        <div className="flex items-center justify-between px-6 h-16 border-b border-border">
                            <span className="font-heading text-xl tracking-[0.08em]">D'Helenas</span>
                            <button onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X className="w-5 h-5" strokeWidth={1.25} /></button>
                        </div>
                        <nav className="flex flex-col px-6 py-4">
                            {NAV.map((n) => (
                                <Link key={n.label} to={n.to} className="py-4 border-b border-border/60 text-sm uppercase tracking-[0.18em] text-foreground/80 hover:text-foreground">
                                    {n.label}
                                </Link>
                            ))}
                            <Link to={isAuthenticated ? "/minha-conta" : "/login"} className="py-4 border-b border-border/60 text-sm uppercase tracking-[0.18em] text-foreground/80 hover:text-foreground flex items-center justify-between">
                                {isAuthenticated ? "Minha Conta" : "Entrar / Cadastrar"}
                            </Link>
                            {user?.role === "admin" && (
                                <Link to="/admin" className="py-4 border-b border-border/60 text-sm uppercase tracking-[0.18em] text-[hsl(var(--gold))] font-medium flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4" />
                                    Painel Admin
                                </Link>
                            )}
                        </nav>
                        <div className="mt-auto px-6 py-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            Moda que conecta histórias
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}