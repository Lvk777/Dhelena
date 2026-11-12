// Converts the reviewed Markdown sources to the plain text accepted by PolicyPage.
// This tool only writes a local review artifact; it never calls the production API.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sources = {
    return_policy: 'trocas-e-devolucoes.md',
    privacy_policy: 'privacidade.md',
    terms_of_use: 'termos-de-uso.md',
    shipping_policy: 'entrega-e-frete.md',
};
const forbidden = /julianeassousa@|93803-3499|\[(?:DEFINIR|CONFIRMAR)\]|MINUTA PARA APROVAÇÃO|Pendente de comprovação/i;

export function policyPlainText(markdown) {
    return markdown.replace(/\r\n/g, '\n').split('\n').map(line => line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^-\s+/, '• ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function preparedPolicies(base = resolve('docs/policies')) {
    const values = {};
    for (const [key, file] of Object.entries(sources)) {
        const text = policyPlainText(await readFile(resolve(base, file), 'utf8'));
        if (!text || forbidden.test(text)) throw new Error(`Policy ${key} contains unpublished content`);
        values[key] = text;
    }
    return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const output = process.argv[2];
    if (!output) throw new Error('Specify an absolute review artifact path');
    await writeFile(output, JSON.stringify(await preparedPolicies(), null, 2) + '\n', { flag: 'wx' });
    console.log('Prepared four policies for review; no production write.');
}
