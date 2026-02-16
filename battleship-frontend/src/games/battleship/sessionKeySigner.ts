import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { WalletError } from '@stellar/stellar-sdk/contract';
import type { ContractSigner } from '@/types/signer';

export interface SessionKeySigner {
  publicKey: string;
  secret: string;
  signer: ContractSigner;
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
