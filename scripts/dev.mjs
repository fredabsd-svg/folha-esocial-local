// Modo de desenvolvimento: serviço local (tsx watch, porta 5178) + interface Vite (porta 5173).
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, FOLHA_DEV: '1', FOLHA_SEM_NAVEGADOR: '1' };
const procs = [
  spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'inherit', env, shell: process.platform === 'win32' }),
  spawn(npm, ['run', 'dev', '-w', 'web'], { stdio: 'inherit', env, shell: process.platform === 'win32' }),
];
console.log('\nInterface em desenvolvimento: http://127.0.0.1:5173 (API em http://127.0.0.1:5178)\n');
const parar = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
