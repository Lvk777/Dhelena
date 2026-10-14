import test from 'node:test';
import assert from 'node:assert/strict';
import {addressInput} from '../src/lib/customerAddress.js';
import {normalizeProfileInput} from '../src/lib/validation.js';
const address={cep:'01001-000',street:'Praça',number:'1',district:'Sé',city:'São Paulo',state:'SP',is_primary:true};
test('address aliases match the frontend without accepting owner-controlled fields',()=>{
    const value=addressInput(address);assert.equal(value.zip_code,'01001000');assert.equal(value.is_default,true);
    assert.throws(()=>addressInput({...address,user_id:'another'}));assert.throws(()=>addressInput({...address,zip_code:'02002000'}));
    assert.throws(()=>addressInput({...address,is_default:false}));
});
test('address rejects invalid postal codes, states, types and blank required fields',()=>{
    for(const mutation of [{cep:'123'},{state:'XX'},{city:''},{street:3},{is_primary:'true'},{number:'a\nheader'}])assert.throws(()=>addressInput({...address,...mutation}));
    assert.deepEqual(addressInput({is_primary:true},true),{is_default:true});assert.throws(()=>addressInput({city:''},true));
});
test('profile validates CPF checksum, phone, name and refuses role escalation',()=>{
    assert.deepEqual(normalizeProfileInput({full_name:' Cliente ',phone:'(11) 93803-3499',cpf:'123.456.789-09'}),
        {full_name:'Cliente',phone:'11938033499',cpf:'12345678909',birth_date:null});
    for(const data of [{role:'admin'},{cpf:'11111111111'},{cpf:'12345678908'},{phone:'123'},{full_name:8},{full_name:'a\n'}])assert.throws(()=>normalizeProfileInput(data));
});
