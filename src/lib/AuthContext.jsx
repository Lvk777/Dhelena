import React, { createContext, useState, useContext, useEffect } from 'react';
import { client } from '@/api/apiClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [appPublicSettings] = useState({ id: 'local', public_settings: { store_name: "D'Helenas" } });
    const [isLoadingPublicSettings] = useState(false);

    useEffect(() => {
        checkUserAuth();
    }, []);

    const checkUserAuth = async () => {
        setIsLoadingAuth(true);
        try {
            const currentUser = await client.auth.me();
            setUser(currentUser);
            setIsAuthenticated(true);
        } catch {
            setUser(null);
            setIsAuthenticated(false);
        } finally {
            setIsLoadingAuth(false);
            setAuthChecked(true);
        }
    };

    const checkAppState = async () => {
        await checkUserAuth();
    };

    const logout = (shouldRedirect = true) => {
        setUser(null);
        setIsAuthenticated(false);
        client.auth.logout(shouldRedirect ? window.location.href : undefined);
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
