import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
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
        allowedHosts: ['angella-soullike-virgie.ngrok-free.dev', '.ngrok-free.dev', '.ngrok.app', 'localhost'],
    },
});
