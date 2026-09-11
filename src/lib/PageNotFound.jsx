import { Link } from 'react-router-dom';
import { Home, Store } from 'lucide-react';

export default function PageNotFound() {
    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[hsl(var(--bone))]">
            <div className="max-w-md w-full text-center">
                {/* 404 */}
                <div className="space-y-2">
                    <h1 className="font-heading text-7xl text-[hsl(var(--gold))]/40 tracking-[0.05em]">404</h1>
                    <div className="h-px w-16 bg-[hsl(var(--gold))]/30 mx-auto" />
                </div>

                {/* Message */}
                <div className="mt-8 space-y-3">
                    <h2 className="font-heading text-2xl text-foreground tracking-wide">
                        Página não encontrada
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        A página que você procura pode ter sido movida ou não existe mais.
                    </p>
                </div>

                {/* Actions */}
                <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        to="/"
                        className="inline-flex items-center justify-center gap-2 bg-[hsl(var(--rose))] text-white text-[11px] uppercase tracking-[0.22em] font-medium px-8 py-4 transition-all duration-500 hover:bg-[hsl(var(--rose))]/85"
                    >
                        <Home className="w-4 h-4" strokeWidth={1.5} />
                        Ir para a Home
                    </Link>
                    <Link
                        to="/loja"
                        className="inline-flex items-center justify-center gap-2 border border-[hsl(var(--gold))] text-foreground text-[11px] uppercase tracking-[0.22em] font-medium px-8 py-4 transition-all duration-500 hover:bg-[hsl(var(--gold))] hover:text-white"
                    >
                        <Store className="w-4 h-4" strokeWidth={1.5} />
                        Voltar para a loja
                    </Link>
                </div>
            </div>
        </div>
    );
}
