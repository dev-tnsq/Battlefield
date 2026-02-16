#!/usr/bin/env bun

import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import { Client as BattleshipClient } from '../bindings/battleship/src/index';
import { readEnvFile, getEnvValue } from './utils/env';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

function usage() {
  console.log(`
Usage:
  bun run prover:init            # generate prover key + env values
  bun run prover:set             # set verifier pubkey on battleship contract
  bun run prover:clear           # clear verifier on battleship contract
  bun run prover:set-zk          # set zk verifier contract address on battleship contract
  bun run prover:clear-zk        # clear zk verifier contract address on battleship contract
  bun run prover:set-bet-token   # set wager escrow token contract on battleship contract
  bun run prover:clear-bet-token # clear wager escrow token contract on battleship contract
  bun run prover:set-fee         # set protocol fee bps on battleship contract
`);
}

function writeEnv(env: Record<string, string>) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  return Bun.write('.env', `${lines.join('\n')}\n`);
}

async function initProver() {
  const env = await readEnvFile('.env');

  let secret = getEnvValue(env, 'NOIR_PROVER_SECRET');
  if (!secret) {
    secret = Keypair.random().secret();
    env.NOIR_PROVER_SECRET = secret;
  }

  const keypair = Keypair.fromSecret(secret);
  env.NOIR_VERIFIER_PUBKEY_HEX = Buffer.from(keypair.rawPublicKey()).toString('hex');
  env.NOIR_PROVER_PORT = getEnvValue(env, 'NOIR_PROVER_PORT', '8787');
  env.VITE_NOIR_PROVER_URL = getEnvValue(env, 'VITE_NOIR_PROVER_URL', `http://127.0.0.1:${env.NOIR_PROVER_PORT}`);

  await writeEnv(env);

  console.log('✅ Noir prover key initialized');
  console.log(`Verifier pubkey hex: ${env.NOIR_VERIFIER_PUBKEY_HEX}`);
  console.log(`Prover URL: ${env.VITE_NOIR_PROVER_URL}`);
}

function buildSigner(secret: string, publicKey: string) {
  const keypair = Keypair.fromSecret(secret);

  return {
    signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
      const tx = TransactionBuilder.fromXDR(txXdr, opts?.networkPassphrase || NETWORK_PASSPHRASE);
      tx.sign(keypair);
      return {
        signedTxXdr: tx.toXDR(),
        signerAddress: publicKey,
      };
    },
    signAuthEntry: async (preimageXdr: string) => {
      const preimageBytes = Buffer.from(preimageXdr, 'base64');
      const payload = hash(preimageBytes);
      const signatureBytes = keypair.sign(payload);
      return {
        signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
        signerAddress: publicKey,
      };
    },
  };
}

async function setVerifier(clear = false) {
  const env = await readEnvFile('.env');
  const contractId = getEnvValue(env, 'VITE_BATTLESHIP_CONTRACT_ID');
  const adminSecret =
    getEnvValue(env, 'VITE_DEV_ADMIN_SECRET') ||
    getEnvValue(env, 'VITE_DEV_PLAYER1_SECRET');
  const adminAddress = getEnvValue(env, 'VITE_DEV_ADMIN_ADDRESS');

  if (!contractId) throw new Error('VITE_BATTLESHIP_CONTRACT_ID missing in .env');
  if (!adminSecret) throw new Error('VITE_DEV_ADMIN_SECRET (or VITE_DEV_PLAYER1_SECRET) missing in .env');
  if (!adminAddress) throw new Error('VITE_DEV_ADMIN_ADDRESS missing in .env');

  const signer = buildSigner(adminSecret, adminAddress);
  const client = new BattleshipClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: adminAddress,
    ...signer,
  });

  if (clear) {
    const tx = await client.clear_verifier();
    await tx.signAndSend();
    console.log('✅ Verifier cleared on battleship contract');
    return;
  }

  const verifierHex = getEnvValue(env, 'NOIR_VERIFIER_PUBKEY_HEX');
  if (!verifierHex) throw new Error('NOIR_VERIFIER_PUBKEY_HEX missing in .env. Run prover:init first');

  const tx = await client.set_verifier({ verifier_pub_key: Buffer.from(verifierHex, 'hex') });
  await tx.signAndSend();
  console.log('✅ Verifier set on battleship contract');
}

async function setZkVerifier(clear = false) {
  const env = await readEnvFile('.env');
  const contractId = getEnvValue(env, 'VITE_BATTLESHIP_CONTRACT_ID');
  const adminSecret =
    getEnvValue(env, 'VITE_DEV_ADMIN_SECRET') ||
    getEnvValue(env, 'VITE_DEV_PLAYER1_SECRET');
  const adminAddress = getEnvValue(env, 'VITE_DEV_ADMIN_ADDRESS');

  if (!contractId) throw new Error('VITE_BATTLESHIP_CONTRACT_ID missing in .env');
  if (!adminSecret) throw new Error('VITE_DEV_ADMIN_SECRET (or VITE_DEV_PLAYER1_SECRET) missing in .env');
  if (!adminAddress) throw new Error('VITE_DEV_ADMIN_ADDRESS missing in .env');

  const signer = buildSigner(adminSecret, adminAddress);
  const client = new BattleshipClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: adminAddress,
    ...signer,
  });

  if (clear) {
    const tx = await client.clear_zk_verifier();
    await tx.signAndSend();
    console.log('✅ ZK verifier contract cleared on battleship contract');
    return;
  }

  const zkVerifierContractId =
    getEnvValue(env, 'NOIR_ZK_VERIFIER_CONTRACT_ID') ||
    getEnvValue(env, 'VITE_NOIR_ZK_VERIFIER_CONTRACT_ID');

  if (!zkVerifierContractId) {
    throw new Error('NOIR_ZK_VERIFIER_CONTRACT_ID (or VITE_NOIR_ZK_VERIFIER_CONTRACT_ID) missing in .env');
  }

  const tx = await client.set_zk_verifier({ verifier_contract: zkVerifierContractId });
  await tx.signAndSend();
  console.log('✅ ZK verifier contract set on battleship contract');
}

async function setBetToken(clear = false) {
  const env = await readEnvFile('.env');
  const contractId = getEnvValue(env, 'VITE_BATTLESHIP_CONTRACT_ID');
  const adminSecret =
    getEnvValue(env, 'VITE_DEV_ADMIN_SECRET') ||
    getEnvValue(env, 'VITE_DEV_PLAYER1_SECRET');
  const adminAddress = getEnvValue(env, 'VITE_DEV_ADMIN_ADDRESS');

  if (!contractId) throw new Error('VITE_BATTLESHIP_CONTRACT_ID missing in .env');
  if (!adminSecret) throw new Error('VITE_DEV_ADMIN_SECRET (or VITE_DEV_PLAYER1_SECRET) missing in .env');
  if (!adminAddress) throw new Error('VITE_DEV_ADMIN_ADDRESS missing in .env');

  const signer = buildSigner(adminSecret, adminAddress);
  const client = new BattleshipClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: adminAddress,
    ...signer,
  });

  if (clear) {
    const tx = await client.clear_bet_token();
    await tx.signAndSend();
    console.log('✅ Bet token contract cleared on battleship contract');
    return;
  }

  const betTokenContractId =
    getEnvValue(env, 'BET_TOKEN_CONTRACT_ID') ||
    getEnvValue(env, 'VITE_BET_TOKEN_CONTRACT_ID');

  if (!betTokenContractId) {
    throw new Error('BET_TOKEN_CONTRACT_ID (or VITE_BET_TOKEN_CONTRACT_ID) missing in .env');
  }

  const tx = await client.set_bet_token({ token_contract: betTokenContractId });
  await tx.signAndSend();
  console.log('✅ Bet token contract set on battleship contract');
}

async function setFeeBps() {
  const env = await readEnvFile('.env');
  const contractId = getEnvValue(env, 'VITE_BATTLESHIP_CONTRACT_ID');
  const adminSecret =
    getEnvValue(env, 'VITE_DEV_ADMIN_SECRET') ||
    getEnvValue(env, 'VITE_DEV_PLAYER1_SECRET');
  const adminAddress = getEnvValue(env, 'VITE_DEV_ADMIN_ADDRESS');
  const feeBpsRaw = getEnvValue(env, 'BATTLESHIP_FEE_BPS', '500');
  const feeBps = Number(feeBpsRaw);

  if (!contractId) throw new Error('VITE_BATTLESHIP_CONTRACT_ID missing in .env');
  if (!adminSecret) throw new Error('VITE_DEV_ADMIN_SECRET (or VITE_DEV_PLAYER1_SECRET) missing in .env');
  if (!adminAddress) throw new Error('VITE_DEV_ADMIN_ADDRESS missing in .env');
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 2000) {
    throw new Error('BATTLESHIP_FEE_BPS must be between 0 and 2000');
  }

  const signer = buildSigner(adminSecret, adminAddress);
  const client = new BattleshipClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: adminAddress,
    ...signer,
  });

  const tx = await client.set_fee_bps({ fee_bps: feeBps });
  await tx.signAndSend();
  console.log(`✅ Fee bps set on battleship contract: ${feeBps}`);
}

const cmd = process.argv[2];
if (!cmd || cmd === '--help' || cmd === '-h') {
  usage();
  process.exit(cmd ? 0 : 1);
}

if (cmd === 'init') {
  await initProver();
} else if (cmd === 'set') {
  await setVerifier(false);
} else if (cmd === 'clear') {
  await setVerifier(true);
} else if (cmd === 'set-zk') {
  await setZkVerifier(false);
} else if (cmd === 'clear-zk') {
  await setZkVerifier(true);
} else if (cmd === 'set-bet-token') {
  await setBetToken(false);
} else if (cmd === 'clear-bet-token') {
  await setBetToken(true);
} else if (cmd === 'set-fee') {
  await setFeeBps();
} else {
  usage();
  process.exit(1);
}
