import { spawn } from 'node:child_process';

// SQLite is local to this service's persistent disk. Keep retry work here too.
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', process.env.PORT || '10000'], { stdio: 'inherit' });
let worker, stopping = false;
const retry = () => {
  if (stopping || worker || process.env.APP_MODE === 'demo' || !process.env.PAYPAL_MERCHANT_USER_ID) return;
  worker = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/retry-webhooks.ts', '--limit', '100'], { stdio: 'inherit' });
  const timeout = setTimeout(() => worker?.kill('SIGTERM'), 55000);
  worker.on('error', error => console.error('Webhook retry process failed:', error.message));
  worker.on('exit', code => {
    clearTimeout(timeout); worker = undefined;
    if (code !== 0 && !stopping) console.error('Webhook retry requires attention; inspect failed/dead-letter receipts.');
  });
};
const timer = setInterval(retry, 60000);
retry();
function stop(signal) {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  worker?.kill(signal); web.kill(signal);
  setTimeout(() => { worker?.kill('SIGKILL'); web.kill('SIGKILL'); }, 10000).unref();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
web.on('error', error => { console.error(error.message); stop('SIGTERM'); process.exitCode = 1; });
web.on('exit', code => { const expected = stopping; stop('SIGTERM'); process.exitCode = expected ? 0 : (code || 1); });
