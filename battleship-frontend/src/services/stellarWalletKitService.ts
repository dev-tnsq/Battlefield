import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { KitEventType, Networks } from '@creit-tech/stellar-wallets-kit/types';
import type { WalletError } from '@stellar/stellar-sdk/contract';
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
  return StellarWalletsKit.signAuthEntry(authEntry, {
    ...opts,
    networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
  });
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
        const signed = await signAuthEntry(authEntry, {
          ...opts,
          address: opts?.address || address,
          networkPassphrase: opts?.networkPassphrase || NETWORK_PASSPHRASE,
        });
        return {
          signedAuthEntry: signed.signedAuthEntry,
          signerAddress: signed.signerAddress || address,
        };
      } catch (error) {
        return {
          signedAuthEntry: authEntry,
          signerAddress: address,
          error: toWalletError(error instanceof Error ? error.message : 'Failed to sign auth entry'),
        };
      }
    },
  };
}
