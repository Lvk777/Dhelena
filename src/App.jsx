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
import Checkout from '@/pages/Checkout';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import Collections from '@/pages/Collections';
import Favorites from '@/pages/Favorites';
import MonteSeuLook from '@/pages/MonteSeuLook';

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

// Admin pages
import AdminLayout from '@/pages/admin/AdminLayout';
import Dashboard from '@/pages/admin/Dashboard';
import AdminOrders from '@/pages/admin/AdminOrders';
import AdminOrderDetail from '@/pages/admin/AdminOrderDetail';
import AdminProducts from '@/pages/admin/Products';
import ProductForm from '@/pages/admin/ProductForm';
import Categories from '@/pages/admin/Categories';
import AdminCollections from '@/pages/admin/Collections';
import Inventory from '@/pages/admin/Inventory';
import Customers from '@/pages/admin/Customers';
import Coupons from '@/pages/admin/Coupons';
import Banners from '@/pages/admin/Banners';
import Reports from '@/pages/admin/Reports';
import Settings from '@/pages/admin/Settings';
import AuditLog from '@/pages/admin/AuditLog';
import SizeGuides from '@/pages/admin/SizeGuides';
import Integrations from '@/pages/admin/Integrations';
import Promotions from '@/pages/admin/Promotions';
import Analytics from '@/pages/admin/Analytics';

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
                <CatalogProvider>
                    <Routes>
                        {/* Auth */}
                        <Route path="/login" element={<Login />} />
                        <Route path="/cadastro" element={<Register />} />
                        <Route path="/esqueci-minha-senha" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />

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
                            <Route path="/checkout" element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login?returnTo=/checkout" replace />} />}>
                                <Route index element={<Checkout />} />
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
                        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
                            <Route index element={<Dashboard />} />
                            <Route path="pedidos" element={<AdminOrders />} />
                            <Route path="pedidos/:id" element={<AdminOrderDetail />} />
                            <Route path="produtos" element={<AdminProducts />} />
                            <Route path="produtos/novo" element={<ProductForm />} />
                            <Route path="produtos/:id" element={<ProductForm />} />
                            <Route path="categorias" element={<Categories />} />
                            <Route path="colecoes" element={<AdminCollections />} />
                            <Route path="estoque" element={<Inventory />} />
                            <Route path="clientes" element={<Customers />} />
                            <Route path="cupons" element={<Coupons />} />
                            <Route path="banners" element={<Banners />} />
                            <Route path="relatorios" element={<Reports />} />
                            <Route path="auditoria" element={<AuditLog />} />
                            <Route path="configuracoes" element={<Settings />} />
                            <Route path="guias-medidas" element={<SizeGuides />} />
                            <Route path="integracoes" element={<Integrations />} />
                            <Route path="promocoes" element={<Promotions />} />
                            <Route path="analytics" element={<Analytics />} />
                        </Route>

                        <Route path="*" element={<PageNotFound />} />
                    </Routes>
                </CatalogProvider>
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