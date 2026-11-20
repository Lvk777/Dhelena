import { spawn } from 'node:child_process';
const env = { ...process.env, VITE_API_URL: 'http://127.0.0.1:5954', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', NODE_ENV: 'development' };
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5953', '--strictPort'], { cwd: new URL('../../', import.meta.url), env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => process.exit(code || 0));
