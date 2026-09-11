import { Route, Routes } from "react-router-dom";
import AdminLayout from "@/pages/admin/AdminLayout";
import Dashboard from "@/pages/admin/Dashboard";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminOrderDetail from "@/pages/admin/AdminOrderDetail";
import AdminProducts from "@/pages/admin/Products";
import ProductForm from "@/pages/admin/ProductForm";
import Categories from "@/pages/admin/Categories";
import AdminCollections from "@/pages/admin/Collections";
import Inventory from "@/pages/admin/Inventory";
import Customers from "@/pages/admin/Customers";
import Coupons from "@/pages/admin/Coupons";
import Banners from "@/pages/admin/Banners";
import Reports from "@/pages/admin/Reports";
import Settings from "@/pages/admin/Settings";
import AuditLog from "@/pages/admin/AuditLog";
import SizeGuides from "@/pages/admin/SizeGuides";
import Integrations from "@/pages/admin/Integrations";
import Promotions from "@/pages/admin/Promotions";
import Analytics from "@/pages/admin/Analytics";

export default function AdminRoutes() {
    return (
        <Routes>
            <Route element={<AdminLayout />}>
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
        </Routes>
    );
}
