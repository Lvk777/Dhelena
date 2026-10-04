import React, { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { StoreProvider } from '@/context/StoreContext';
import { CatalogProvider } from '@/context/CatalogContext';
import { PublicSettingsProvider } from '@/context/PublicSettingsContext';
import Layout from '@/components/layout/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import AdminRoute from '@/components/AdminRoute';
import MaintenanceGuard from '@/components/MaintenanceGuard';
import ComingSoon from '@/pages/ComingSoon';

// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// Store pages
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import ProductDetail from '@/pages/ProductDetail';
import Cart from '@/pages/Cart';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import Collections from '@/pages/Collections';
import Favorites from '@/pages/Favorites';
import MonteSeuLook from '@/pages/MonteSeuLook';
import PolicyPage from '@/pages/PolicyPage';

// Account pages
import AccountLayout from '@/pages/account/AccountLayout';
import Overview from '@/pages/account/Overview';
import Orders from '@/pages/account/Orders';
import OrderDetail from '@/pages/account/OrderDetail';
import Tracking from '@/pages/account/Tracking';
import AccountFavorites from '@/pages/account/Favorites';
import Addresses from '@/pages/account/Addresses';
import Profile from '@/pages/account/Profile';
import ChangePassword from '@/pages/account/ChangePassword';

const Checkout = lazy(() => import('@/pages/Checkout'));
const AdminRoutes = lazy(() => import('@/pages/admin/AdminRoutes'));

function RouteLoader() {
    return <div className="fixed inset-0 flex items-center justify-center bg-background"><div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin" /></div>;
}

const AuthenticatedApp = () => {
    const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

    if (isLoadingPublicSettings || isLoadingAuth) {
        return (
            <div className="fixed inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-[hsl(var(--bone))] border-t-[hsl(var(--gold))] rounded-full animate-spin"></div>
            </div>
        );
    }

    if (authError) {
        if (authError.type === 'user_not_registered') {
            return <UserNotRegisteredError />;
        } else if (authError.type === 'auth_required') {
            navigateToLogin();
            return null;
        }
    }

    return (
        <StoreProvider>
            <PublicSettingsProvider>
                <MaintenanceGuard>
                    <CatalogProvider>
                        <Routes>
                            {/* Auth */}
                            <Route path="/login" element={<Login />} />
                            <Route path="/cadastro" element={<Register />} />
                            <Route path="/esqueci-minha-senha" element={<ForgotPassword />} />
                            <Route path="/reset-password" element={<ResetPassword />} />

                            {/* Maintenance page */}
                            <Route path="/em-breve" element={<ComingSoon />} />

                            {/* Public store */}
                            <Route element={<Layout />}>
                                <Route path="/" element={<Home />} />
                                <Route path="/loja" element={<Shop />} />
                                <Route path="/novidades" element={<Navigate to="/loja?filtro=novidades" replace />} />
                                <Route path="/produto/:id" element={<ProductDetail />} />
                                <Route path="/sacola" element={<Cart />} />
                                <Route path="/sobre" element={<About />} />
                                <Route path="/contato" element={<Contact />} />
                                <Route path="/colecoes" element={<Collections />} />
                                <Route path="/favoritos" element={<Favorites />} />
                                <Route path="/monte-seu-look" element={<MonteSeuLook />} />
                                <Route path="/trocas-e-devolucoes" element={<PolicyPage slug="trocas-e-devolucoes" />} />
                                <Route path="/politica-de-privacidade" element={<PolicyPage slug="politica-de-privacidade" />} />
                                <Route path="/termos-de-uso" element={<PolicyPage slug="termos-de-uso" />} />
                                <Route path="/politica-de-entrega" element={<PolicyPage slug="politica-de-entrega" />} />
                                <Route path="/checkout" element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login?returnTo=/checkout" replace />} />}>
                                    <Route index element={<Suspense fallback={<RouteLoader />}><Checkout /></Suspense>} />
                                </Route>
                            </Route>

                            {/* Customer account (protected) */}
                            <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
                                <Route path="/minha-conta" element={<AccountLayout />}>
                                    <Route index element={<Overview />} />
                                    <Route path="pedidos" element={<Orders />} />
                                    <Route path="pedidos/:id" element={<OrderDetail />} />
                                    <Route path="rastreamento" element={<Tracking />} />
                                    <Route path="favoritos" element={<AccountFavorites />} />
                                    <Route path="enderecos" element={<Addresses />} />
                                    <Route path="dados" element={<Profile />} />
                                    <Route path="senha" element={<ChangePassword />} />
                                </Route>
                            </Route>

                            {/* Admin (admin-only) */}
                            <Route path="/admin/*" element={<AdminRoute><Suspense fallback={<RouteLoader />}><AdminRoutes /></Suspense></AdminRoute>} />

                            <Route path="*" element={<PageNotFound />} />
                        </Routes>
                    </CatalogProvider>
                </MaintenanceGuard>
            </PublicSettingsProvider>
        </StoreProvider>
    );
};

function App() {
    return (
        <AuthProvider>
            <QueryClientProvider client={queryClientInstance}>
                <Router>
                    <ScrollToTop />
                    <AuthenticatedApp />
                </Router>
                <Toaster />
            </QueryClientProvider>
        </AuthProvider>
    )
}

export default App
