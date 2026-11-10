// The `prepare` script, run after `npm install` and `npm ci`: install the Vite+ Git hook dispatcher, so that commits run
// .vite-hooks/pre-commit (`vp staged`). Docs: /docs/runbooks/local-dev.md#提交前检查
//
// It must never fail an install, so it does nothing
// - in CI: GitHub Actions and Cloudflare Workers Builds both set CI, and nobody commits there;
// - outside a Git checkout (a tarball, a copied directory without .git);
// - with VP_GIT_HOOKS=0, Vite+'s own switch for hooks;
// and when `vp config` fails anyway (no git, say), it prints a warning and carries on.
// Plain JavaScript on purpose: it runs before anything else and must not depend on the Node version stripping types.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ci = !!process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';

if (!ci && process.env.VP_GIT_HOOKS !== '0' && existsSync('.git')) {
  const run = spawnSync('vp', ['config', '--no-agent'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (run.status !== 0) console.warn('Git hooks not installed (vp config failed); `npx vp hooks enable` installs them.');
}
