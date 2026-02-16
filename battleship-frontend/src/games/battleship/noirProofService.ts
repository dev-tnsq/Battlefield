import { Buffer } from 'buffer';

const PROVER_URL = import.meta.env.VITE_NOIR_PROVER_URL || '';

interface BoardProofRequest {
  sessionId: number;
  shipCells: number;
  commitmentRootHex: string;
}

interface AttackProofRequest {
  sessionId: number;
  x: number;
  y: number;
  isShip: boolean;
  proofHashHex: string;
  expectedCommitmentHex?: string;
}

interface ProverResponse {
  proofHashHex: string;
  signatureHex: string;
  zkProofHex?: string;
}

function fromHex(hex: string): Buffer {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(normalized, 'hex');
}

async function callProver(path: string, payload: unknown): Promise<ProverResponse | null> {
  if (!PROVER_URL) return null;

  const response = await fetch(`${PROVER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Prover request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as ProverResponse;
}

export async function requestBoardCommitmentAttestation(payload: BoardProofRequest): Promise<{ proofHash: Buffer; signature: Buffer } | null> {
  const result = await callProver('/board-proof', payload);
  if (!result) return null;

  return {
    proofHash: fromHex(result.proofHashHex),
    signature: fromHex(result.signatureHex),
  };
}

export async function requestBoardZkProof(payload: BoardProofRequest): Promise<{ proof: Buffer } | null> {
  const result = await callProver('/board-proof', payload);
  if (!result) return null;

  const proofHex = result.zkProofHex || result.proofHashHex;
  return {
    proof: fromHex(proofHex),
  };
}

export async function requestAttackResolutionAttestation(payload: AttackProofRequest): Promise<{ signature: Buffer } | null> {
  const result = await callProver('/attack-proof', payload);
  if (!result) return null;

  return {
    signature: fromHex(result.signatureHex),
  };
}

export async function requestAttackZkProof(payload: AttackProofRequest): Promise<{ proof: Buffer } | null> {
  const result = await callProver('/attack-proof', payload);
  if (!result) return null;

  const proofHex = result.zkProofHex || result.proofHashHex;
  return {
    proof: fromHex(proofHex),
  };
}

export function isNoirProverConfigured() {
  return Boolean(PROVER_URL);
}
