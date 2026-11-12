const invalid = message => Object.assign(new Error(message), { status:400 });
const states = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const fields = ['label','recipient','zip_code','street','number','complement','district','city','state','is_default'];
export function addressInput(body,partial=false) {
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>![...fields,'cep','is_primary'].includes(k)))throw invalid('Campos de endereço inválidos.');
    const result={...body};
    for(const [alias,key] of [['cep','zip_code'],['is_primary','is_default']]) {
        if(body[alias]!==undefined){if(body[key]!==undefined&&String(body[key])!==String(body[alias]))throw invalid('Dados de endereço contraditórios.');result[key]=body[alias];}
        delete result[alias];
    }
    for(const key of fields.filter(k=>k!=='is_default')) {
        if(result[key]!==undefined){if(typeof result[key]!=='string'||result[key].length>250||/[\u0000-\u001f]/.test(result[key]))throw invalid('Texto do endereço inválido.');result[key]=result[key].trim();}
    }
    if(result.zip_code!==undefined){result.zip_code=result.zip_code.replace(/\D/g,'');if(!/^\d{8}$/.test(result.zip_code))throw invalid('CEP inválido.');}
    if(result.state!==undefined&&!states.has(result.state))throw invalid('Estado inválido.');
    if(result.is_default!==undefined&&typeof result.is_default!=='boolean')throw invalid('Seleção de endereço principal inválida.');
    for(const k of ['zip_code','street','number','district','city','state']) if((!partial||result[k]!==undefined)&&!result[k])throw invalid('Complete os dados de entrega.');
    return result;
}
