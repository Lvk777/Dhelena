import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { loadEnv } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    if (mode === 'production' && !env.VITE_API_URL) {
        throw new Error('VITE_API_URL é obrigatória para builds de produção. Use a URL HTTPS da API Railway, por exemplo https://api.dhelenas.com.');
    }

    return {
    plugins: [
        react(),
    ],
    resolve: {
        alias: {
            "@/hooks": path.resolve(__dirname, "./src/lib/hooks"),
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5551,
        host: true,
        allowedHosts: true,
        proxy: {
            '/api': {
                target: 'http://backend:3001',
                changeOrigin: true,
            },
        },
    },
    };
});
