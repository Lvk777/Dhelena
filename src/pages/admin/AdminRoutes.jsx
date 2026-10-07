import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import AdminLayout from "@/pages/admin/AdminLayout";

const Dashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminOrders = lazy(() => import("@/pages/admin/AdminOrders"));
const AdminOrderDetail = lazy(() => import("@/pages/admin/AdminOrderDetail"));
const AdminProducts = lazy(() => import("@/pages/admin/Products"));
const ProductForm = lazy(() => import("@/pages/admin/ProductForm"));
const Categories = lazy(() => import("@/pages/admin/Categories"));
const AdminCollections = lazy(() => import("@/pages/admin/Collections"));
const Inventory = lazy(() => import("@/pages/admin/Inventory"));
const Customers = lazy(() => import("@/pages/admin/Customers"));
const Coupons = lazy(() => import("@/pages/admin/Coupons"));
const Banners = lazy(() => import("@/pages/admin/Banners"));
const Reports = lazy(() => import("@/pages/admin/Reports"));
const Settings = lazy(() => import("@/pages/admin/Settings"));
const AuditLog = lazy(() => import("@/pages/admin/AuditLog"));
const SizeGuides = lazy(() => import("@/pages/admin/SizeGuides"));
const Integrations = lazy(() => import("@/pages/admin/Integrations"));
const Promotions = lazy(() => import("@/pages/admin/Promotions"));
const Analytics = lazy(() => import("@/pages/admin/Analytics"));

function AdminPageLoader() {
    return (
        <div className="space-y-5" aria-label="Carregando página administrativa" role="status">
            <div className="h-8 w-48 rounded bg-muted animate-pulse" />
            <div className="h-64 rounded-xl border border-border bg-background animate-pulse" />
        </div>
    );
}

function page(Component) {
    return <Suspense fallback={<AdminPageLoader />}><Component /></Suspense>;
}

export default function AdminRoutes() {
    return (
        <Routes>
            <Route element={<AdminLayout />}>
                <Route index element={page(Dashboard)} />
                <Route path="pedidos" element={page(AdminOrders)} />
                <Route path="pedidos/:id" element={page(AdminOrderDetail)} />
                <Route path="produtos" element={page(AdminProducts)} />
                <Route path="produtos/novo" element={page(ProductForm)} />
                <Route path="produtos/:id" element={page(ProductForm)} />
                <Route path="categorias" element={page(Categories)} />
                <Route path="colecoes" element={page(AdminCollections)} />
                <Route path="estoque" element={page(Inventory)} />
                <Route path="clientes" element={page(Customers)} />
                <Route path="cupons" element={page(Coupons)} />
                <Route path="banners" element={page(Banners)} />
                <Route path="relatorios" element={page(Reports)} />
                <Route path="auditoria" element={page(AuditLog)} />
                <Route path="configuracoes" element={page(Settings)} />
                <Route path="guias-medidas" element={page(SizeGuides)} />
                <Route path="integracoes" element={page(Integrations)} />
                <Route path="promocoes" element={page(Promotions)} />
                <Route path="analytics" element={page(Analytics)} />
            </Route>
        </Routes>
    );
}
