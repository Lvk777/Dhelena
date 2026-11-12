const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
}) : 'Valor indisponível';

export function orderReceiptText(order) {
    if (!order?.id || !order?.order_number) throw new Error('Pedido indisponível');
    const snapshot = order.snapshot || {};
    const items = Array.isArray(snapshot.items) ? snapshot.items : Array.isArray(order.items) ? order.items : [];
    const address = order.shipping_address || snapshot.shipping_address || {};
    const created = order.created_at || order.created_date || snapshot.created_at;
    const date = created && !Number.isNaN(new Date(created).getTime())
        ? new Date(created).toLocaleString('pt-BR') : 'Data indisponível';
    const lines = [
        "D'HELENAS — COMPROVANTE DO PEDIDO",
        `Pedido: ${order.order_number}`,
        `Criado em: ${date}`,
        '',
        'Produtos:',
        ...items.map(item => `${item.quantity ?? item.qty} × ${item.product_name} — ${item.color_name || ''} / ${item.size || ''} — ${money(item.subtotal)}`),
        '',
        `Subtotal: ${money(order.subtotal ?? snapshot.subtotal)}`,
        `Desconto: ${money(order.discount ?? snapshot.discount ?? 0)}`,
        `Frete: ${money(order.shipping_cost ?? snapshot.shipping_cost ?? 0)}`,
        `Total: ${money(order.total ?? snapshot.total)}`,
        `Pagamento escolhido: ${order.payment_method || snapshot.payment_method || 'Não informado'}`,
        `Entrega escolhida: ${order.shipping_method || snapshot.shipping_method || 'Não informada'}`,
        `Transportadora/serviço: ${order.shipping_carrier || snapshot.shipping_carrier || 'Não informado'} / ${order.shipping_service_name || snapshot.shipping_service_name || 'Não informado'}`,
        `Prazo estimado: ${snapshot.delivery_estimate?.total_business_days ?? 'Não informado'} dia(s) útil(eis), conforme a cotação`,
        '',
        'Endereço informado para entrega:',
        `${address.street || ''}, ${address.number || ''} ${address.complement || ''}`.trim(),
        `${address.district || ''} — ${address.city || ''}/${address.state || ''}`,
        `CEP: ${address.cep || address.zip_code || ''}`,
        '',
        'Este comprovante registra os dados do pedido. Consulte o estado atual na sua conta.',
    ];
    return lines.join('\n');
}

export function downloadOrderReceipt(order) {
    const blob = new Blob([orderReceiptText(order)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dhelenas-pedido-${String(order.order_number).replace(/[^a-zA-Z0-9-]/g, '')}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
