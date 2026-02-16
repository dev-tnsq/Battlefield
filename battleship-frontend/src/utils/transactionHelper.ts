/**
 * Transaction helper utilities
 */

import { contract, Networks, rpc, TransactionBuilder } from '@stellar/stellar-sdk';

function getRpcUrl(): string {
  return import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
}

function getNetworkPassphrase(): string {
  return import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
}

async function submitSignedXdr(
  txXdr: string,
  timeoutInSeconds: number,
): Promise<contract.SentTransaction<any>> {
  const server = new rpc.Server(getRpcUrl());
  const parsedTx = TransactionBuilder.fromXDR(txXdr, getNetworkPassphrase());
  const sendResponse: any = await server.sendTransaction(parsedTx);

  if (sendResponse.status !== 'PENDING' && sendResponse.status !== 'SUCCESS') {
    throw new Error(`Transaction submission failed with status: ${sendResponse.status}`);
  }

  const hash = sendResponse.hash;
  if (!hash) {
    throw new Error('Transaction hash missing from sendTransaction response');
  }

  const startedAt = Date.now();
  const timeoutMs = Math.max(5, timeoutInSeconds) * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const txResponse: any = await server.getTransaction(hash);

    if (txResponse.status === 'SUCCESS') {
      return {
        result: txResponse.returnValue,
        getTransactionResponse: txResponse,
      } as unknown as contract.SentTransaction<any>;
    }

    if (txResponse.status === 'FAILED') {
      throw new Error(`Transaction failed: ${txResponse.resultXdr || txResponse.errorResultXdr || 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Transaction submission timed out while waiting for final status');
}

/**
 * Sign and send a transaction via Launchtube
 * @param tx - The assembled transaction or XDR string
 * @param timeoutInSeconds - Timeout for the transaction
 * @param validUntilLedgerSeq - Valid until ledger sequence
 * @returns Transaction result
 */
export async function signAndSendViaLaunchtube(
  tx: contract.AssembledTransaction<any> | string,
  timeoutInSeconds: number = 30,
  _validUntilLedgerSeq?: number
): Promise<contract.SentTransaction<any>> {
  // If tx is an AssembledTransaction, simulate and send
  if (typeof tx !== 'string' && 'simulate' in tx) {
    const simulated = await tx.simulate();
    try {
      return await simulated.signAndSend();
    } catch (err: any) {
      const errName = err?.name ?? '';
      const errMessage = err instanceof Error ? err.message : String(err);
      const isNoSignatureNeeded =
        errName.includes('NoSignatureNeededError') ||
        errMessage.includes('NoSignatureNeededError') ||
        errMessage.includes('This is a read call') ||
        errMessage.includes('requires no signature') ||
        errMessage.includes('force: true');

      // Some contract bindings incorrectly classify state-changing methods as "read calls".
      // In those cases, the SDK requires `force: true` to sign and send anyway.
      if (isNoSignatureNeeded) {
        try {
          return await simulated.signAndSend({ force: true });
        } catch (forceErr: any) {
          const forceName = forceErr?.name ?? '';
          const forceMessage = forceErr instanceof Error ? forceErr.message : String(forceErr);
          const isStillReadOnly =
            forceName.includes('NoSignatureNeededError') ||
            forceMessage.includes('NoSignatureNeededError') ||
            forceMessage.includes('This is a read call') ||
            forceMessage.includes('requires no signature');

          // If the SDK still says it's a read call, treat the simulation result as the final result.
          if (isStillReadOnly) {
            const simulatedResult =
              (simulated as any).result ??
              (simulated as any).simulationResult?.result ??
              (simulated as any).returnValue ??
              (tx as any).result;

            return {
              result: simulatedResult,
              getTransactionResponse: undefined,
            } as unknown as contract.SentTransaction<any>;
          }

          throw forceErr;
        }
      }

      throw err;
    }
  }

  return submitSignedXdr(tx, timeoutInSeconds);
}
