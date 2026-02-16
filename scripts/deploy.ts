#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile, getEnvValue } from "./utils/env";
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

type StellarKeypair = {
  publicKey(): string;
  secret(): string;
};

type StellarKeypairFactory = {
  random(): StellarKeypair;
  fromSecret(secret: string): StellarKeypair;
};

const NETWORK = "testnet";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const DEFAULT_GAME_HUB_TESTNET_CONTRACT_ID = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

async function loadKeypairFactory(): Promise<StellarKeypairFactory> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    return sdk.Keypair;
  } catch {
    await $`bun install`;
    const sdk = await import("@stellar/stellar-sdk");
    return sdk.Keypair;
  }
}

async function testnetAccountExists(address: string): Promise<boolean> {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`, { method: "GET" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} checking ${address}`);
  return true;
}

async function ensureTestnetFunded(address: string): Promise<void> {
  if (await testnetAccountExists(address)) return;
  const fundRes = await fetch(`https://friendbot.stellar.org?addr=${address}`, { method: "GET" });
  if (!fundRes.ok) throw new Error(`Friendbot funding failed (${fundRes.status}) for ${address}`);

  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    if (await testnetAccountExists(address)) return;
  }

  throw new Error(`Funded ${address} but account not visible on Horizon yet`);
}

async function testnetContractExists(contractId: string): Promise<boolean> {
  const tmpPath = join(tmpdir(), `stellar-contract-${contractId}.wasm`);
  try {
    await $`stellar -q contract fetch --id ${contractId} --network ${NETWORK} --out-file ${tmpPath}`;
    return true;
  } catch {
    return false;
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
  }
}

function usage() {
  console.log(`
Usage: bun run deploy [contract-name...]

Examples:
  bun run deploy
  bun run deploy battleship
`);
}

console.log("🚀 Deploying contracts to Stellar testnet...\n");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const Keypair = await loadKeypairFactory();
const allContracts = await getWorkspaceContracts();
const selection = selectContracts(allContracts, args);
if (selection.unknown.length > 0 || selection.ambiguous.length > 0) {
  console.error("❌ Error: Unknown or ambiguous contract names.");
  if (selection.unknown.length > 0) {
    console.error("Unknown:");
    for (const name of selection.unknown) console.error(`  - ${name}`);
  }
  if (selection.ambiguous.length > 0) {
    console.error("Ambiguous:");
    for (const entry of selection.ambiguous) {
      console.error(`  - ${entry.target}: ${entry.matches.join(", ")}`);
    }
  }
  console.error(`\nAvailable contracts: ${listContractNames(allContracts)}`);
  process.exit(1);
}

const contracts = selection.contracts;
const missingWasm: string[] = [];
for (const contract of contracts) {
  if (!await Bun.file(contract.wasmPath).exists()) missingWasm.push(contract.wasmPath);
}
if (missingWasm.length > 0) {
  console.error("❌ Error: Missing WASM build outputs:");
  for (const p of missingWasm) console.error(`  - ${p}`);
  console.error("\nRun 'bun run build [contract-name]' first");
  process.exit(1);
}

const walletAddresses: Record<string, string> = {};
const walletSecrets: Record<string, string> = {};
const existingSecrets: Record<string, string | null> = { player1: null, player2: null };

const existingEnv = await readEnvFile(".env");
for (const identity of ["player1", "player2"]) {
  const key = `VITE_DEV_${identity.toUpperCase()}_SECRET`;
  const value = getEnvValue(existingEnv, key);
  if (value && value !== "NOT_AVAILABLE") existingSecrets[identity] = value;
}

const existingContractIds: Record<string, string> = {};
let existingDeployment: any = null;
if (existsSync("deployment.json")) {
  try {
    existingDeployment = await Bun.file("deployment.json").json();
    if (existingDeployment?.contracts && typeof existingDeployment.contracts === "object") {
      Object.assign(existingContractIds, existingDeployment.contracts);
    }
  } catch {
    // ignore invalid deployment cache
  }
}

for (const contract of allContracts) {
  if (existingContractIds[contract.packageName]) continue;
  const envId = getEnvValue(existingEnv, `VITE_${contract.envKey}_CONTRACT_ID`);
  if (envId) existingContractIds[contract.packageName] = envId;
}

let gameHubId =
  getEnvValue(existingEnv, "VITE_GAME_HUB_CONTRACT_ID") ||
  existingDeployment?.gameHubId ||
  DEFAULT_GAME_HUB_TESTNET_CONTRACT_ID;

if (!await testnetContractExists(gameHubId)) {
  console.error("❌ Error: Game Hub contract is not available on testnet.");
  console.error("Set a valid contract id in VITE_GAME_HUB_CONTRACT_ID and retry.");
  process.exit(1);
}

console.log(`✅ Using Game Hub: ${gameHubId}\n`);

console.log("Setting up admin identity...");
const adminKeypair = Keypair.random();
walletAddresses.admin = adminKeypair.publicKey();
await ensureTestnetFunded(walletAddresses.admin);
console.log("✅ admin funded");

for (const identity of ["player1", "player2"]) {
  let keypair: StellarKeypair;
  if (existingSecrets[identity]) {
    keypair = Keypair.fromSecret(existingSecrets[identity]!);
    console.log(`✅ Reusing ${identity}`);
  } else {
    keypair = Keypair.random();
    console.log(`✅ Generated ${identity}`);
  }

  walletAddresses[identity] = keypair.publicKey();
  walletSecrets[identity] = keypair.secret();

  try {
    await ensureTestnetFunded(keypair.publicKey());
  } catch {
    console.warn(`⚠️ Failed to ensure ${identity} funding`);
  }
}

const adminAddress = walletAddresses.admin;
const adminSecret = adminKeypair.secret();
walletSecrets.admin = adminSecret;
const deployed: Record<string, string> = { ...existingContractIds };

for (const contract of contracts) {
  console.log(`Deploying ${contract.packageName}...`);
  const installResult = await $`stellar contract install --wasm ${contract.wasmPath} --source-account ${adminSecret} --network ${NETWORK}`.text();
  const wasmHash = installResult.trim();

  const deployResult = await $`stellar contract deploy --wasm-hash ${wasmHash} --source-account ${adminSecret} --network ${NETWORK} -- --admin ${adminAddress} --game-hub ${gameHubId}`.text();
  deployed[contract.packageName] = deployResult.trim();
  console.log(`✅ ${contract.packageName}: ${deployed[contract.packageName]}\n`);
}

const deploymentContracts = allContracts.reduce<Record<string, string>>((acc, contract) => {
  acc[contract.packageName] = deployed[contract.packageName] || "";
  return acc;
}, {});

const deploymentInfo = {
  gameHubId,
  contracts: deploymentContracts,
  network: NETWORK,
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  wallets: {
    admin: walletAddresses.admin,
    player1: walletAddresses.player1,
    player2: walletAddresses.player2,
  },
  deployedAt: new Date().toISOString(),
};

await Bun.write("deployment.json", JSON.stringify(deploymentInfo, null, 2) + "\n");

const contractEnvLines = allContracts
  .map((c) => `VITE_${c.envKey}_CONTRACT_ID=${deploymentContracts[c.packageName] || ""}`)
  .join("\n");

const envContent = `# Auto-generated by deploy script
# Do not edit manually - run 'bun run deploy' (or 'bun run setup') to regenerate
# WARNING: This file contains secret keys. Never commit to git!

VITE_SOROBAN_RPC_URL=${RPC_URL}
VITE_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
VITE_GAME_HUB_CONTRACT_ID=${gameHubId}
${contractEnvLines}

# Dev wallet addresses for testing
VITE_DEV_ADMIN_ADDRESS=${walletAddresses.admin}
VITE_DEV_PLAYER1_ADDRESS=${walletAddresses.player1}
VITE_DEV_PLAYER2_ADDRESS=${walletAddresses.player2}

# Dev wallet secret keys (WARNING: Never commit this file!)
VITE_DEV_ADMIN_SECRET=${walletSecrets.admin}
VITE_DEV_PLAYER1_SECRET=${walletSecrets.player1}
VITE_DEV_PLAYER2_SECRET=${walletSecrets.player2}

# Noir prover + verifier integration
NOIR_PROVER_SECRET=${getEnvValue(existingEnv, "NOIR_PROVER_SECRET", "")}
NOIR_VERIFIER_PUBKEY_HEX=${getEnvValue(existingEnv, "NOIR_VERIFIER_PUBKEY_HEX", "")}
NOIR_PROVER_PORT=${getEnvValue(existingEnv, "NOIR_PROVER_PORT", "8787")}
VITE_NOIR_PROVER_URL=${getEnvValue(existingEnv, "VITE_NOIR_PROVER_URL", "http://127.0.0.1:8787")}
NOIR_ZK_VERIFIER_CONTRACT_ID=${getEnvValue(existingEnv, "NOIR_ZK_VERIFIER_CONTRACT_ID", "")}
VITE_NOIR_ZK_VERIFIER_CONTRACT_ID=${getEnvValue(existingEnv, "VITE_NOIR_ZK_VERIFIER_CONTRACT_ID", "")}
BET_TOKEN_CONTRACT_ID=${getEnvValue(existingEnv, "BET_TOKEN_CONTRACT_ID", "")}
VITE_BET_TOKEN_CONTRACT_ID=${getEnvValue(existingEnv, "VITE_BET_TOKEN_CONTRACT_ID", "")}
BATTLESHIP_FEE_BPS=${getEnvValue(existingEnv, "BATTLESHIP_FEE_BPS", "500")}
`;

await Bun.write(".env", envContent + "\n");

console.log("🎉 Deployment complete!");
for (const contract of allContracts) {
  if (!deploymentContracts[contract.packageName]) continue;
  console.log(`  ${contract.packageName}: ${deploymentContracts[contract.packageName]}`);
}

export { gameHubId, deployed };
