#!/usr/bin/env bun

const rootCwd = process.cwd();
const frontendCwd = `${rootCwd}/battleship-frontend`;

const prover = Bun.spawn(['bun', 'run', 'prover:dev'], {
  cwd: rootCwd,
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

const frontend = Bun.spawn(['bun', 'run', 'dev'], {
  cwd: frontendCwd,
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

const shutdown = () => {
  try { prover.kill(); } catch {}
  try { frontend.kill(); } catch {}
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const [proverCode, frontendCode] = await Promise.all([
  prover.exited,
  frontend.exited,
]);

shutdown();

if (proverCode !== 0) {
  console.error(`zk:up failed: prover exited with code ${proverCode}`);
  process.exit(proverCode ?? 1);
}

if (frontendCode !== 0) {
  console.error(`zk:up failed: frontend exited with code ${frontendCode}`);
  process.exit(frontendCode ?? 1);
}

export {};
