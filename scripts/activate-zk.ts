#!/usr/bin/env bun

import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import { Client as BattleshipClient } from '../bindings/battleship/src/index';
import { Client as NoirVerifierClient } from '../bindings/noir_verifier/src/index';
import { readEnvFile } from './utils/env';

const env = await readEnvFile('.env');
const rpcUrl = env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const networkPassphrase = env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const adminSecret = env.VITE_DEV_ADMIN_SECRET;
const adminAddress = env.VITE_DEV_ADMIN_ADDRESS;
const battleshipId = env.VITE_BATTLESHIP_CONTRACT_ID;
const zkVerifierId = env.NOIR_ZK_VERIFIER_CONTRACT_ID || env.VITE_NOIR_ZK_VERIFIER_CONTRACT_ID;
const verifierPubKeyHex = env.NOIR_VERIFIER_PUBKEY_HEX;

if (!adminSecret || !adminAddress || !battleshipId || !zkVerifierId || !verifierPubKeyHex) {
  throw new Error('Missing required env vars for activation');
}

const keypair = Keypair.fromSecret(adminSecret);
const signer = {
  signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
    const tx = TransactionBuilder.fromXDR(txXdr, opts?.networkPassphrase || networkPassphrase);
    tx.sign(keypair);
    return { signedTxXdr: tx.toXDR(), signerAddress: adminAddress };
  },
  signAuthEntry: async (preimageXdr: string) => {
    const payload = hash(Buffer.from(preimageXdr, 'base64'));
    const signature = keypair.sign(payload);
    return { signedAuthEntry: Buffer.from(signature).toString('base64'), signerAddress: adminAddress };
  },
};

const verifierClient = new NoirVerifierClient({
  contractId: zkVerifierId,
  rpcUrl,
  networkPassphrase,
  publicKey: adminAddress,
  ...signer,
});

const battleshipClient = new BattleshipClient({
  contractId: battleshipId,
  rpcUrl,
  networkPassphrase,
  publicKey: adminAddress,
  ...signer,
});

const verifierTx = await verifierClient.set_verifier({ verifier_pub_key: Buffer.from(verifierPubKeyHex, 'hex') });
await verifierTx.signAndSend({ force: true });

const battleshipTx = await battleshipClient.set_zk_verifier({ verifier_contract: zkVerifierId });
await battleshipTx.signAndSend({ force: true });

const configuredKey = await (await verifierClient.get_verifier()).simulate();
const configuredZk = await (await battleshipClient.get_zk_verifier()).simulate();

console.log(JSON.stringify({
  ok: true,
  battleshipId,
  zkVerifierId,
  verifierKeyConfigured: Boolean(configuredKey.result),
  battleshipZkVerifier: configuredZk.result,
}, null, 2));
