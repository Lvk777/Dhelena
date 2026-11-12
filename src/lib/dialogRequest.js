export function createDialogRequests(show) {
    let pending;
    return {
        request(options) {
            if (pending) return Promise.resolve(options.mode === 'prompt' ? null : false);
            return new Promise(resolve => { pending = { resolve, options }; show(options); });
        },
        settle(accepted, value = '') {
            if (!pending) return;
            const current = pending; pending = null; show(null);
            current.resolve(current.options.mode === 'prompt' ? accepted ? value.trim() : null : accepted);
        },
        cancel() { this.settle(false); },
    };
}
