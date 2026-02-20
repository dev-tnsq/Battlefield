#!/usr/bin/env bun

import { Keypair, hash } from '@stellar/stellar-sdk';
import { readEnvFile, getEnvValue } from './utils/env';

function appendU32BE(bytes: number[], value: number) {
  bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function fromHex(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

function toHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex');
}

function keccak256Bytes(parts: Uint8Array[]) {
  const merged = Buffer.concat(parts.map((v) => Buffer.from(v)));
  return new Uint8Array(hash(merged));
}

const env = await readEnvFile('.env');
const proverSecret = process.env.NOIR_PROVER_SECRET || getEnvValue(env, 'NOIR_PROVER_SECRET');
if (!proverSecret) {
  console.error('❌ NOIR_PROVER_SECRET is missing (set Render env var or .env). Run: bun run prover:init');
  process.exit(1);
}

const keypair = Keypair.fromSecret(proverSecret);
const verifierPubKeyHex = Buffer.from(keypair.rawPublicKey()).toString('hex');
const port = Number(process.env.NOIR_PROVER_PORT || getEnvValue(env, 'NOIR_PROVER_PORT', '8787'));

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonCors(data: unknown, init?: ResponseInit) {
  return withCors(Response.json(data, init));
}

Bun.serve({
  port,
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (pathname === '/health' && req.method === 'GET') {
      return jsonCors({ ok: true });
    }

    if (pathname === '/verifier' && req.method === 'GET') {
      return jsonCors({ verifierPubKeyHex, signerAddress: keypair.publicKey() });
    }

    if (pathname === '/board-proof' && req.method === 'POST') {
      try {
        const body = await req.json() as {
          sessionId: number;
          shipCells: number;
          commitmentRootHex: string;
        };

        const commitmentRoot = fromHex(body.commitmentRootHex);
        if (commitmentRoot.length !== 32) {
          return new Response('Invalid commitmentRootHex length', { status: 400 });
        }

        const proofHash = keccak256Bytes([
          Uint8Array.of(0x42),
          commitmentRoot,
        ]);

        const messageBytes: number[] = [1];
        appendU32BE(messageBytes, body.sessionId >>> 0);
        appendU32BE(messageBytes, body.shipCells >>> 0);
        messageBytes.push(...commitmentRoot);

        const signature = keypair.sign(Buffer.from(messageBytes));

        return jsonCors({
          proofHashHex: toHex(proofHash),
          signatureHex: toHex(signature),
          zkProofHex: toHex(signature),
        });
      } catch (err) {
        return withCors(new Response(err instanceof Error ? err.message : 'Invalid request', { status: 400 }));
      }
    }

    if (pathname === '/attack-proof' && req.method === 'POST') {
      try {
        const body = await req.json() as {
          sessionId: number;
          x: number;
          y: number;
          isShip: boolean;
          proofHashHex: string;
          expectedCommitmentHex?: string;
        };

        const proofHash = fromHex(body.proofHashHex);
        if (proofHash.length !== 32) {
          return new Response('Invalid proofHashHex length', { status: 400 });
        }

        if (!body.expectedCommitmentHex) {
          return new Response('Missing expectedCommitmentHex', { status: 400 });
        }

        const expectedCommitment = fromHex(body.expectedCommitmentHex);
        if (expectedCommitment.length !== 32) {
          return new Response('Invalid expectedCommitmentHex length', { status: 400 });
        }

        const messageBytes: number[] = [2];
        appendU32BE(messageBytes, body.sessionId >>> 0);
        appendU32BE(messageBytes, body.x >>> 0);
        appendU32BE(messageBytes, body.y >>> 0);
        messageBytes.push(...expectedCommitment);
        const hitFlag = body.isShip ? 1 : 0;
        messageBytes.push(hitFlag);

        const signature = keypair.sign(Buffer.from(messageBytes));
        const zkProofBytes = new Uint8Array(65);
        zkProofBytes[0] = hitFlag;
        zkProofBytes.set(signature, 1);

        return jsonCors({
          proofHashHex: toHex(proofHash),
          signatureHex: toHex(signature),
          zkProofHex: toHex(zkProofBytes),
        });
      } catch (err) {
        return withCors(new Response(err instanceof Error ? err.message : 'Invalid request', { status: 400 }));
      }
    }

    return withCors(new Response('Not Found', { status: 404 }));
  },
});

console.log(`🧠 Noir prover listening at http://127.0.0.1:${port}`);
console.log(`🔐 Verifier pubkey (hex): ${verifierPubKeyHex}`);
