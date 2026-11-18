export async function assertHistoricalProductCanPublish(client, product, nextStatus) {
    if (nextStatus !== 'published' || product.status === 'published') return;

    const { rows } = await client.query(`
        SELECT EXISTS (
            SELECT 1 FROM order_items WHERE product_id = $1
            UNION ALL SELECT 1 FROM stock_reservations WHERE product_id = $1
            UNION ALL SELECT 1 FROM stock_movements WHERE product_id = $1
        ) AS has_history`, [product.id]);
    if (Number(product.sold_count) > 0 || rows[0]?.has_history) {
        throw Object.assign(new Error('Produto histórico vinculado a vendas ou estoque não pode ser publicado novamente. Cadastre uma nova peça.'), { status: 409 });
    }
}
