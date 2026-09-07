import { spawnSync } from 'node:child_process';

const preload = process.platform === 'win32'
  ? ['--import', new URL('./vinext-windows-exit.mjs', import.meta.url).href]
  : [];
const result = spawnSync(process.execPath, [...preload, 'node_modules/vinext/dist/cli.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, BUILD_TARGET: 'docker' },
});
process.exit(result.status ?? 1);
