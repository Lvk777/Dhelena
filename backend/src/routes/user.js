import { addressInput } from '../lib/customerAddress.js';
import { Router } from 'express';
import { pool, withTransaction } from '../config/db.js';
import { auth } from '../middleware.js';

const router = Router();
router.use(['/favorites', '/addresses'], auth, (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autenticação necessária' });
    next();
});
const productIdValid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// ─── FAVORITES ─────────────────────────────────────────────────────

router.get('/favorites', auth, async (req, res, next) => {
    try {
        const { product_id } = req.query;
        let query = 'SELECT *, created_at as created_date FROM favorites WHERE user_id = $1';
        const params = [req.user.id];
        if (product_id) { query += ' AND product_id = $2'; params.push(product_id); }
        query += ' ORDER BY created_at DESC';
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/favorites', auth, async (req, res, next) => {
    try {
        const { product_id } = req.body;
        if (!productIdValid(product_id)) return res.status(400).json({error:"Produto inválido"});
        const { rows } = await pool.query(
            `INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)
             ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *`,
            [req.user.id, product_id]
        );
        res.status(201).json(rows[0] || { product_id });
    } catch (err) { next(err); }
});

router.post('/favorites/bulk', auth, async (req, res, next) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length > 100 || items.some(i => !productIdValid(i?.product_id))) return res.status(400).json({error:"Lista de favoritos inválida"});
        const results = [];
        for (const item of items) {
            const { rows } = await pool.query(
                `INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)
                 ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *`,
                [req.user.id, item.product_id]
            );
            if (rows[0]) results.push(rows[0]);
        }
        res.status(201).json(results);
    } catch (err) { next(err); }
});

router.delete('/favorites/:id', auth, async (req, res, next) => {
    try {
        // Try by favorite record ID (UUID) first, then by product_id (backward compat)
        const { rowCount } = await pool.query('DELETE FROM favorites WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (rowCount === 0) {
            await pool.query('DELETE FROM favorites WHERE product_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        }
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

// ─── ADDRESSES ─────────────────────────────────────────────────────

router.get('/addresses', auth, async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT *, zip_code AS cep, is_default AS is_primary, created_at as created_date FROM addresses WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/addresses', auth, async (req, res, next) => {
    try {
        const v=addressInput(req.body);
        const row=await withTransaction(async c=>{
            await c.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE',[req.user.id]);
            if(v.is_default)await c.query('UPDATE addresses SET is_default=false WHERE user_id=$1',[req.user.id]);
            const result=await c.query(`INSERT INTO addresses(user_id,label,recipient,zip_code,street,number,complement,district,city,state,is_default)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,zip_code AS cep,is_default AS is_primary,created_at AS created_date`,
            [req.user.id,v.label||null,v.recipient||null,v.zip_code,v.street,v.number,v.complement||'',v.district,v.city,v.state,v.is_default||false]);
            return result.rows[0];
        });res.status(201).json(row);
    }catch(err){next(err);}
});
router.patch('/addresses/:id', auth, async (req,res,next)=>{
    try {
        const v=addressInput(req.body,true);
        const row=await withTransaction(async c=>{
            await c.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE',[req.user.id]);
            const owned=await c.query('SELECT id FROM addresses WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id]);
            if(!owned.rows.length)return null;
            if(v.is_default)await c.query('UPDATE addresses SET is_default=false WHERE user_id=$1',[req.user.id]);
            const result=await c.query(`UPDATE addresses SET label=COALESCE($1,label),recipient=COALESCE($2,recipient),zip_code=COALESCE($3,zip_code),
                street=COALESCE($4,street),number=COALESCE($5,number),complement=COALESCE($6,complement),district=COALESCE($7,district),
                city=COALESCE($8,city),state=COALESCE($9,state),is_default=COALESCE($10,is_default),updated_at=now()
                WHERE id=$11 AND user_id=$12 RETURNING *,zip_code AS cep,is_default AS is_primary,created_at AS created_date`,
            [v.label,v.recipient,v.zip_code,v.street,v.number,v.complement,v.district,v.city,v.state,v.is_default,req.params.id,req.user.id]);
            return result.rows[0];
        });if(!row)return res.status(404).json({error:'Endereço não encontrado'});res.json(row);
    }catch(err){next(err);}
});

router.delete('/addresses/:id', auth, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ id: req.params.id });
    } catch (err) { next(err); }
});

export default router;
