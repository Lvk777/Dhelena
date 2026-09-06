import { useState, useCallback, useRef, useEffect } from "react";
import { validateCEP } from "@/lib/forms";

export function useCepLookup() {
    const [cepStatus, setCepStatus] = useState("idle"); // idle | searching | found | not_found | error
    const timerRef = useRef(null);

    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    const lookup = useCallback((cep, onResult) => {
        const clean = (cep || "").replace(/\D/g, "");
        if (!validateCEP(clean)) {
            setCepStatus("idle");
            return;
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        setCepStatus("searching");
        timerRef.current = setTimeout(async () => {
            try {
                const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`).then((r) => r.json());
                if (res.erro) {
                    setCepStatus("not_found");
                    onResult(null);
                } else {
                    setCepStatus("found");
                    onResult({
                        street: res.logradouro || "",
                        district: res.bairro || "",
                        city: res.localidade || "",
                        state: res.uf || "",
                    });
                }
            } catch (e) {
                setCepStatus("error");
                onResult(null);
            }
        }, 600);
    }, []);

    return { cepStatus, lookup };
}