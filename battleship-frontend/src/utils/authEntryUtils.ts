/**
 * Auth Entry utilities for multi-sig transaction flows
 */

import { Buffer } from 'buffer';
import { xdr, Address, authorizeEntry } from '@stellar/stellar-sdk';
import { contract } from '@stellar/stellar-sdk';
import { calculateValidUntilLedger } from './ledgerUtils';
import { DEFAULT_AUTH_TTL_MINUTES } from './constants';

function summarizeAuthPayload(value: unknown): string {
  if (typeof value === 'string') return `string(len=${value.length})`;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `bytes(len=${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
    return `object(keys=${keys.join(',') || 'none'})`;
  }
  return String(value);
}

function summarizeSignResult(signResult: unknown): Record<string, string> {
  if (!signResult || typeof signResult !== 'object') {
    return { result: summarizeAuthPayload(signResult) };
  }

  const record = signResult as Record<string, unknown>;
  return {
    result: summarizeAuthPayload(signResult),
    signedAuthEntry: summarizeAuthPayload(record.signedAuthEntry),
    signed_auth_entry: summarizeAuthPayload(record.signed_auth_entry),
    signature: summarizeAuthPayload(record.signature),
    sig: summarizeAuthPayload(record.sig),
    xdr: summarizeAuthPayload(record.xdr),
    signerAddress: summarizeAuthPayload(record.signerAddress),
    error: summarizeAuthPayload(record.error),
  };
}

function normalizeAuthSignatureBytes(signedAuthEntryValue: unknown): Buffer {
  const firstNonEmptyString = (values: Array<unknown>): string | undefined => {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
    return undefined;
  };

  const fromAuthEntryXdr = (value: string | Buffer, format: 'base64' | 'raw'): Buffer | null => {
    try {
      const entry = format === 'raw'
        ? xdr.SorobanAuthorizationEntry.fromXDR(
          typeof value === 'string' ? Buffer.from(value, 'base64') : value,
          'raw',
        )
        : (typeof value === 'string'
          ? xdr.SorobanAuthorizationEntry.fromXDR(value, 'base64')
          : null);
      if (!entry) return null;
      const credentials = entry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') return null;

      const signature = credentials.address().signature();
      if (signature.switch().name !== 'scvBytes') return null;

      const sigBytes = Buffer.from(signature.bytes());
      return sigBytes.length === 64 ? sigBytes : null;
    } catch {
      return null;
    }
  };

  const unwrapCandidate = (value: unknown): unknown => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        return firstNonEmptyString([
          parsed.signedAuthEntry,
          parsed.signature,
          parsed.signed_auth_entry,
          parsed.sig,
          parsed.xdr,
        ]) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return firstNonEmptyString([
        record.signedAuthEntry,
        record.signature,
        record.signed_auth_entry,
        record.sig,
        record.xdr,
      ]) ?? value;
    }
    return value;
  };

  const candidate = unwrapCandidate(signedAuthEntryValue);

  if (Buffer.isBuffer(candidate) || candidate instanceof Uint8Array) {
    const raw = Buffer.from(candidate);
    if (raw.length === 64) return raw;
    const parsed = fromAuthEntryXdr(raw, 'raw');
    if (parsed) return parsed;
  }

  if (typeof candidate === 'string') {
    const withNoHexPrefix = candidate.startsWith('0x') ? candidate.slice(2) : candidate;

    if (/^[0-9a-fA-F]{128}$/.test(withNoHexPrefix)) {
      const hexBytes = Buffer.from(withNoHexPrefix, 'hex');
      if (hexBytes.length === 64) return hexBytes;
    }

    const normalizedBase64 = withNoHexPrefix.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = normalizedBase64 + '='.repeat((4 - (normalizedBase64.length % 4)) % 4);
    const decoded = Buffer.from(paddedBase64, 'base64');
    if (decoded.length === 64) return decoded;

    const parsedBase64 = fromAuthEntryXdr(paddedBase64, 'base64');
    if (parsedBase64) return parsedBase64;

    const parsedRaw = fromAuthEntryXdr(decoded, 'raw');
    if (parsedRaw) return parsedRaw;
  }

  const candidateDetail = summarizeAuthPayload(candidate);
  const originalDetail = summarizeAuthPayload(signedAuthEntryValue);
  console.error('[auth-normalize] Invalid auth-entry signing response', {
    candidateDetail,
    originalDetail,
  });
  throw new Error(`Invalid auth-entry signing response. Expected 64-byte signature or signed auth-entry XDR. Received ${candidateDetail}. Original payload: ${originalDetail}.`);
}

/**
 * Inject a signed auth entry from Player 1 into Player 2's transaction
 * Used in multi-sig flows where Player 1 has pre-signed an auth entry
 *
 * @param tx - The assembled transaction from Player 2
 * @param player1AuthEntryXDR - Player 1's signed auth entry in XDR format
 * @param player2Address - Player 2's address
 * @param player2Signer - Player 2's signing functions
 * @returns Updated transaction with both auth entries signed
 */
export async function injectSignedAuthEntry(
  tx: contract.AssembledTransaction<any>,
  player1AuthEntryXDR: string,
  player2Address: string,
  player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  validUntilLedgerSeq?: number
): Promise<contract.AssembledTransaction<any>> {
  // Parse Player 1's signed auth entry
  const player1SignedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(
    player1AuthEntryXDR,
    'base64'
  );
  const player1SignedAddress = player1SignedAuthEntry.credentials().address().address();
  const player1AddressString = Address.fromScAddress(player1SignedAddress).toString();

  // Get the simulation data
  if (!tx.simulationData?.result?.auth) {
    throw new Error('No auth entries found in transaction simulation');
  }

  const authEntries = tx.simulationData.result.auth;
  console.log('[injectSignedAuthEntry] Found', authEntries.length, 'auth entries');

  // Find Player 1's stub entry and Player 2's entry
  let player1StubIndex = -1;
  let player2AuthEntry: xdr.SorobanAuthorizationEntry | null = null;
  let player2Index = -1;

  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    try {
      const credentialType = entry.credentials().switch().name;

      // Note: the invoker (transaction source) may show up as `sorobanCredentialsSourceAccount`,
      // which does NOT require an auth entry signature (it is authorized by the envelope signature).
      if (credentialType === 'sorobanCredentialsAddress') {
        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();

        if (entryAddressString === player1AddressString) {
          player1StubIndex = i;
          console.log(`[injectSignedAuthEntry] Found Player 1 stub at index ${i}`);
        } else if (entryAddressString === player2Address) {
          player2AuthEntry = entry;
          player2Index = i;
          console.log(`[injectSignedAuthEntry] Found Player 2 auth entry at index ${i}`);
        }
      } else {
        console.log(`[injectSignedAuthEntry] Skipping non-address credentials at index ${i}: ${credentialType}`);
      }
    } catch (err) {
      console.error('[injectSignedAuthEntry] Error processing auth entry:', err);
      continue;
    }
  }

  if (player1StubIndex === -1) {
    throw new Error('Could not find Player 1 stub entry in transaction');
  }

  if (!player2AuthEntry) {
    console.log(
      `[injectSignedAuthEntry] No address-based auth entry found for Player 2 (${player2Address}); assuming Player 2 is the invoker/source account and does not require an auth entry signature`
    );
  }

  // Replace Player 1's stub with their signed entry
  authEntries[player1StubIndex] = player1SignedAuthEntry;
  console.log('[injectSignedAuthEntry] Replaced Player 1 stub with signed entry');

  // Sign Player 2's auth entry (only if Player 2 appears as a non-invoker address auth entry)
  if (player2AuthEntry && player2Index !== -1) {
    console.log('[injectSignedAuthEntry] Signing Player 2 auth entry');

    if (!player2Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const authValidUntilLedgerSeq =
      validUntilLedgerSeq ??
      (await calculateValidUntilLedger(tx.options.rpcUrl, DEFAULT_AUTH_TTL_MINUTES));

    const player2SignedAuthEntry = await authorizeEntry(
      player2AuthEntry,
      async (preimage) => {
        console.log('[injectSignedAuthEntry] Signing Player 2 preimage...');

        if (!player2Signer.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }

        const signResult = await player2Signer.signAuthEntry(preimage.toXDR('base64'), {
          networkPassphrase: tx.options.networkPassphrase,
          address: player2Address,
        });

        console.log('[injectSignedAuthEntry] Wallet signAuthEntry result meta:', summarizeSignResult(signResult));

        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }

        return normalizeAuthSignatureBytes(signResult.signedAuthEntry || (signResult as unknown));
      },
      authValidUntilLedgerSeq,
      tx.options.networkPassphrase
    );

    // Replace Player 2's stub with their signed entry
    authEntries[player2Index] = player2SignedAuthEntry;
    console.log('[injectSignedAuthEntry] Signed Player 2 auth entry');
  }

  // Update the transaction's auth entries
  tx.simulationData.result.auth = authEntries;

  return tx;
}
