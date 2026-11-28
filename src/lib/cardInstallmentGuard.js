// The SDK offers a min/max interval, not an arbitrary list. Keep its native
// selector and field handlers; hide/disable options outside the backend offer.
// This adapter reads only installment options, never Secure Fields or card data.
export function guardNativeInstallments(root, getOffers, onSelected, Observer = MutationObserver) {
    let disposed = false;
    const apply = () => {
        if (disposed) return;
        for (const select of root.querySelectorAll('select')) {
            const options = Array.from(select.options);
            if (!options.some(o => /^\d+\s*x\b/i.test(o.textContent.trim()))) continue;
            const allowed = new Set(getOffers().map(o => String(o.installments)));
            for (const option of options) {
                if (!/^\d+\s*x\b/i.test(option.textContent.trim())) continue;
                const valid = allowed.has(String(option.value));
                if (option.disabled !== !valid) option.disabled = !valid;
                if (option.hidden !== !valid) option.hidden = !valid;
            }
            if (select.disabled !== (allowed.size === 0)) select.disabled = allowed.size === 0;
            // A prior selection can become invalid after BIN or policy changes.
            onSelected(allowed.has(String(select.value)) ? Number(select.value) : null);
        }
    };
    const observer = new Observer(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    root.addEventListener('change', apply);
    apply();
    return { refresh: apply, dispose: () => { disposed = true; observer.disconnect(); root.removeEventListener('change', apply); } };
}
