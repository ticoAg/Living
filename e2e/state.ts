// Rebuild the smoke tests' local D1, R2 and KV: delete the directory, apply every migration, add the owner invite.
// Runs as the first half of the Playwright web server command, so it always happens before `vp preview` opens the
// database (rebuilding it under a running server breaks D1). Never touches .wrangler/state, the developer's data.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { OWNER, STATE_DIR } from './env.ts';

// wrangler's own entry script, run with this Node: no dependence on PATH or on a shell
const bin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const wrangler = (...args: string[]) =>
  execFileSync(process.execPath, [bin, ...args, '--local', '--persist-to', STATE_DIR], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  });

rmSync(STATE_DIR, { recursive: true, force: true });
wrangler('d1', 'migrations', 'apply', 'living');
wrangler('d1', 'execute', 'living', '--command', `INSERT INTO invites (code, role, note) VALUES ('${OWNER.invite}', 'owner', 'e2e')`);
console.log(`e2e state ready in ${STATE_DIR}`);
