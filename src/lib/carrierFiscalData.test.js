import { expect, test } from 'vitest';
import { carrierFiscalData } from './carrierFiscalData';

test.each([
    ['Correios', '34.028.316/0001-03'],
    ['Jadlog', '04.884.082/0001-35'],
    ['Loggi', '24.217.653/0001-95'],
    ['J&T Express', '42.584.754/0001-86'],
    ['Total Express', '73.939.449/0001-93'],
    ['Buslog', '10.992.167/0001-30'],
    ['Azul Cargo Express', '09.296.295/0001-60'],
    ['LATAM Cargo', '02.012.862/0001-60'],
])('maps %s to the provider-published fiscal record', (name, cnpj) => {
    expect(carrierFiscalData(name)?.cnpj).toBe(cnpj);
});

test('does not guess identifiers for unknown or absent carriers', () => {
    expect(carrierFiscalData('Nova Transportadora')).toBeNull();
    expect(carrierFiscalData(null)).toBeNull();
});
