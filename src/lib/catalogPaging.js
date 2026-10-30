// Product listings retain the existing array API while loading its pages.
// A full final page is an error: silently omitting products would mislead
// shoppers and administrators about availability.
export async function loadProductPages(fetchPage, pageSize, maxPages = 100) {
    const products = [];
    for (let page = 1; page <= maxPages; page += 1) {
        const rows = await fetchPage(pageSize, page);
        if (!Array.isArray(rows)) throw new Error('Resposta de catálogo inválida');
        products.push(...rows);
        if (rows.length < pageSize) return products;
    }
    throw new Error('Catálogo excede o limite de páginas; revise a paginação');
}
