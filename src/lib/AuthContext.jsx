import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { client } from '@/api/apiClient';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const generation = useRef(0);
    const [appPublicSettings] = useState({ id: 'local', public_settings: { store_name: "D'Helenas" } });
    const [isLoadingPublicSettings] = useState(false);

    useEffect(() => {
        checkUserAuth(true);
        const unsubscribe = client.auth.onSessionChange?.(event => {
            if (event === 'SIGNED_OUT') { generation.current++; setUser(null); setIsAuthenticated(false); setAuthError(null); setIsLoadingAuth(false); setAuthChecked(true); }
            else checkUserAuth();
        });
        const focus = () => checkUserAuth();
        window.addEventListener('focus', focus);
        const timer = setInterval(focus, 60000);
        return () => { generation.current++; unsubscribe?.(); window.removeEventListener('focus', focus); clearInterval(timer); };
    }, []);

    const checkUserAuth = async (initial = false) => {
        const current = ++generation.current;
        if (initial) setIsLoadingAuth(true);
        try {
            const currentUser = await client.auth.me();
            if (current !== generation.current) return;
            setUser(currentUser);
            setIsAuthenticated(true);
            setAuthError(null);
        } catch (error) {
            if (current !== generation.current) return;
            if (error.status === 401 || error.status === 403 || initial) { setUser(null); setIsAuthenticated(false); }
            if (error.status === 401) setAuthError(null);
            if (error.status !== 401) setAuthError({ type: 'unavailable', message: 'Não foi possível verificar sua conta. Tente novamente.' });
        } finally {
            if (current === generation.current) { setIsLoadingAuth(false); setAuthChecked(true); }
        }
    };

    const checkAppState = async () => {
        await checkUserAuth();
    };

    const logout = async (shouldRedirect = true) => {
        generation.current++;
        try { await client.auth.logout(); }
        finally { setUser(null); setIsAuthenticated(false); setAuthError(null); if (shouldRedirect) window.location.assign('/login'); }
    };

    const navigateToLogin = () => {
        client.auth.redirectToLogin(window.location.href);
    };

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated,
            isLoadingAuth,
            isLoadingPublicSettings,
            authError,
            appPublicSettings,
            authChecked,
            logout,
            navigateToLogin,
            checkUserAuth,
            checkAppState,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
