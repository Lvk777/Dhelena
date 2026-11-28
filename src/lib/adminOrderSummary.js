export function adminOrderSummary(order) {
    const customer = order.snapshot?.customer || {};
    const items = Array.isArray(order.items) ? order.items : order.snapshot?.items;
    return {
        ...order,
        customer_name: order.customer_name || customer.name || '',
        customer_email: order.customer_email || customer.email || '',
        customer_phone: order.customer_phone || customer.phone || '',
        customer_cpf: order.customer_cpf || customer.cpf || '',
        item_count: Array.isArray(items) ? items.length : 0,
    };
}
