import React from 'react';
import { Package } from 'lucide-react';
import AdminFormSection from '@/components/admin/AdminFormSection';
import AdminInput from '@/components/admin/AdminInput';

export default function SenderTab({ data, onChange }) {
    const set = (key, value) => onChange({ ...data, [key]: value });
    return <AdminFormSection title="Remetente Melhor Envio" icon={Package}>
        <AdminInput label="Nome do remetente" value={data.name} onChange={value => set('name', value)} />
        <AdminInput label="CPF ou CNPJ do remetente" value={data.document} onChange={value => set('document', value)} />
        <AdminInput label="E-mail do remetente" type="email" value={data.email} onChange={value => set('email', value)} />
        <AdminInput label="Telefone do remetente" value={data.phone} onChange={value => set('phone', value)} />
        <AdminInput label="Inscrição estadual" value={data.state_register} onChange={value => set('state_register', value)} />
    </AdminFormSection>;
}
