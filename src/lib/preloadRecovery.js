export function installPreloadRecovery(target, storage, buildId, reload) {
    target.addEventListener('vite:preloadError', (event) => {
        // A deployed build can remove chunks still referenced by an open tab.
        // Persist the guard before reloading so a real outage cannot loop.
        try {
            const key = 'dh_preload_recovered_build';
            const session = typeof storage === 'function' ? storage() : storage;
            if (session.getItem(key) === buildId) return;
            session.setItem(key, buildId);
        } catch {
            return;
        }
        event.preventDefault();
        reload();
    });
}
