// A request started by one session must not be sent using a later account.
export function createSessionFence() {
    let identity = null, revision = 0;
    return {
        initialize(next) { if (revision === 0 && identity === null) identity = next; else this.observe(next); },
        observe(next) { if (next !== identity) { identity = next; revision++; } },
        capture() { return revision; },
        assert(value) { if (value !== revision) throw Object.assign(new Error('Sua sessão mudou. Recarregue a página.'), { status: 401 }); },
    };
}
