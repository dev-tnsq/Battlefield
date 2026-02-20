import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { KitEventType, Networks } from '@creit-tech/stellar-wallets-kit/types';
import type { WalletError } from '@stellar/stellar-sdk/contract';
import { Buffer } from 'buffer';
import { NETWORK_PASSPHRASE } from '@/utils/constants';

const SELECTED_WALLET_ID = 'selectedWalletId';
const FREIGHTER_ID = 'freighter';

function getSelectedWalletId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SELECTED_WALLET_ID);
}

let initialized = false;

function ensureKit() {
  if (initialized) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: Networks.TESTNET,
    selectedWalletId: getSelectedWalletId() ?? FREIGHTER_ID,
  });

  StellarWalletsKit.on(KitEventType.WALLET_SELECTED, ({ payload }) => {
    if (typeof window === 'undefined') return;
    if (!payload?.id) return;
    localStorage.setItem(SELECTED_WALLET_ID, payload.id);
  });

  StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(SELECTED_WALLET_ID);
  });

  initialized = true;
}

export async function signTransaction(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }
) {
  ensureKit();
  return StellarWalletsKit.signTransaction(xdr, {
    ...opts,
    networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
  });
}

export async function signAuthEntry(
  authEntry: string,
  opts?: { networkPassphrase?: string; address?: string }
) {
  ensureKit();
  const selectedWalletId = getSelectedWalletId() ?? FREIGHTER_ID;
  const requestOptions = {
    ...opts,
    networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
  };

  if (selectedWalletId === FREIGHTER_ID) {
    const freighterApi = await import('@stellar/freighter-api');
    return freighterApi.signAuthEntry(authEntry, requestOptions);
  }

  return StellarWalletsKit.signAuthEntry(authEntry, requestOptions);
}

export async function getPublicKey() {
  ensureKit();
  if (!getSelectedWalletId()) return null;
  const { address } = await StellarWalletsKit.getAddress();
  return address;
}

export async function setWallet(walletId: string) {
  ensureKit();
  localStorage.setItem(SELECTED_WALLET_ID, walletId);
  StellarWalletsKit.setWallet(walletId);
}

export async function disconnect(callback?: () => Promise<void>) {
  ensureKit();
  localStorage.removeItem(SELECTED_WALLET_ID);
  await StellarWalletsKit.disconnect();
  if (callback) await callback();
}

export async function connect(callback?: () => Promise<void>) {
  ensureKit();
  await StellarWalletsKit.authModal();
  if (callback) await callback();
}

export function getSelectedWallet(): string | null {
  return getSelectedWalletId();
}

const toWalletError = (message: string): WalletError => ({ message, code: -1 });

function maskAddress(address: unknown): string {
  if (typeof address !== 'string') return 'unknown';
  const trimmed = address.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') return `string(len=${value.length})`;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `bytes(len=${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
    return `object(keys=${keys.join(',') || 'none'})`;
  }
  return String(value);
}

function firstNonEmptyString(values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function getContractSigner(address: string) {
  ensureKit();

  return {
    signTransaction: async (xdr: string, opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }) => {
      try {
        const signed = await signTransaction(xdr, {
          ...opts,
          address: opts?.address || address,
          networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
        });
        return {
          signedTxXdr: signed.signedTxXdr,
          signerAddress: signed.signerAddress || address,
        };
      } catch (error) {
        return {
          signedTxXdr: xdr,
          signerAddress: address,
          error: toWalletError(error instanceof Error ? error.message : 'Failed to sign transaction'),
        };
      }
    },

    signAuthEntry: async (authEntry: string, opts?: { networkPassphrase?: string; address?: string }) => {
      try {
        const requestedAddress = opts?.address || address;
        const selectedWalletId = getSelectedWalletId() ?? 'unknown';
        console.log('[wallet-auth] signAuthEntry request', {
          selectedWalletId,
          requestedAddress: maskAddress(requestedAddress),
          signingPath: selectedWalletId === FREIGHTER_ID ? 'freighter-direct' : 'wallets-kit',
          networkPassphraseSource: opts?.networkPassphrase ? 'caller' : 'default',
          authEntryShape: summarizeValue(authEntry),
        });

        const signed = await signAuthEntry(authEntry, {
          ...opts,
          address: requestedAddress,
          networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
        });

        const signedRecord = signed as Record<string, unknown>;
        const candidates: Array<[string, unknown]> = [
          ['signedAuthEntry', signedRecord.signedAuthEntry],
          ['signed_auth_entry', signedRecord.signed_auth_entry],
          ['signature', signedRecord.signature],
          ['sig', signedRecord.sig],
          ['xdr', signedRecord.xdr],
        ];

        let selectedField: string | undefined;
        const signedAuthEntryValue = firstNonEmptyString([
          ...candidates.map(([fieldName, value]) => {
            const trimmed = typeof value === 'string' ? value.trim() : value;
            if (!selectedField && typeof trimmed === 'string' && trimmed.length > 0) {
              selectedField = fieldName;
            }
            return value;
          }),
        ]);

        console.log('[wallet-auth] signAuthEntry response meta', {
          selectedWalletId,
          signerAddress: maskAddress(signedRecord.signerAddress),
          selectedField: selectedField ?? 'none',
          resultShape: summarizeValue(signed),
          candidateShapes: Object.fromEntries(candidates.map(([fieldName, value]) => [fieldName, summarizeValue(value)])),
          apiErrorShape: summarizeValue(signedRecord.error),
        });

        if (!signedAuthEntryValue) {
          console.error('[wallet-auth] Empty auth-entry signature payload from wallet', {
            selectedWalletId,
            requestedAddress: maskAddress(requestedAddress),
            signerAddress: maskAddress(signedRecord.signerAddress),
            resultShape: summarizeValue(signed),
          });
          return {
            signedAuthEntry: '',
            signerAddress: (signedRecord.signerAddress as string) || address,
            error: toWalletError('Wallet returned empty auth-entry signature bytes. This usually means the signing request was cancelled/rejected in wallet UI or the auth-entry preimage was invalid for Freighter.'),
          };
        }

        return {
          signedAuthEntry: signedAuthEntryValue,
          signerAddress: (signedRecord.signerAddress as string) || address,
        };
      } catch (error) {
        const selectedWalletId = getSelectedWalletId() ?? 'unknown';

        console.error('[wallet-auth] signAuthEntry threw before returning signature', {
          selectedWalletId,
          requestedAddress: maskAddress(opts?.address || address),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return {
          signedAuthEntry: authEntry,
          signerAddress: address,
          error: toWalletError(error instanceof Error ? error.message : 'Failed to sign auth entry'),
        };
      }
    },
  };
}
