export function noStore(req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
}
