/**
 * Configuration loaded from environment variables
 * These are set by the setup script after deployment
 */

import { getAllContractIds, getContractId } from './utils/constants';
import { networks as battleshipNetworks } from './games/battleship/bindings';

export const config = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  contractIds: getAllContractIds(),

  // Contract aliases used by this standalone frontend
  battleshipId: getContractId('battleship') || battleshipNetworks.testnet.contractId,

  devPlayer1Address: import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '',
  devPlayer2Address: import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '',
};

if (Object.keys(config.contractIds).length === 0) {
  console.warn('Contract IDs not configured. Run `bun run setup` from the repo root.');
}
