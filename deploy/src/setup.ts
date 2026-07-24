/**
 * One-shot setup: start proof server, then deploy NightScore to preprod/preview.
 *
 * Usage:
 *   npm run setup                        # deploy to preprod (default)
 *   npm run setup -- --network preview   # deploy to preview
 */
import { spawnSync } from 'node:child_process';
import { resolveNetwork, setActiveNetwork, parseNetworkFlag } from './network.js';

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    process.stderr.write(`\nCommand failed: ${cmd} ${args.join(' ')}\n`);
    process.exit(r.status ?? 1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = parseNetworkFlag(argv);
  if (flag) setActiveNetwork(flag);
  const { network } = resolveNetwork();

  process.stdout.write(`\n  Setting up NightScore deployment on: ${network}\n\n`);

  // Public proof server is used by default (no Docker needed).
  // Override with MIDNIGHT_PROOF_SERVER_URL=http://127.0.0.1:6300 if running locally.
  process.stdout.write('  Using public proof server (no Docker required)\n\n');

  // 2. Deploy the NightScore contract
  const deployArgs = ['run', 'deploy'];
  if (flag) deployArgs.push('--', '--network', flag);
  run('npm', deployArgs);
}

main().catch((e) => {
  process.stderr.write(`\nSetup failed: ${(e as Error).message}\n`);
  process.exit(1);
});
