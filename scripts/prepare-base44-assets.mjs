/**
 * Creates a reviewable Base44 -> Supabase Storage migration manifest.
 *
 * Default: dry-run only; prints source and proposed destination paths.
 * --apply: uploads copies only after explicit approval. It never rewrites a
 * database/frontend reference and never removes a source or destination file.
 *
 * Usage:
 *   node scripts/prepare-base44-assets.mjs
 *   BASE44_ASSET_MIGRATION_APPROVED=YES SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... STORE_ASSETS_BUCKET=store-assets \
 *   node scripts/prepare-base44-assets.mjs --apply
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const apply = process.argv.includes('--apply');
const sourceData = JSON.parse(fs.readFileSync(new URL('../src/data/initialData.json', import.meta.url), 'utf8'));
const staticAssets = [
    ['institutional', 'HERO_IMAGE', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/ca5732fc0_generated_db5c1f89.jpg'],
    ['institutional', 'ABOUT_IMAGE', 'https://media.base44.com/images/public/6a9cb96c35367ad0608d2e70/d87250d50_ChatGPTImage9desetde202614_39_54.png'],
    ['institutional', 'LOOK_IMAGE', 'https://media.base44.com/images/public/6a9b39c904f395072f289bf5/b30f6cddb_generated_048b13fa.jpg'],
];

const kindToFolder = { Product: 'products', Category: 'categories', Collection: 'collections', Banner: 'banners' };
const entries = [];
for (const [kind, records] of Object.entries(sourceData)) {
    if (!Array.isArray(records) || !kindToFolder[kind]) continue;
    for (const record of records) {
        const visit = (value, field) => {
            if (typeof value === 'string' && value.startsWith('https://media.base44.com/')) {
                entries.push({ folder: kindToFolder[kind], source: value, record: `${kind}:${record.id}`, field });
            } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${field}[${index}]`));
            else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, `${field}.${key}`));
        };
        visit(record, kind);
    }
}
for (const [folder, record, source] of staticAssets) entries.push({ folder, source, record: `src/data/products.js:${record}`, field: record });

const unique = [...new Map(entries.map(entry => [entry.source, { ...entry, references: entries.filter(item => item.source === entry.source).map(item => `${item.record}:${item.field}`) }])).values()];
const migrationId = new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '');
const destinationFor = (entry, digest) => {
    const extension = new URL(entry.source).pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.bin';
    return `base44-migration/${migrationId}/${entry.folder}/${digest}${extension}`;
};

if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', assets: unique.map(asset => ({ source: asset.source, references: asset.references, proposed_folder: asset.folder })) }, null, 2));
    process.exit(0);
}

if (process.env.BASE44_ASSET_MIGRATION_APPROVED !== 'YES') {
    throw new Error('Refusing upload: set BASE44_ASSET_MIGRATION_APPROVED=YES only after reviewing the dry-run manifest.');
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required only for --apply.');
}

const { createClient } = await import('@supabase/supabase-js');
const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const bucket = process.env.STORE_ASSETS_BUCKET || 'store-assets';
const completed = [];
for (const asset of unique) {
    const response = await fetch(asset.source);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${asset.source}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    if (!contentType.startsWith('image/') || bytes.length === 0) throw new Error(`Unexpected asset response: ${asset.source}`);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const destination = destinationFor(asset, digest);
    const { error } = await storage.storage.from(bucket).upload(destination, bytes, { contentType, upsert: false });
    if (error) throw new Error(`Upload failed for ${asset.source}: ${error.message}`);
    completed.push({ source: asset.source, destination, contentType, bytes: bytes.length, sha256: digest, references: asset.references });
}
console.log(JSON.stringify({ mode: 'applied-copy-only', migrationId, bucket, completed }, null, 2));
