import { BattleshipService } from '../src/games/battleship/battleshipService';
import { readEnvFile } from '../../scripts/utils/env';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import { keccak_256 } from 'js-sha3';
import { Buffer } from 'buffer';

const env = await readEnvFile('../.env');

const contractId = env.VITE_BATTLESHIP_CONTRACT_ID;
const player1 = env.VITE_DEV_PLAYER1_ADDRESS;
const player2 = env.VITE_DEV_PLAYER2_ADDRESS;
const player1Secret = env.VITE_DEV_PLAYER1_SECRET;
const player2Secret = env.VITE_DEV_PLAYER2_SECRET;
const networkPassphrase = env.VITE_NETWORK_PASSPHRASE;
const proverUrl = env.VITE_NOIR_PROVER_URL || 'http://127.0.0.1:8787';

if (!contractId || !player1 || !player2 || !player1Secret || !player2Secret || !networkPassphrase) {
  throw new Error('Missing required env values in ../.env');
}

const service = new BattleshipService(contractId);

const signerFor = (secret: string, address: string) => ({
  signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
    const tx = TransactionBuilder.fromXDR(txXdr, opts?.networkPassphrase || networkPassphrase);
    tx.sign(Keypair.fromSecret(secret));
    return { signedTxXdr: tx.toXDR(), signerAddress: address };
  },
  signAuthEntry: async (preimageXdr: string) => {
    const payloadHash = hash(Buffer.from(preimageXdr, 'base64'));
    const signatureBytes = Keypair.fromSecret(secret).sign(payloadHash);
    return { signedAuthEntry: Buffer.from(signatureBytes).toString('base64'), signerAddress: address };
  },
});

const signer1 = signerFor(player1Secret, player1);
const signer2 = signerFor(player2Secret, player2);

const toU32Bytes = (value: number) => Buffer.from([
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]);

function makeBoard(singleShipIndex: number) {
  const salts = Array.from({ length: 100 }, () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))));
  const commitments = Array.from({ length: 100 }, (_, index) => {
    const isShip = index === singleShipIndex;
    const payload = Buffer.concat([Buffer.from([isShip ? 1 : 0]), salts[index]]);
    return Buffer.from(keccak_256.arrayBuffer(payload));
  });
  const commitmentRoot = Buffer.from(keccak_256.arrayBuffer(Buffer.concat(commitments)));
  return { salts, commitments, commitmentRoot };
}

async function requestBoardProof(sessionId: number, shipCells: number, commitmentRootHex: string) {
  const response = await fetch(`${proverUrl}/board-proof`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, shipCells, commitmentRootHex }),
  });
  if (!response.ok) throw new Error(`board-proof failed: ${response.status}`);
  return await response.json() as { proofHashHex: string; signatureHex: string; zkProofHex?: string };
}

async function requestAttackProof(
  sessionId: number,
  x: number,
  y: number,
  isShip: boolean,
  proofHashHex: string,
  expectedCommitmentHex?: string,
) {
  const response = await fetch(`${proverUrl}/attack-proof`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, x, y, isShip, proofHashHex, expectedCommitmentHex }),
  });
  if (!response.ok) throw new Error(`attack-proof failed: ${response.status}`);
  return await response.json() as { signatureHex: string; zkProofHex?: string };
}

const sessionId = (Math.floor(Date.now() / 1000) % 1_000_000_000) + 3;

const player1Board = makeBoard(99);
const player2Board = makeBoard(0);

const player1SignedAuthEntryXdr = await service.prepareStartGame(sessionId, player1, player2, 0n, 0n, signer1);
const fullySignedTxXdr = await service.importAndSignAuthEntry(player1SignedAuthEntryXdr, player2, 0n, signer2);
await service.finalizeStartGame(fullySignedTxXdr, player2, signer2);

const boardProof1 = await requestBoardProof(sessionId, 1, player1Board.commitmentRoot.toString('hex'));
const boardProof2 = await requestBoardProof(sessionId, 1, player2Board.commitmentRoot.toString('hex'));
const zkVerifier = await service.getZkVerifierContract();
const strictZkMode = Boolean(zkVerifier);

if (strictZkMode) {
  const proof1Hex = boardProof1.zkProofHex || boardProof1.proofHashHex;
  const proof2Hex = boardProof2.zkProofHex || boardProof2.proofHashHex;

  await service.commitBoardZk(
    sessionId,
    player1,
    player1Board.commitments,
    1,
    Buffer.from(proof1Hex, 'hex'),
    signer1,
  );

  await service.commitBoardZk(
    sessionId,
    player2,
    player2Board.commitments,
    1,
    Buffer.from(proof2Hex, 'hex'),
    signer2,
  );
} else {
  await service.commitBoard(
    sessionId,
    player1,
    player1Board.commitments,
    1,
    Buffer.from(boardProof1.proofHashHex, 'hex'),
    Buffer.from(boardProof1.signatureHex, 'hex'),
    signer1,
  );

  await service.commitBoard(
    sessionId,
    player2,
    player2Board.commitments,
    1,
    Buffer.from(boardProof2.proofHashHex, 'hex'),
    Buffer.from(boardProof2.signatureHex, 'hex'),
    signer2,
  );
}

await service.submitAttack(sessionId, player1, 0, 0, signer1);

const salt = player2Board.salts[0];
const proofPayload = Buffer.concat([Buffer.from([1]), salt, toU32Bytes(0), toU32Bytes(0)]);
const proofHash = Buffer.from(keccak_256.arrayBuffer(proofPayload));
const expectedCommitmentHex = player2Board.commitments[0].toString('hex');
const attackProof = await requestAttackProof(
  sessionId,
  0,
  0,
  true,
  proofHash.toString('hex'),
  expectedCommitmentHex,
);
if (strictZkMode) {
  const attackZkHex = attackProof.zkProofHex || proofHash.toString('hex');
  await service.resolveAttackZk(
    sessionId,
    player2,
    Buffer.from(attackZkHex, 'hex'),
    signer2,
  );
} else {
  await service.resolveAttack(
    sessionId,
    player2,
    true,
    salt,
    proofHash,
    Buffer.from(attackProof.signatureHex, 'hex'),
    signer2,
  );
}

const game = await service.getGame(sessionId);

console.log(JSON.stringify({
  sessionId,
  created: Boolean(game),
  player1Hits: game?.player1_hits,
  player2Hits: game?.player2_hits,
  pendingAttacker: game?.pending_attacker,
  turn: game?.turn,
}, null, 2));
