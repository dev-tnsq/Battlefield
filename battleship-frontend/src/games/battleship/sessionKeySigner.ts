import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash, rpc } from '@stellar/stellar-sdk';
import type { WalletError } from '@stellar/stellar-sdk/contract';
import type { ContractSigner } from '@/types/signer';
import { NETWORK, NETWORK_PASSPHRASE, RPC_URL } from '@/utils/constants';

export interface SessionKeySigner {
  publicKey: string;
  secret: string;
  signer: ContractSigner;
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

const verifiedDelegates = new Set<string>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSorobanAccount(publicKey: string, attempts = 8): Promise<void> {
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await server.getAccount(publicKey);
      console.info('[session-delegate] Delegate account confirmed on Soroban RPC', {
        delegate: maskAddress(publicKey),
        attempt,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNotFound = message.includes('Account not found') || message.includes('not found');
      if (!isNotFound) {
        throw error;
      }
      await sleep(500 * attempt);
    }
  }

  throw new Error(`Delegate account not visible on Soroban RPC after funding: ${publicKey}`);
}

function toWalletError(message: string): WalletError {
  return { message, code: -1 };
}

function createSignerFromSecret(secret: string): ContractSigner {
  const keypair = Keypair.fromSecret(secret);
  const publicKey = keypair.publicKey();

  return {
    signTransaction: async (txXdr: string, opts?: any) => {
      try {
        if (!opts?.networkPassphrase) {
          throw new Error('Missing networkPassphrase');
        }

        const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
        transaction.sign(keypair);

        return {
          signedTxXdr: transaction.toXDR(),
          signerAddress: publicKey,
        };
      } catch (error) {
        return {
          signedTxXdr: txXdr,
          signerAddress: publicKey,
          error: toWalletError(
            error instanceof Error ? error.message : 'Failed to sign transaction',
          ),
        };
      }
    },

    signAuthEntry: async (preimageXdr: string) => {
      try {
        const preimageBytes = Buffer.from(preimageXdr, 'base64');
        const payload = hash(preimageBytes);
        const signatureBytes = keypair.sign(payload);

        return {
          signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
          signerAddress: publicKey,
        };
      } catch (error) {
        return {
          signedAuthEntry: preimageXdr,
          signerAddress: publicKey,
          error: toWalletError(
            error instanceof Error ? error.message : 'Failed to sign auth entry',
          ),
        };
      }
    },
  };
}

export function createSessionKeySigner(): SessionKeySigner {
  const keypair = Keypair.random();
  const secret = keypair.secret();
  return {
    publicKey: keypair.publicKey(),
    secret,
    signer: createSignerFromSecret(secret),
  };
}

export function createSessionKeySignerFromSecret(secret: string): SessionKeySigner {
  const keypair = Keypair.fromSecret(secret);
  return {
    publicKey: keypair.publicKey(),
    secret,
    signer: createSignerFromSecret(secret),
  };
}

export async function ensureSessionSignerAccountReady(publicKey: string): Promise<void> {
  if (verifiedDelegates.has(publicKey)) {
    return;
  }

  if (NETWORK !== 'testnet') {
    console.info('[session-delegate] Skipping delegate funding check on non-testnet network', {
      delegate: maskAddress(publicKey),
      network: NETWORK,
    });
    verifiedDelegates.add(publicKey);
    return;
  }

  console.info('[session-delegate] Ensuring delegate account is funded on testnet', {
    delegate: maskAddress(publicKey),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const horizonRes = await fetch(`https://horizon-testnet.stellar.org/accounts/${encodeURIComponent(publicKey)}`);
  const alreadyExistsOnHorizon = horizonRes.ok;

  if (!alreadyExistsOnHorizon) {
    const friendbotRes = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
    if (friendbotRes.ok) {
      console.info('[session-delegate] Delegate account funded via Friendbot', {
        delegate: maskAddress(publicKey),
        status: friendbotRes.status,
      });
    } else {
      const friendbotError = await friendbotRes.text();
      const alreadyFunded = /already\s+exist|createaccountalreadyexist/i.test(friendbotError);
      if (alreadyFunded) {
        console.info('[session-delegate] Delegate account already exists on testnet', {
          delegate: maskAddress(publicKey),
          status: friendbotRes.status,
        });
      } else {
        console.error('[session-delegate] Friendbot funding failed', {
          delegate: maskAddress(publicKey),
          status: friendbotRes.status,
          statusText: friendbotRes.statusText,
          errorPreview: friendbotError.slice(0, 200),
        });
        throw new Error(`Failed to fund delegated signer account via Friendbot: ${friendbotError || friendbotRes.statusText}`);
      }
    }
  } else {
    console.info('[session-delegate] Delegate account already exists on horizon', {
      delegate: maskAddress(publicKey),
    });
  }

  await waitForSorobanAccount(publicKey);
  verifiedDelegates.add(publicKey);
}
