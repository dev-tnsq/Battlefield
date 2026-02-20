import React, { useEffect, useMemo, useRef, useState } from 'react';
import './classic.css';
import { Buffer } from 'buffer';
import { keccak_256 } from 'js-sha3';
import { WalletSwitcher } from '@/components/WalletSwitcher';
import { useWallet } from '@/hooks/useWallet';
import { config } from '@/config';
import { BattleshipService } from './battleshipService';
import type { Game as ContractGame } from './bindings';
import {
  isNoirProverConfigured,
  requestAttackResolutionAttestation,
  requestBoardCommitmentAttestation,
  requestAttackZkProof,
  requestBoardZkProof,
} from './noirProofService';
import {
  createSessionKeySigner,
  createSessionKeySignerFromSecret,
  ensureSessionSignerAccountReady,
  type SessionKeySigner,
} from './sessionKeySigner';

const BOARD_SIZE = 10;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

type FleetPreset = 'classic' | 'compact' | 'heavy';

const FLEET_PRESETS: Record<FleetPreset, { label: string; ships: { id: string; label: string; size: number }[] }> = {
  classic: {
    label: 'Classic (5 ships)',
    ships: [
      { id: 'carrier', label: 'Carrier', size: 5 },
      { id: 'battleship', label: 'Battleship', size: 4 },
      { id: 'cruiser', label: 'Cruiser', size: 3 },
      { id: 'submarine', label: 'Submarine', size: 3 },
      { id: 'destroyer', label: 'Destroyer', size: 2 },
    ],
  },
  compact: {
    label: 'Compact (3 ships)',
    ships: [
      { id: 'longbow', label: 'Longbow', size: 4 },
      { id: 'sloop', label: 'Sloop', size: 3 },
      { id: 'cutter', label: 'Cutter', size: 2 },
    ],
  },
  heavy: {
    label: 'Heavy (6 ships)',
    ships: [
      { id: 'carrier', label: 'Carrier', size: 5 },
      { id: 'battleship', label: 'Battleship', size: 4 },
      { id: 'cruiser', label: 'Cruiser', size: 3 },
      { id: 'submarine', label: 'Submarine', size: 3 },
      { id: 'destroyer', label: 'Destroyer', size: 2 },
      { id: 'patrol', label: 'Patrol', size: 2 },
    ],
  },
};

type Axis = 'h' | 'v';

interface ShipPlacement {
  id: string;
  label: string;
  size: number;
  x: number | null;
  y: number | null;
  axis: Axis;
}

interface PlacedShip {
  id: string;
  label: string;
  size: number;
  x: number;
  y: number;
  axis: Axis;
}

type Screen = 'home' | 'setup' | 'placement' | 'battle';
type Mode = 'solo' | 'invite' | 'join';
type ThemeMode = 'green' | 'blue' | 'violet';
type Difficulty = 'easy' | 'normal' | 'hard';
type MatchType = 'free' | 'wager';
type BoardScale = 'compact' | 'standard' | 'large';

interface InvitePayload {
  version: 1;
  mode: 'invite';
  sessionId: number;
  preset: FleetPreset;
  theme: ThemeMode;
  difficulty: Difficulty;
  matchType: MatchType;
  boardScale: BoardScale;
  player1Points: string;
  player2Points: string;
  player2Address: string;
  player1Address?: string;
  contractId?: string;
  signedAuthEntryXdr?: string;
}

interface LocalCellSecret {
  salt: Buffer;
  isShip: boolean;
}

interface PersistedCellSecret {
  saltBase64: string;
  isShip: boolean;
}

interface PersistedBattleState {
  version: 1;
  contractId: string;
  owner: string;
  mode: Mode;
  screen: Screen;
  onChainEnabled: boolean;
  sessionId: number;
  fleetPreset: FleetPreset;
  theme: ThemeMode;
  difficulty: Difficulty;
  matchType: MatchType;
  boardScale: BoardScale;
  player1Points: string;
  player2Points: string;
  player2Address: string;
  ships: ShipPlacement[];
  boardCommitted: boolean;
  boardSecrets: PersistedCellSecret[] | null;
  sessionSignerSecret: string | null;
}

const AUTO_JOIN_CONNECT_WALLET_STATUS = 'Connect your wallet to auto-join this invite.';
const BATTLE_PERSIST_KEY = 'battleship:onchain:active:v1';
const START_STEP_DELAY_MS = 800;
const STAKE_POLL_INTERVAL_MS = 2500;
const STAKE_WAIT_TIMEOUT_MS = 60000;
const STROOPS_PER_XLM = 10_000_000n;
const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const PUBLIC_HORIZON_URL = 'https://horizon.stellar.org';

const SCREEN_ROUTE: Record<Screen, string> = {
  home: '/battleship',
  setup: '/battleship/setup',
  placement: '/battleship/placement',
  battle: '/battleship/battle',
};

function screenFromRoute(route: string): Screen {
  if (route.endsWith('/setup')) return 'setup';
  if (/\/placement(\/\d+)?$/.test(route)) return 'placement';
  if (/\/battle(\/\d+)?$/.test(route)) return 'battle';
  return 'home';
}

function getRouteStateFromHash(): { screen: Screen; sessionId?: number } {
  if (typeof window === 'undefined') return { screen: 'home' };
  const hash = window.location.hash || '';
  if (!hash.startsWith('#')) return { screen: 'home' };
  const route = hash.slice(1) || '/battleship';
  const sessionMatch = route.match(/\/(placement|battle)\/(\d+)$/);
  const parsedSessionId = sessionMatch ? Number(sessionMatch[2]) : undefined;
  return {
    screen: screenFromRoute(route),
    sessionId: Number.isFinite(parsedSessionId) ? parsedSessionId : undefined,
  };
}

function hashForScreen(screen: Screen, sessionId?: number, includeSessionInPath = false): string {
  if (includeSessionInPath && (screen === 'placement' || screen === 'battle') && typeof sessionId === 'number') {
    return `#${SCREEN_ROUTE[screen]}/${sessionId}`;
  }
  return `#${SCREEN_ROUTE[screen]}`;
}

export function BattleshipGame() {
  const autoJoinAttemptedRef = useRef(false);
  const autoResolveInFlightRef = useRef(false);
  const rehydratedRef = useRef(false);
  const [fleetPreset, setFleetPreset] = useState<FleetPreset>('classic');
  const [fleetBlueprint, setFleetBlueprint] = useState(FLEET_PRESETS.classic.ships);
  const [screen, setScreen] = useState<Screen>(() => getRouteStateFromHash().screen);
  const [mode, setMode] = useState<Mode>('solo');
  const [theme, setTheme] = useState<ThemeMode>('green');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [matchType, setMatchType] = useState<MatchType>('free');
  const [boardScale, setBoardScale] = useState<BoardScale>('standard');
  const [sessionId, setSessionId] = useState<number>(() => {
    const routeSession = getRouteStateFromHash().sessionId;
    return typeof routeSession === 'number' ? routeSession : Math.floor(Math.random() * 1_000_000_000);
  });
  const [player2Address, setPlayer2Address] = useState('');
  const [player1Points, setPlayer1Points] = useState('0.1');
  const [player2Points, setPlayer2Points] = useState('0.1');
  const [importXdr, setImportXdr] = useState('');
  const [inviteXdr, setInviteXdr] = useState('');
  const [loadedInvitePayload, setLoadedInvitePayload] = useState<InvitePayload | null>(null);
  const [onChainEnabled, setOnChainEnabled] = useState(false);
  const [isSyncingChain, setIsSyncingChain] = useState(false);
  const [chainStatus, setChainStatus] = useState<string | null>(null);
  const [onChainGame, setOnChainGame] = useState<ContractGame | null>(null);
  const [zkVerifierContract, setZkVerifierContract] = useState<string | undefined>(undefined);
  const [betTokenContract, setBetTokenContract] = useState<string | undefined>(undefined);
  const [boardSecrets, setBoardSecrets] = useState<LocalCellSecret[] | null>(null);
  const [boardCommitted, setBoardCommitted] = useState(false);
  const [sessionSigner, setSessionSigner] = useState<SessionKeySigner | null>(null);
  const [isAutoJoiningInvite, setIsAutoJoiningInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [isRewardClaiming, setIsRewardClaiming] = useState(false);
  const [lastRewardClaimText, setLastRewardClaimText] = useState<string | null>(null);

  const { publicKey, isConnected, getContractSigner } = useWallet();
  const battleshipService = useMemo(() => {
    if (!config.battleshipId) return null;
    return new BattleshipService(config.battleshipId);
  }, []);

  const [ships, setShips] = useState<ShipPlacement[]>(() =>
    fleetBlueprint.map((s) => ({ ...s, x: null, y: null, axis: 'h' as Axis })),
  );

  const [enemyFleet, setEnemyFleet] = useState<PlacedShip[]>([]);

  const [hitsPlayer, setHitsPlayer] = useState<Set<string>>(new Set());
  const [enemyShots, setEnemyShots] = useState<Set<string>>(new Set());
  const [enemyHits, setEnemyHits] = useState<Set<string>>(new Set());
  const [shotsEnemy, setShotsEnemy] = useState<Set<string>>(new Set());
  const [enemyTargets, setEnemyTargets] = useState<string[]>([]);

  function serializeBoardSecrets(value: LocalCellSecret[] | null): PersistedCellSecret[] | null {
    if (!value) return null;
    return value.map((cell) => ({
      saltBase64: Buffer.from(cell.salt).toString('base64'),
      isShip: cell.isShip,
    }));
  }

  function deserializeBoardSecrets(value: PersistedCellSecret[] | null | undefined): LocalCellSecret[] | null {
    if (!value) return null;
    return value.map((cell) => ({
      salt: Buffer.from(cell.saltBase64, 'base64'),
      isShip: cell.isShip,
    }));
  }

  function clearPersistedBattleState() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(BATTLE_PERSIST_KEY);
  }

  const boardMask = useMemo(() => {
    const mask = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    ships.forEach((ship) => {
      if (ship.x === null || ship.y === null) return;
      for (let i = 0; i < ship.size; i += 1) {
        const dx = ship.axis === 'h' ? i : 0;
        const dy = ship.axis === 'v' ? i : 0;
        const x = ship.x + dx;
        const y = ship.y + dy;
        if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
          mask[y][x] = true;
        }
      }
    });
    return mask;
  }, [ships]);

  const playerFleetPlaced = useMemo<PlacedShip[]>(() => {
    return ships
      .filter((s) => s.x !== null && s.y !== null)
      .map((s) => ({ id: s.id, label: s.label, size: s.size, x: s.x as number, y: s.y as number, axis: s.axis }));
  }, [ships]);

  function changePreset(preset: FleetPreset) {
    setFleetPreset(preset);
    const blueprint = FLEET_PRESETS[preset].ships;
    setFleetBlueprint(blueprint);
    resetPlacement(blueprint);
    setEnemyFleet([]);
  }

  function resetPlacement(blueprint = fleetBlueprint) {
    setShips(blueprint.map((s) => ({ ...s, x: null, y: null, axis: 'h' as Axis })));
    setError(null);
    setSuccess(null);
  }

  function withinBounds(x: number, y: number, size: number, axis: Axis) {
    if (axis === 'h') return x >= 0 && x + size <= BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
    return y >= 0 && y + size <= BOARD_SIZE && x >= 0 && x < BOARD_SIZE;
  }

  function collides(shipId: string, x: number, y: number, size: number, axis: Axis) {
    const occupied = new Set<string>();
    ships.forEach((ship) => {
      if (ship.id === shipId) return;
      if (ship.x === null || ship.y === null) return;
      for (let i = -1; i <= ship.size; i += 1) {
        const dx = ship.axis === 'h' ? i : 0;
        const dy = ship.axis === 'v' ? i : 0;
        const cx = ship.x + dx;
        const cy = ship.y + dy;
        occupied.add(`${cx},${cy}`);
      }
      for (let i = -1; i <= 1; i += 1) {
        const sideX = ship.axis === 'h' ? ship.x - 1 : ship.x + i;
        const sideY = ship.axis === 'v' ? ship.y - 1 : ship.y + i;
        occupied.add(`${sideX},${sideY}`);
        const endX = ship.axis === 'h' ? ship.x + ship.size : ship.x + i;
        const endY = ship.axis === 'v' ? ship.y + ship.size : ship.y + i;
        occupied.add(`${endX},${endY}`);
      }
    });

    for (let i = 0; i < size; i += 1) {
      const dx = axis === 'h' ? i : 0;
      const dy = axis === 'v' ? i : 0;
      const key = `${x + dx},${y + dy}`;
      if (occupied.has(key)) return true;
    }
    return false;
  }

  function collidesList(list: PlacedShip[], x: number, y: number, size: number, axis: Axis) {
    const occupied = new Set<string>();
    list.forEach((ship) => {
      for (let i = -1; i <= ship.size; i += 1) {
        const dx = ship.axis === 'h' ? i : 0;
        const dy = ship.axis === 'v' ? i : 0;
        const cx = ship.x + dx;
        const cy = ship.y + dy;
        occupied.add(`${cx},${cy}`);
      }
      for (let i = -1; i <= 1; i += 1) {
        const sideX = ship.axis === 'h' ? ship.x - 1 : ship.x + i;
        const sideY = ship.axis === 'v' ? ship.y - 1 : ship.y + i;
        occupied.add(`${sideX},${sideY}`);
        const endX = ship.axis === 'h' ? ship.x + ship.size : ship.x + i;
        const endY = ship.axis === 'v' ? ship.y + ship.size : ship.y + i;
        occupied.add(`${endX},${endY}`);
      }
    });

    for (let i = 0; i < size; i += 1) {
      const dx = axis === 'h' ? i : 0;
      const dy = axis === 'v' ? i : 0;
      const key = `${x + dx},${y + dy}`;
      if (occupied.has(key)) return true;
    }
    return false;
  }

  function placeShip(shipId: string, x: number, y: number, axis: Axis) {
    const ship = ships.find((s) => s.id === shipId);
    if (!ship) return;
    if (!withinBounds(x, y, ship.size, axis)) {
      setError('Ship out of bounds.');
      return;
    }
    if (collides(shipId, x, y, ship.size, axis)) {
      setError('Ships must not touch.');
      return;
    }
    setError(null);
    setShips((prev) => prev.map((s) => (s.id === shipId ? { ...s, x, y, axis } : s)));
  }

  function rotateShip(shipId: string) {
    const ship = ships.find((s) => s.id === shipId);
    if (!ship || ship.x === null || ship.y === null) return;
    const nextAxis: Axis = ship.axis === 'h' ? 'v' : 'h';
    placeShip(shipId, ship.x, ship.y, nextAxis);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, shipId: string) {
    e.preventDefault();
    const target = e.currentTarget;
    const cellX = Number(target.dataset.x);
    const cellY = Number(target.dataset.y);
    const offset = Number(e.dataTransfer.getData('offset')) || 0;
    const axis = (e.dataTransfer.getData('axis') as Axis) || 'h';
    const x = axis === 'h' ? cellX - offset : cellX;
    const y = axis === 'v' ? cellY - offset : cellY;
    placeShip(shipId, x, y, axis);
  }

  function handleCellDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const shipId = e.dataTransfer.getData('shipId');
    if (!shipId) return;
    handleDrop(e, shipId);
  }

  function handleDragStart(
    e: React.DragEvent<HTMLDivElement>,
    shipId: string,
    axis: Axis,
    segmentIndex: number,
  ) {
    e.dataTransfer.setData('shipId', shipId);
    e.dataTransfer.setData('axis', axis);
    e.dataTransfer.setData('offset', String(segmentIndex));
    e.dataTransfer.effectAllowed = 'move';
  }

  function allPlaced() {
    return ships.every((s) => s.x !== null && s.y !== null);
  }

  function randomizeFleet(blueprint = fleetBlueprint) {
    const placed: PlacedShip[] = [];
    for (const ship of blueprint) {
      let placedShip: PlacedShip | null = null;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const axis: Axis = Math.random() > 0.5 ? 'h' : 'v';
        const maxX = axis === 'h' ? BOARD_SIZE - ship.size : BOARD_SIZE - 1;
        const maxY = axis === 'v' ? BOARD_SIZE - ship.size : BOARD_SIZE - 1;
        const x = Math.floor(Math.random() * (maxX + 1));
        const y = Math.floor(Math.random() * (maxY + 1));
        if (collidesList(placed, x, y, ship.size, axis)) continue;
        placedShip = { ...ship, x, y, axis };
        break;
      }
      if (!placedShip) {
        return null;
      }
      placed.push(placedShip);
    }
    return placed;
  }

  function resetCombatState() {
    setEnemyFleet([]);
    setHitsPlayer(new Set());
    setEnemyShots(new Set());
    setEnemyHits(new Set());
    setShotsEnemy(new Set());
    setEnemyTargets([]);
    setOnChainGame(null);
    setBoardCommitted(false);
    setBoardSecrets(null);
    setSessionSigner(null);
  }

  function isOnChainMultiplayerMode() {
    return onChainEnabled && mode !== 'solo';
  }

  function toBoardIndex(x: number, y: number) {
    return y * BOARD_SIZE + x;
  }

  function fromBoardIndex(index: number) {
    return { x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) };
  }

  function buildBoardSecretsFromShips() {
    const occupied = Array.from({ length: CELL_COUNT }, () => false);
    playerFleetPlaced.forEach((ship) => {
      for (let offset = 0; offset < ship.size; offset += 1) {
        const x = ship.x + (ship.axis === 'h' ? offset : 0);
        const y = ship.y + (ship.axis === 'v' ? offset : 0);
        occupied[toBoardIndex(x, y)] = true;
      }
    });

    const secrets: LocalCellSecret[] = occupied.map((isShip) => {
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      return {
        salt: Buffer.from(salt),
        isShip,
      };
    });

    const commitments = secrets.map((cell) => {
      const payload = new Uint8Array(33);
      payload[0] = cell.isShip ? 1 : 0;
      payload.set(cell.salt, 1);
      return Buffer.from(keccak_256.arrayBuffer(payload));
    });

    return { occupied, secrets, commitments };
  }

  function computeCommitmentRoot(commitments: Buffer[]) {
    const packed = Buffer.concat(commitments);
    return Buffer.from(keccak_256.arrayBuffer(packed));
  }

  function toU32Bytes(value: number) {
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
  }

  function optionValue<T>(value: any): T | undefined {
    if (value === null || typeof value === 'undefined') return undefined;
    if (typeof value === 'object' && value && 'tag' in value) {
      if (value.tag === 'Some') return (value.values?.[0] as T);
      return undefined;
    }
    return value as T;
  }

  function syncBoardVisualsFromOnChain(game: ContractGame, myAddress: string, occupiedMap?: boolean[]) {
    const meIsPlayer1 = game.player1 === myAddress;
    const myAttacks = (meIsPlayer1 ? game.player1_attacks : game.player2_attacks).map(Number);
    const myHitAttacks = new Set((meIsPlayer1 ? game.player1_hit_attacks : game.player2_hit_attacks).map(Number));
    const opponentAttacks = (meIsPlayer1 ? game.player2_attacks : game.player1_attacks).map(Number);
    const opponentHitAttacks = new Set((meIsPlayer1 ? game.player2_hit_attacks : game.player1_hit_attacks).map(Number));

    const nextEnemyShots = new Set<string>();
    const nextEnemyHits = new Set<string>();
    myAttacks.forEach((index) => {
      const { x, y } = fromBoardIndex(index);
      const key = `${x},${y}`;
      nextEnemyShots.add(key);
      if (myHitAttacks.has(index)) nextEnemyHits.add(key);
    });

    const nextShotsEnemy = new Set<string>();
    const nextHitsPlayer = new Set<string>();
    opponentAttacks.forEach((index) => {
      const { x, y } = fromBoardIndex(index);
      const key = `${x},${y}`;
      nextShotsEnemy.add(key);
      const wasHit = opponentHitAttacks.has(index) || Boolean(occupiedMap?.[index]);
      if (wasHit) nextHitsPlayer.add(key);
    });

    setEnemyShots(nextEnemyShots);
    setEnemyHits(nextEnemyHits);
    setShotsEnemy(nextShotsEnemy);
    setHitsPlayer(nextHitsPlayer);
  }

  async function refreshOnChainGame(currentPlayer?: string) {
    if (!battleshipService) return null;
    const game = await battleshipService.getGame(sessionId);
    setOnChainGame(game);

    if (game && currentPlayer) {
      const occupiedMap = boardSecrets?.map((entry) => entry.isShip);
      syncBoardVisualsFromOnChain(game, currentPlayer, occupiedMap);
    }
    return game;
  }

  function isNoPendingAttackError(err: unknown) {
    if (!(err instanceof Error)) return false;
    return err.message.includes('NoPendingAttack') || err.message.includes('Contract, #11');
  }

  function isSessionSignerAuthFailure(err: unknown) {
    if (!(err instanceof Error)) return false;
    return err.message.includes('Error(Auth, InvalidAction)')
      || err.message.includes('Error(Value, UnexpectedType)')
      || err.message.includes('failed account authentication')
      || err.message.includes('Account not found');
  }

  function shortAddress(address: string | null | undefined) {
    if (!address) return 'none';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }

  async function resolvePendingAttackIfNeeded(game: ContractGame, myAddress: string) {
    if (!battleshipService || !boardSecrets) return;
    const pendingDefender = optionValue<string>(game.pending_defender);
    const pendingX = optionValue<number>(game.pending_x);
    const pendingY = optionValue<number>(game.pending_y);

    if (pendingDefender !== myAddress || typeof pendingX !== 'number' || typeof pendingY !== 'number') return;

    const index = toBoardIndex(pendingX, pendingY);
    const secret = boardSecrets[index];
    if (!secret) {
      setError('Missing local board secret for pending attack resolution.');
      return;
    }

    if (!sessionSigner) {
      setError('Enable One-Tap Signing to resolve in-game attacks without wallet popups.');
      return;
    }

    const sessionGrant = await battleshipService.getSession(sessionId, myAddress, sessionSigner.publicKey);
    console.info('[one-tap] Pre-resolve session grant check', {
      sessionId,
      defender: shortAddress(myAddress),
      delegate: shortAddress(sessionSigner.publicKey),
      grant: sessionGrant,
    });
    if (!sessionGrant) {
      setSessionSigner(null);
      setError('One-Tap Signing grant not found on-chain. Please enable One-Tap Signing again.');
      setChainStatus('One-tap signing is off.');
      return;
    }

    await ensureSessionSignerAccountReady(sessionSigner.publicKey);

    const proofPayload = Buffer.concat([
      Buffer.from([secret.isShip ? 1 : 0]),
      secret.salt,
      Buffer.from(toU32Bytes(pendingX)),
      Buffer.from(toU32Bytes(pendingY)),
    ]);
    const zkProofHash = Buffer.from(keccak_256.arrayBuffer(proofPayload));
    const expectedCommitment = Buffer.from(keccak_256.arrayBuffer(Buffer.concat([
      Buffer.from([secret.isShip ? 1 : 0]),
      secret.salt,
    ])));

    const zkVerifierConfigured = await battleshipService.getZkVerifierContract();
    const strictZkMode = Boolean(zkVerifierConfigured);

    if (strictZkMode) {
      const zk = await requestAttackZkProof({
        sessionId,
        x: pendingX,
        y: pendingY,
        isShip: secret.isShip,
        proofHashHex: zkProofHash.toString('hex'),
        expectedCommitmentHex: expectedCommitment.toString('hex'),
      });
      if (!zk) {
        setError('ZK verifier is enabled but prover endpoint is not configured. Set VITE_NOIR_PROVER_URL.');
        return;
      }

      try {
        setIsSyncingChain(true);
        setChainStatus('Resolving incoming attack on-chain (zk)...');
        await battleshipService.resolveAttackZk(
          sessionId,
          myAddress,
          zk.proof,
          sessionSigner.signer,
          sessionSigner.publicKey,
        );
        setChainStatus('Incoming attack resolved.');
      } catch (err) {
        if (isNoPendingAttackError(err)) {
          setError(null);
          setChainStatus('Incoming attack was already resolved on-chain.');
        } else if (isSessionSignerAuthFailure(err)) {
          setSessionSigner(null);
          setError('Delegated signer authentication failed. One-Tap Signing was disabled; enable it again to continue without wallet popups.');
          setChainStatus('One-tap signing is off.');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to resolve pending attack.');
        }
      } finally {
        setIsSyncingChain(false);
      }
      return;
    }

    let zkProofSignature: Buffer | undefined = undefined;
    const verifier = await battleshipService.getVerifier();
    const verifierEnabled = Boolean(verifier && verifier.length > 0);

    if (verifierEnabled) {
      const attestation = await requestAttackResolutionAttestation({
        sessionId,
        x: pendingX,
        y: pendingY,
        isShip: secret.isShip,
        proofHashHex: zkProofHash.toString('hex'),
      });
      if (!attestation) {
        setError('Noir verifier is enabled but prover endpoint is not configured. Set VITE_NOIR_PROVER_URL.');
        return;
      }
      zkProofSignature = attestation.signature;
    }

    try {
      setIsSyncingChain(true);
      setChainStatus('Resolving incoming attack on-chain...');
      await battleshipService.resolveAttack(
        sessionId,
        myAddress,
        secret.isShip,
        secret.salt,
        zkProofHash,
        zkProofSignature,
        sessionSigner.signer,
        sessionSigner.publicKey,
      );
      setChainStatus('Incoming attack resolved.');
    } catch (err) {
      if (isNoPendingAttackError(err)) {
        setError(null);
        setChainStatus('Incoming attack was already resolved on-chain.');
      } else if (isSessionSignerAuthFailure(err)) {
        setSessionSigner(null);
        setError('Delegated signer authentication failed. One-Tap Signing was disabled; enable it again to continue without wallet popups.');
        setChainStatus('One-tap signing is off.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to resolve pending attack.');
      }
    } finally {
      setIsSyncingChain(false);
    }
  }

  async function enableSessionDelegation() {
    if (!battleshipService || !publicKey) return;

    try {
      setIsSyncingChain(true);
      setChainStatus('Preparing delegated signer account...');
      const nextSessionSigner = createSessionKeySigner();
      const walletSigner = getContractSigner();

      console.info('[one-tap] Enabling delegated signer', {
        sessionId,
        player: shortAddress(publicKey),
        delegate: shortAddress(nextSessionSigner.publicKey),
      });

      await ensureSessionSignerAccountReady(nextSessionSigner.publicKey);

      setChainStatus('Authorizing one-tap turn signing...');

      await battleshipService.authorizeSession(
        sessionId,
        publicKey,
        nextSessionSigner.publicKey,
        7200,
        0,
        walletSigner,
      );

      const grant = await battleshipService.getSession(sessionId, publicKey, nextSessionSigner.publicKey);
      console.info('[one-tap] Session grant after authorize_session', {
        sessionId,
        player: shortAddress(publicKey),
        delegate: shortAddress(nextSessionSigner.publicKey),
        grant,
      });
      if (!grant) {
        throw new Error('Session grant was not found after authorization. Please retry enabling One-Tap Signing.');
      }

      setSessionSigner(nextSessionSigner);
      setError(null);
      setSuccess('One-tap turn signing enabled for this match.');
      setChainStatus('One-tap signing active. Wallet will not open for each turn.');
    } catch (err) {
      if (isSessionSignerAuthFailure(err)) {
        setSessionSigner(null);
      }
      setError(err instanceof Error ? err.message : 'Failed to enable one-tap signing.');
    } finally {
      setIsSyncingChain(false);
    }
  }

  async function revokeSessionDelegation() {
    if (!battleshipService || !publicKey || !sessionSigner) {
      setSessionSigner(null);
      return;
    }

    try {
      setIsSyncingChain(true);
      setChainStatus('Revoking one-tap turn signing...');
      const walletSigner = getContractSigner();
      await battleshipService.revokeSession(sessionId, publicKey, sessionSigner.publicKey, walletSigner);
      setSessionSigner(null);
      setSuccess('One-tap signing revoked.');
      setChainStatus('One-tap signing is off.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke one-tap signing.');
    } finally {
      setIsSyncingChain(false);
    }
  }

  function toBase64Url(value: string) {
    return btoa(encodeURIComponent(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function fromBase64Url(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    return decodeURIComponent(atob(padded));
  }

  function toStroops(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.round(parsed * 10_000_000));
  }

  function toBigIntSafe(value: unknown) {
    try {
      return BigInt(value as bigint | number | string);
    } catch {
      return 0n;
    }
  }

  function formatXlmFromStroops(stroops: bigint) {
    const whole = stroops / STROOPS_PER_XLM;
    const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
    return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  }

  function getHorizonBaseUrl() {
    return config.networkPassphrase === 'Test SDF Network ; September 2015'
      ? TESTNET_HORIZON_URL
      : PUBLIC_HORIZON_URL;
  }

  async function fetchNativeXlmBalance(address: string) {
    const response = await fetch(`${getHorizonBaseUrl()}/accounts/${address}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch wallet balance (${response.status})`);
    }
    const payload = await response.json() as { balances?: Array<{ asset_type?: string; balance?: string }> };
    const native = payload.balances?.find((entry) => entry.asset_type === 'native');
    const parsed = Number(native?.balance || '0');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function claimWinnerReward() {
    if (!battleshipService || !publicKey) return;

    try {
      setIsRewardClaiming(true);
      setError(null);
      setSuccess(null);
      setChainStatus('Checking winner payout on-chain...');

      const [feeBps, beforeBalance] = await Promise.all([
        battleshipService.getFeeBps(),
        fetchNativeXlmBalance(publicKey),
      ]);

      const latest = await refreshOnChainGame(publicKey);
      if (!latest) {
        setError('Could not load latest on-chain match state.');
        return;
      }

      const winner = optionValue<string>(latest.winner);
      if (!winner || winner !== publicKey) {
        setError('Winner is not finalized for your wallet yet. Please wait a moment and retry.');
        return;
      }

      const totalPot = toBigIntSafe(latest.player1_points) + toBigIntSafe(latest.player2_points);
      const fee = totalPot * BigInt(Math.max(0, feeBps)) / 10_000n;
      const expectedPayout = totalPot - fee;

      await new Promise((resolve) => setTimeout(resolve, 1200));
      const afterBalance = await fetchNativeXlmBalance(publicKey);
      const delta = afterBalance - beforeBalance;

      setLastRewardClaimText(`Expected payout: ${formatXlmFromStroops(expectedPayout)} XLM · Wallet delta: ${delta.toFixed(7)} XLM`);
      setSuccess(`Reward checked on-chain. Winner payout for this match is ${formatXlmFromStroops(expectedPayout)} XLM.`);
      setShowRewardModal(false);
      setChainStatus('Winner payout confirmed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check winner reward.');
    } finally {
      setIsRewardClaiming(false);
    }
  }

  async function waitForBothStakesFunded(myAddress: string, seedGame?: ContractGame | null): Promise<ContractGame | null> {
    let currentGame = seedGame || await refreshOnChainGame(myAddress);
    const deadline = Date.now() + STAKE_WAIT_TIMEOUT_MS;

    while (currentGame && !(currentGame.player1_deposited && currentGame.player2_deposited) && Date.now() < deadline) {
      const remainingSec = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      setChainStatus(`Step 2/3: Waiting for opponent stake... (${remainingSec}s)`);
      await new Promise((resolve) => setTimeout(resolve, STAKE_POLL_INTERVAL_MS));
      currentGame = await refreshOnChainGame(myAddress);
    }

    return currentGame;
  }

  async function createInviteLink(forceOnChain = onChainEnabled) {
    if (forceOnChain && !player2Address) {
      setError('Opponent address is required to create an on-chain invite link.');
      return false;
    }

    let signedAuthEntryXdr: string | undefined;
    let player1Address: string | undefined;

    if (forceOnChain) {
      if (!battleshipService || !config.battleshipId) {
        setError('Battleship contract is not configured. Run setup/deploy first.');
        return false;
      }
      if (!isConnected || !publicKey) {
        setError('Connect wallet first to create an on-chain invite.');
        return false;
      }

      try {
        setIsSyncingChain(true);
        setChainStatus('Preparing on-chain start authorization...');
        const signer = getContractSigner();
        signedAuthEntryXdr = await battleshipService.prepareStartGame(
          sessionId,
          publicKey,
          player2Address,
          matchType === 'wager' ? toStroops(player1Points) : 0n,
          matchType === 'wager' ? toStroops(player2Points) : 0n,
          signer,
        );
        player1Address = publicKey;
        setChainStatus('On-chain invite authorization prepared.');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to prepare on-chain invite.';
        setError(message);
        setChainStatus(null);
        return false;
      } finally {
        setIsSyncingChain(false);
      }
    }

    const payload: InvitePayload = {
      version: 1,
      mode: 'invite',
      sessionId,
      preset: fleetPreset,
      theme,
      difficulty,
      matchType,
      boardScale,
      player1Points,
      player2Points,
      player2Address,
      player1Address,
      contractId: config.battleshipId || undefined,
      signedAuthEntryXdr,
    };
    const token = toBase64Url(JSON.stringify(payload));
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const link = `${origin}?invite=${token}`;
    setInviteXdr(link);
    setSuccess('Invite link generated. Share it with your friend.');
    setError(null);
    return true;
  }

  function parseInvitePayload(rawValue: string): InvitePayload | null {
    try {
      const trimmed = rawValue.trim();
      if (!trimmed) return null;
      const token = trimmed.includes('invite=')
        ? new URL(trimmed).searchParams.get('invite') || ''
        : trimmed;
      const parsed = JSON.parse(fromBase64Url(token)) as Partial<InvitePayload>;
      if (
        parsed.version !== 1
        || parsed.mode !== 'invite'
        || !parsed.preset
        || !parsed.theme
        || !parsed.difficulty
        || !parsed.matchType
        || !parsed.boardScale
      ) {
        return null;
      }
      return {
        ...(parsed as InvitePayload),
        sessionId: parsed.sessionId ?? Math.floor(Math.random() * 1_000_000_000),
      };
    } catch {
      return null;
    }
  }

  function loadInviteSettings() {
    const parsed = parseInvitePayload(importXdr);
    if (!parsed) {
      setError('Invalid invite link. Please paste a valid invite URL.');
      setSuccess(null);
      return false;
    }
    setFleetPreset(parsed.preset);
    setFleetBlueprint(FLEET_PRESETS[parsed.preset].ships);
    resetPlacement(FLEET_PRESETS[parsed.preset].ships);
    setTheme(parsed.theme);
    setDifficulty(parsed.difficulty);
    setMatchType(parsed.matchType);
    setBoardScale(parsed.boardScale);
    setPlayer1Points(parsed.player1Points);
    setPlayer2Points(parsed.player2Points);
    setPlayer2Address(parsed.player2Address);
    setSessionId(parsed.sessionId);
    setLoadedInvitePayload(parsed);
    setOnChainEnabled(Boolean(parsed.signedAuthEntryXdr && parsed.contractId));
    setImportXdr('');
    setError(null);
    setSuccess('Invite settings loaded. Continue to place your ships.');
    return parsed;
  }

  function canProceedFromSetup() {
    if (mode !== 'solo' && onChainEnabled && matchType === 'wager' && !betTokenContract) {
      setError('Wager is unavailable: XLM staking is not configured on this Battleship contract. Admin must run prover:set-bet-token.');
      return false;
    }

    if (matchType === 'wager') {
      const mine = Number(player1Points);
      const theirs = Number(player2Points);
      if (!Number.isFinite(mine) || mine <= 0) {
        setError('Enter a valid positive stake for your side.');
        return false;
      }
      if (mode !== 'solo' && (!Number.isFinite(theirs) || theirs <= 0)) {
        setError('Enter a valid positive stake for your opponent.');
        return false;
      }
    }
    if (mode === 'invite' && onChainEnabled && !player2Address) {
      setError('Opponent address is required for on-chain invite mode.');
      return false;
    }
    if (mode === 'join' && !importXdr && !loadedInvitePayload) {
      setError('Paste invite link to join this match.');
      return false;
    }
    return true;
  }

  function hasCurrentInvitePrepared(forceOnChain = onChainEnabled) {
    if (!inviteXdr) return false;
    const parsed = parseInvitePayload(inviteXdr);
    if (!parsed) return false;

    const coreSettingsMatch =
      parsed.sessionId === sessionId
      && parsed.preset === fleetPreset
      && parsed.theme === theme
      && parsed.difficulty === difficulty
      && parsed.matchType === matchType
      && parsed.boardScale === boardScale
      && parsed.player1Points === player1Points
      && parsed.player2Points === player2Points
      && parsed.player2Address === player2Address;

    if (!coreSettingsMatch) return false;

    if (!forceOnChain) return true;

    const contractId = config.battleshipId || undefined;
    return Boolean(
      parsed.signedAuthEntryXdr
      && parsed.player1Address
      && publicKey
      && parsed.player1Address === publicKey
      && parsed.contractId === contractId,
    );
  }

  async function continueFromSetup() {
    setSuccess(null);
    if (!canProceedFromSetup()) return;

    if (mode === 'invite') {
      const inviteReady = hasCurrentInvitePrepared(onChainEnabled);
      if (!inviteReady) {
        const created = await createInviteLink(onChainEnabled);
        if (!created) return;
      } else {
        setSuccess('Using existing invite link. Continuing to ship placement.');
      }
    }

    if (mode === 'join') {
      const loaded = loadedInvitePayload || loadInviteSettings();
      if (!loaded) return;

      if (
        onChainEnabled
        && loaded.contractId
        && config.battleshipId
        && loaded.contractId !== config.battleshipId
      ) {
        setError('Invite was created for a different Battleship contract deployment. Re-run setup/deploy or use a matching frontend env.');
        return;
      }

      if (onChainEnabled && loaded.signedAuthEntryXdr) {
        if (!battleshipService || !config.battleshipId) {
          setError('Battleship contract is not configured.');
          return;
        }
        if (!isConnected || !publicKey) {
          setError('Connect wallet first to join an on-chain invite.');
          return;
        }
        if (loaded.player2Address && loaded.player2Address !== publicKey) {
          setError('This invite is addressed to a different Player 2 wallet. Connect the invited wallet to continue.');
          return;
        }

        try {
          setIsSyncingChain(true);
          setChainStatus('Importing invite authorization and signing as Player 2...');
          const signer = getContractSigner();
          const txXdr = await battleshipService.importAndSignAuthEntry(
            loaded.signedAuthEntryXdr,
            publicKey,
            loaded.matchType === 'wager' ? toStroops(loaded.player2Points) : 0n,
            signer,
          );
          setChainStatus('Submitting start_game transaction on Soroban...');
          await battleshipService.finalizeStartGame(txXdr, publicKey, signer);
          setSuccess('On-chain match created successfully. Continue to ship placement.');
          setChainStatus('On-chain match ready.');
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to start on-chain match.';
          setError(message);
          setChainStatus(null);
          return;
        } finally {
          setIsSyncingChain(false);
        }
      }
    }

    startPlacement(mode);
  }

  function startPlacement(nextMode: Mode) {
    setMode(nextMode);
    resetPlacement();
    resetCombatState();
    setScreen('placement');
  }

  function goToSetup(nextMode: Mode) {
    setMode(nextMode);
    setOnChainEnabled(nextMode !== 'solo');
    if (nextMode === 'join' && !importXdr && typeof window !== 'undefined') {
      const fromUrl = new URL(window.location.href).searchParams.get('invite') || '';
      if (fromUrl) setImportXdr(fromUrl);
    }
    setError(null);
    setSuccess(null);
    setScreen('setup');
  }

  function goHome() {
    clearPersistedBattleState();
    setChainStatus(null);
    setIsSyncingChain(false);
    setError(null);
    setSuccess(null);
    setSessionSigner(null);
    setScreen('home');
  }

  async function startBattle() {
    if (!allPlaced()) {
      setError('Place all ships first.');
      return;
    }

    if (isOnChainMultiplayerMode()) {
      if (!battleshipService) {
        setError('Battleship contract service is not configured.');
        return;
      }
      if (!isConnected || !publicKey) {
        setError('Connect wallet before committing board on-chain.');
        return;
      }

      try {
        setEnemyFleet([]);
        setHitsPlayer(new Set());
        setEnemyShots(new Set());
        setEnemyHits(new Set());
        setShotsEnemy(new Set());
        setIsSyncingChain(true);
        setChainStatus('Step 1/3: Checking on-chain session...');
        const game = await refreshOnChainGame(publicKey);
        if (!game) {
          setError('On-chain session not started yet. Ask the other player to join first.');
          return;
        }

        if (matchType === 'wager') {
          const tokenContract = await battleshipService.getBetToken();
          setBetTokenContract(tokenContract);
          if (!tokenContract) {
            setError('Wager mode requires on-chain XLM staking configuration by admin (run prover:set-bet-token).');
            return;
          }

          const alreadyDeposited = game.player1 === publicKey
            ? game.player1_deposited
            : game.player2 === publicKey
              ? game.player2_deposited
              : false;

          if (!alreadyDeposited) {
            try {
              setChainStatus('Step 1/3: Depositing your stake into on-chain escrow...');
              const signer = getContractSigner();
              await battleshipService.depositStake(sessionId, publicKey, signer);
              await new Promise((resolve) => setTimeout(resolve, START_STEP_DELAY_MS));
            } catch (depositErr) {
              const msg = depositErr instanceof Error ? depositErr.message : 'Stake deposit failed.';
              if (!msg.includes('AlreadyDeposited')) {
                setError(msg);
                return;
              }
            }
          } else {
            setChainStatus('Step 1/3: Stake already deposited. Checking funding state...');
          }

          await new Promise((resolve) => setTimeout(resolve, START_STEP_DELAY_MS));
          const stakeState = await waitForBothStakesFunded(publicKey, game);
          if (!stakeState) {
            setError('Failed to refresh on-chain stake state. Please retry.');
            return;
          }
          const bothDeposited = Boolean(stakeState.player1_deposited && stakeState.player2_deposited);
          if (!bothDeposited) {
            setSuccess('Your stake is deposited. Waiting for opponent stake before commit. Click again when they have deposited.');
            setChainStatus('Step 2/3: Opponent stake still pending.');
            return;
          }
        }

        const { secrets, commitments, occupied } = buildBoardSecretsFromShips();
        setBoardSecrets(secrets);

        const commitmentRoot = computeCommitmentRoot(commitments);
        const signer = getContractSigner();
        const shipCells = occupied.filter(Boolean).length;

        const zkVerifier = await battleshipService.getZkVerifierContract();
        setZkVerifierContract(zkVerifier);

        if (zkVerifier) {
          const zkBoard = await requestBoardZkProof({
            sessionId,
            shipCells,
            commitmentRootHex: commitmentRoot.toString('hex'),
          });
          if (!zkBoard) {
            setError('ZK verifier mode requires prover endpoint configuration (VITE_NOIR_PROVER_URL).');
            return;
          }

          setChainStatus('Step 3/3: Submitting board commitment on-chain (zk)...');
          await battleshipService.commitBoardZk(
            sessionId,
            publicKey,
            commitments,
            shipCells,
            zkBoard.proof,
            signer,
          );
        } else {
          const verifier = await battleshipService.getVerifier();
          const verifierEnabled = Boolean(verifier && verifier.length > 0);
          let boardProofHash: Buffer | undefined;
          let boardProofSignature: Buffer | undefined;

          if (verifierEnabled) {
            const attestation = await requestBoardCommitmentAttestation({
              sessionId,
              shipCells,
              commitmentRootHex: commitmentRoot.toString('hex'),
            });
            if (!attestation) {
              setError('Verifier mode requires prover endpoint configuration (VITE_NOIR_PROVER_URL).');
              return;
            }
            boardProofHash = attestation.proofHash;
            boardProofSignature = attestation.signature;
          }

          setChainStatus('Step 3/3: Submitting board commitment on-chain...');
          await battleshipService.commitBoard(
            sessionId,
            publicKey,
            commitments,
            shipCells,
            boardProofHash,
            boardProofSignature,
            signer,
          );
        }

        setBoardCommitted(true);
        setScreen('battle');
        setSuccess('Board committed on-chain. Battle started.');
        setError(null);
        await new Promise((resolve) => setTimeout(resolve, START_STEP_DELAY_MS));

        const updatedGame = await refreshOnChainGame(publicKey);
        if (updatedGame) {
          await refreshOnChainGame(publicKey);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to commit board on-chain.';
        if (message.includes('BoardAlreadyCommitted')) {
          setBoardCommitted(true);
          setScreen('battle');
          setSuccess('Board already committed on-chain. Entering battle.');
          setError(null);
          await refreshOnChainGame(publicKey);
          return;
        }
        if (message.includes('StakesNotFunded') || message.includes('Error(Contract, #20)')) {
          setError(null);
          setSuccess('Stake deposited. Waiting for opponent to deposit before commit can proceed.');
          setChainStatus('Waiting for opponent to deposit stake...');
          await refreshOnChainGame(publicKey);
          return;
        }
        setError(message);
      } finally {
        setIsSyncingChain(false);
      }
      return;
    }

    const enemy = randomizeFleet();
    if (!enemy) {
      setError('Could not randomize enemy fleet. Try again.');
      return;
    }
    resetCombatState();
    setEnemyFleet(enemy);
    setScreen('battle');
    setSuccess(null);
    setError(null);
  }

  async function fireAtEnemy(x: number, y: number) {
    const key = `${x},${y}`;

    if (isOnChainMultiplayerMode()) {
      if (!battleshipService || !publicKey) return;
      if (enemyShots.has(key)) return;

      const game = onChainGame || await refreshOnChainGame(publicKey);
      if (!game) {
        setError('On-chain game is not available.');
        return;
      }

      const turn = optionValue<string>(game.turn);
      if (turn !== publicKey) {
        setError('Not your turn yet.');
        return;
      }
      const pendingDefender = optionValue<string>(game.pending_defender);
      if (pendingDefender === publicKey) {
        setError('Resolve incoming attack first.');
        return;
      }
      if (optionValue<string>(game.pending_attacker)) {
        setError('Waiting for defender to resolve pending attack.');
        return;
      }

      if (!sessionSigner) {
        setError('Enable One-Tap Signing before firing to avoid wallet popup on every turn.');
        return;
      }

      const sessionGrant = await battleshipService.getSession(sessionId, publicKey, sessionSigner.publicKey);
      console.info('[one-tap] Pre-attack session grant check', {
        sessionId,
        attacker: shortAddress(publicKey),
        delegate: shortAddress(sessionSigner.publicKey),
        grant: sessionGrant,
      });
      if (!sessionGrant) {
        setSessionSigner(null);
        setError('One-Tap Signing grant not found on-chain. Please enable One-Tap Signing again.');
        setChainStatus('One-tap signing is off.');
        return;
      }

      await ensureSessionSignerAccountReady(sessionSigner.publicKey);

      try {
        setIsSyncingChain(true);
        setChainStatus('Submitting attack on-chain...');
        await battleshipService.submitAttack(
          sessionId,
          publicKey,
          x,
          y,
          sessionSigner.signer,
          sessionSigner.publicKey,
        );
        setError(null);
        setSuccess('Attack submitted on-chain. Waiting for resolution.');
        setChainStatus(`Attack submitted at (${x}, ${y}). Waiting for defender resolution...`);
        await refreshOnChainGame(publicKey);
      } catch (err) {
        if (isSessionSignerAuthFailure(err)) {
          setSessionSigner(null);
          setError('Delegated signer authentication failed. One-Tap Signing was disabled; enable it again and retry your move.');
          setChainStatus('One-tap signing is off.');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to submit on-chain attack.');
      } finally {
        setIsSyncingChain(false);
      }
      return;
    }

    if (enemyShots.has(key)) return;
    const nextShots = new Set(enemyShots);
    nextShots.add(key);
    setEnemyShots(nextShots);
    if (enemyMask[y][x]) {
      const nextHits = new Set(enemyHits);
      nextHits.add(key);
      setEnemyHits(nextHits);
    }
  }

  function enemyFires() {
    const turns = difficulty === 'hard' ? 2 : 1;
    const nextShots = new Set(shotsEnemy);
    const nextHits = new Set(hitsPlayer);
    const nextTargets = [...enemyTargets];

    const addTarget = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return;
      const key = `${x},${y}`;
      if (nextShots.has(key) || nextTargets.includes(key)) return;
      nextTargets.push(key);
    };

    for (let turn = 0; turn < turns; turn += 1) {
      let key = '';
      if (difficulty !== 'easy' && nextTargets.length > 0) {
        key = nextTargets.shift() || '';
      }
      if (!key) {
        for (let attempt = 0; attempt < 250; attempt += 1) {
          const x = Math.floor(Math.random() * BOARD_SIZE);
          const y = Math.floor(Math.random() * BOARD_SIZE);
          const candidate = `${x},${y}`;
          if (!nextShots.has(candidate)) {
            key = candidate;
            break;
          }
        }
      }
      if (!key || nextShots.has(key)) break;
      nextShots.add(key);
      const [xStr, yStr] = key.split(',');
      const x = Number(xStr);
      const y = Number(yStr);
      if (boardMask[y][x]) {
        nextHits.add(key);
        if (difficulty !== 'easy') {
          addTarget(x + 1, y);
          addTarget(x - 1, y);
          addTarget(x, y + 1);
          addTarget(x, y - 1);
        }
      }
    }

    setShotsEnemy(nextShots);
    setHitsPlayer(nextHits);
    setEnemyTargets(nextTargets);
  }

  const enemyMask = useMemo(() => {
    const mask = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    enemyFleet.forEach((ship) => {
      for (let i = 0; i < ship.size; i += 1) {
        const dx = ship.axis === 'h' ? i : 0;
        const dy = ship.axis === 'v' ? i : 0;
        const x = ship.x + dx;
        const y = ship.y + dy;
        mask[y][x] = true;
      }
    });
    return mask;
  }, [enemyFleet]);

  const meIsPlayer1 = Boolean(publicKey && onChainGame && onChainGame.player1 === publicKey);
  const enemyShipCells = isOnChainMultiplayerMode()
    ? meIsPlayer1
      ? Number(optionValue<number>(onChainGame?.player2_ship_cells) || 0)
      : Number(optionValue<number>(onChainGame?.player1_ship_cells) || 0)
    : enemyFleet.reduce((acc, s) => acc + s.size, 0);
  const enemyHitsCount = enemyHits.size;
  const playerShipCells = isOnChainMultiplayerMode()
    ? meIsPlayer1
      ? Number(optionValue<number>(onChainGame?.player1_ship_cells) || 0)
      : Number(optionValue<number>(onChainGame?.player2_ship_cells) || 0)
    : playerFleetPlaced.reduce((acc, s) => acc + s.size, 0);
  const playerHitsCount = hitsPlayer.size;
  const onChainWinner = optionValue<string>(onChainGame?.winner);
  const playerDefeated = isOnChainMultiplayerMode()
    ? Boolean(onChainWinner && publicKey && onChainWinner !== publicKey)
    : playerHitsCount >= playerShipCells && playerShipCells > 0;
  const enemyDefeated = isOnChainMultiplayerMode()
    ? Boolean(onChainWinner && publicKey && onChainWinner === publicKey)
    : enemyHitsCount >= enemyShipCells && enemyShipCells > 0;
  const themeClass = `theme-${theme}`;
  const cellSizePx = boardScale === 'compact' ? 34 : boardScale === 'large' ? 48 : 42;
  const shellStyle = { ['--classic-cell-size' as string]: `${cellSizePx}px` } as React.CSSProperties;
  const totalStake = matchType === 'wager' ? Number(player1Points || 0) + Number(player2Points || 0) : 0;
  const onChainTurn = onChainGame ? optionValue<string>(onChainGame.turn) : undefined;
  const onChainPendingAttacker = onChainGame ? optionValue<string>(onChainGame.pending_attacker) : undefined;
  const onChainPendingDefender = onChainGame ? optionValue<string>(onChainGame.pending_defender) : undefined;
  const onChainPendingX = onChainGame ? optionValue<number>(onChainGame.pending_x) : undefined;
  const onChainPendingY = onChainGame ? optionValue<number>(onChainGame.pending_y) : undefined;
  const myOnChainTurn = Boolean(publicKey && onChainTurn === publicKey);
  const onChainPayoutProcessed = Boolean(onChainGame?.payout_processed);
  const onChainPotStroops = toBigIntSafe(onChainGame?.player1_points) + toBigIntSafe(onChainGame?.player2_points);
  const onChainRewardWinner = Boolean(
    isOnChainMultiplayerMode()
    && matchType === 'wager'
    && publicKey
    && onChainWinner
    && onChainWinner === publicKey,
  );
  const myPendingAttackKey =
    isOnChainMultiplayerMode()
    && publicKey
    && onChainPendingAttacker === publicKey
    && typeof onChainPendingX === 'number'
    && typeof onChainPendingY === 'number'
      ? `${onChainPendingX},${onChainPendingY}`
      : null;

  useEffect(() => {
    if (screen !== 'battle') return;
    if (!isOnChainMultiplayerMode()) return;
    if (!battleshipService || !publicKey) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const game = await battleshipService.getGame(sessionId);
        if (!game || cancelled) return;
        setOnChainGame(game);
        const occupiedMap = boardSecrets?.map((entry) => entry.isShip);
        syncBoardVisualsFromOnChain(game, publicKey, occupiedMap);

        const pendingDefender = optionValue<string>(game.pending_defender);
        const pendingX = optionValue<number>(game.pending_x);
        const pendingY = optionValue<number>(game.pending_y);
        const turn = optionValue<string>(game.turn);
        if (pendingDefender === publicKey && typeof pendingX === 'number' && typeof pendingY === 'number') {
          setChainStatus(`Incoming attack at (${pendingX}, ${pendingY}). Auto-resolving...`);
          if (!autoResolveInFlightRef.current) {
            autoResolveInFlightRef.current = true;
            try {
              await resolvePendingAttackIfNeeded(game, publicKey);
              if (!cancelled) {
                await refreshOnChainGame(publicKey);
              }
            } finally {
              autoResolveInFlightRef.current = false;
            }
          }
        } else if (pendingDefender && pendingDefender !== publicKey) {
          setChainStatus('Waiting for defender to resolve pending attack...');
        } else if (turn === publicKey) {
          setChainStatus('Your on-chain turn. Fire on enemy waters.');
        } else {
          setChainStatus('Waiting for opponent turn...');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to sync on-chain game state.');
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [screen, onChainEnabled, mode, battleshipService, publicKey, sessionId, boardSecrets, sessionSigner]);

  useEffect(() => {
    if (!onChainRewardWinner) return;
    if (screen !== 'battle') return;
    setShowRewardModal(true);
  }, [onChainRewardWinner, screen]);

  useEffect(() => {
    if (!onChainEnabled || mode === 'solo' || !battleshipService) {
      setZkVerifierContract(undefined);
      setBetTokenContract(undefined);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const [configuredVerifier, configuredBetToken] = await Promise.all([
        battleshipService.getZkVerifierContract(),
        battleshipService.getBetToken(),
      ]);
      if (!cancelled) {
        setZkVerifierContract(configuredVerifier);
        setBetTokenContract(configuredBetToken);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [onChainEnabled, mode, battleshipService]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (rehydratedRef.current) return;
    if (!publicKey || !config.battleshipId) return;

    const inviteToken = new URL(window.location.href).searchParams.get('invite') || '';
    if (inviteToken) {
      rehydratedRef.current = true;
      return;
    }

    const raw = window.localStorage.getItem(BATTLE_PERSIST_KEY);
    if (!raw) {
      rehydratedRef.current = true;
      return;
    }

    try {
      const saved = JSON.parse(raw) as PersistedBattleState;
      if (saved.version !== 1 || saved.contractId !== config.battleshipId || saved.owner !== publicKey) {
        rehydratedRef.current = true;
        return;
      }

      setMode(saved.mode);
      setOnChainEnabled(saved.onChainEnabled);
      setSessionId(saved.sessionId);
      setFleetPreset(saved.fleetPreset);
      setFleetBlueprint(FLEET_PRESETS[saved.fleetPreset].ships);
      setTheme(saved.theme);
      setDifficulty(saved.difficulty);
      setMatchType(saved.matchType);
      setBoardScale(saved.boardScale);
      setPlayer1Points(saved.player1Points);
      setPlayer2Points(saved.player2Points);
      setPlayer2Address(saved.player2Address);
      setShips(saved.ships);
      setBoardCommitted(saved.boardCommitted);
      setBoardSecrets(deserializeBoardSecrets(saved.boardSecrets));

      if (saved.sessionSignerSecret) {
        try {
          setSessionSigner(createSessionKeySignerFromSecret(saved.sessionSignerSecret));
        } catch {
          setSessionSigner(null);
        }
      }

      if (saved.screen === 'battle' || saved.screen === 'placement' || saved.screen === 'setup') {
        setScreen(saved.screen);
        setSuccess('Restored your active on-chain match after reload.');
      }
    } catch {
      clearPersistedBattleState();
    } finally {
      rehydratedRef.current = true;
    }
  }, [publicKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!publicKey || !config.battleshipId) return;

    const shouldPersist = onChainEnabled
      && mode !== 'solo'
      && (screen === 'setup' || screen === 'placement' || screen === 'battle');

    if (!shouldPersist) {
      clearPersistedBattleState();
      return;
    }

    const payload: PersistedBattleState = {
      version: 1,
      contractId: config.battleshipId,
      owner: publicKey,
      mode,
      screen,
      onChainEnabled,
      sessionId,
      fleetPreset,
      theme,
      difficulty,
      matchType,
      boardScale,
      player1Points,
      player2Points,
      player2Address,
      ships,
      boardCommitted,
      boardSecrets: serializeBoardSecrets(boardSecrets),
      sessionSignerSecret: sessionSigner?.secret || null,
    };

    window.localStorage.setItem(BATTLE_PERSIST_KEY, JSON.stringify(payload));
  }, [
    publicKey,
    mode,
    screen,
    onChainEnabled,
    sessionId,
    fleetPreset,
    theme,
    difficulty,
    matchType,
    boardScale,
    player1Points,
    player2Points,
    player2Address,
    ships,
    boardCommitted,
    boardSecrets,
    sessionSigner,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const inviteToken = new URL(window.location.href).searchParams.get('invite') || '';
    if (!inviteToken) return;

    const parsed = parseInvitePayload(inviteToken);
    if (!parsed) {
      setMode('join');
      setImportXdr(inviteToken);
      setScreen('setup');
      setError('Invite link found, but format is invalid. Please re-check the link.');
      return;
    }

    setMode('join');
    setFleetPreset(parsed.preset);
    setFleetBlueprint(FLEET_PRESETS[parsed.preset].ships);
    resetPlacement(FLEET_PRESETS[parsed.preset].ships);
    setTheme(parsed.theme);
    setDifficulty(parsed.difficulty);
    setMatchType(parsed.matchType);
    setBoardScale(parsed.boardScale);
    setPlayer1Points(parsed.player1Points);
    setPlayer2Points(parsed.player2Points);
    setPlayer2Address(parsed.player2Address);
    setSessionId(parsed.sessionId);
    setLoadedInvitePayload(parsed);
    setOnChainEnabled(Boolean(parsed.signedAuthEntryXdr && parsed.contractId));
    setScreen('setup');
    setError(null);
    setSuccess('Invite loaded. Joining match automatically...');
  }, []);

  useEffect(() => {
    if (screen !== 'setup' || mode !== 'join') return;
    if (!loadedInvitePayload) return;
    if (autoJoinAttemptedRef.current) return;

    if (onChainEnabled && (!isConnected || !publicKey)) {
      setChainStatus(AUTO_JOIN_CONNECT_WALLET_STATUS);
      return;
    }

    setChainStatus((prev) => (prev === AUTO_JOIN_CONNECT_WALLET_STATUS ? null : prev));

    autoJoinAttemptedRef.current = true;
    setIsAutoJoiningInvite(true);
    void (async () => {
      try {
        await continueFromSetup();
      } finally {
        setIsAutoJoiningInvite(false);
      }
    })();
  }, [screen, mode, loadedInvitePayload, onChainEnabled, isConnected, publicKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onHashChange = () => {
      const next = getRouteStateFromHash();
      setScreen((prev) => (prev === next.screen ? prev : next.screen));
      if (typeof next.sessionId === 'number') {
        const parsedSessionId = next.sessionId;
        setSessionId((prev) => (prev === parsedSessionId ? prev : parsedSessionId));
      }
    };

    window.addEventListener('hashchange', onHashChange);

    if (!window.location.hash) {
      window.history.replaceState(null, '', hashForScreen(screen, sessionId));
    }

    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const includeSessionInPath = onChainEnabled && mode !== 'solo' && (screen === 'placement' || screen === 'battle');
    const nextHash = hashForScreen(screen, sessionId, includeSessionInPath);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [screen, sessionId, onChainEnabled, mode]);

  useEffect(() => {
    if (!publicKey) {
      setSessionSigner(null);
    }
  }, [publicKey]);

  useEffect(() => {
    if (screen !== 'placement' && screen !== 'battle') return;
    if (!onChainEnabled || mode === 'solo') return;
    if (!battleshipService) return;
    if (!publicKey) {
      setError('Connect wallet to access this game endpoint.');
      setScreen('setup');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const game = await battleshipService.getGame(sessionId);
        if (cancelled) return;
        if (!game) {
          setError('Invalid game endpoint. Session not found on-chain.');
          setScreen('home');
          return;
        }

        const isParticipant = game.player1 === publicKey || game.player2 === publicKey;
        if (!isParticipant) {
          setError('This game endpoint is signed for different players. Connect the invited wallet.');
          setScreen('home');
          return;
        }
      } catch {
        if (!cancelled) {
          setError('Could not validate this game endpoint right now. Please retry.');
          setScreen('setup');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, onChainEnabled, mode, battleshipService, publicKey, sessionId]);

  const LOGO = `
██████   █████  ████████ ████████ ██      ███████ ███████ ██   ██ ██ ██████  
██   ██ ██  ██    ██     ██     ██      ██     ██     ██  ██  ██ ██   ██ 
██████  ███████    ██       ██    ██      █████   ███████ █████   ██ ██   ██ 
██   ██ ██  ██    ██       ██    ██      ██          ██ ██  ██  ██ ██   ██ 
██████  ██   ██    ██       ██    ███████ ███████ ███████ ██   ██ ██ ██████  `;

  if (screen === 'home') {
    return (
      <div className={`classic-shell ${themeClass}`} style={shellStyle}>
        <div className="home-shell">
          <div className="hero-head">
            <pre className="battleship-logo" aria-label="Battleship logo">{LOGO}</pre>
            <p className="hero-subtitle">Professional Battleship arena — solo or invite-a-friend</p>
          </div>

          <WalletSwitcher />

          <div className="hero-grid">
            <div className="hero-card">
              <h3>Start Solo</h3>
              <p>Play instantly against an adaptive AI with configurable difficulty and stakes.</p>
              <button onClick={() => goToSetup('solo')}>Start Solo Game</button>
            </div>

            <div className="hero-card">
              <h3>Invite Friend</h3>
              <p>Create a sharable setup link so both players enter the same match configuration.</p>
              <button onClick={() => goToSetup('invite')}>Create Invite Match</button>
            </div>

            <div className="hero-card">
              <h3>Join Invite</h3>
              <p>Paste your invite link to load the exact same ships, stakes, and match settings.</p>
              <input
                placeholder="Paste invite URL"
                value={importXdr}
                onChange={(e) => setImportXdr(e.target.value.trim())}
              />
              <button onClick={() => goToSetup('join')}>Join Match</button>
            </div>
          </div>

          <div className="economy-panel">
            <div>Your Coins: 1000</div>
            <div>Mode: {mode === 'solo' ? 'Solo' : mode === 'invite' ? 'Invite' : 'Join'}</div>
            <div>Rule: {matchType === 'wager' ? 'Wager' : 'Free Play'}</div>
            <div>Session: {sessionId}</div>
          </div>

          {error && <div className="notice error">{error}</div>}
          {success && <div className="notice success">{success}</div>}
        </div>
      </div>
    );
  }

  if (screen === 'setup') {
    const joinFromInvite = mode === 'join' && Boolean(loadedInvitePayload);

    return (
      <div className={`classic-shell ${themeClass}`} style={shellStyle}>
        <div className="home-shell" style={{ display: 'grid', gap: 16 }}>
          <div className="screen-header">
            <div>
              <div className="eyebrow">Match setup</div>
              <h2>Configure your battle</h2>
              <p className="muted">Choose stakes, fleet preset, and theme before placing ships.</p>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => goHome()}>Back home</button>
            </div>
          </div>

          <WalletSwitcher />

          {joinFromInvite && (
            <div className="card auto-join-card">
              <div className="auto-join-title">Instant Invite Join</div>
              <div className="inline-hint">
                {isAutoJoiningInvite || isSyncingChain
                  ? 'Joining your match on-chain, preparing stake flow, and moving you to battle setup...'
                  : 'Invite loaded. Auto-join is ready.'}
              </div>
              {(isAutoJoiningInvite || isSyncingChain) && (
                <div className="auto-join-loader" aria-live="polite">
                  <span className="auto-join-dot" />
                  <span>{chainStatus || 'Processing invite...'}</span>
                </div>
              )}
            </div>
          )}

          <div className="grid-2">
            <div className="card stack">
              <div className="section-title">Match settings</div>
              <div className="setup-grid">
                <div className="setup-block">
                  <label>Mode</label>
                  <select
                    value={mode}
                    disabled={joinFromInvite}
                    onChange={(e) => {
                      const nextMode = e.target.value as Mode;
                      setMode(nextMode);
                      setOnChainEnabled(nextMode !== 'solo');
                    }}
                  >
                    <option value="solo">Solo vs AI</option>
                    <option value="invite">Invite friend</option>
                    <option value="join">Join invite</option>
                  </select>
                </div>
                <div className="setup-block">
                  <label>Difficulty</label>
                  <select value={difficulty} disabled={joinFromInvite} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                    <option value="easy">Easy</option>
                    <option value="normal">Normal</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div className="setup-block">
                  <label>Match type</label>
                  <select
                    value={matchType}
                    disabled={joinFromInvite}
                    onChange={(e) => {
                      const nextMatchType = e.target.value as MatchType;
                      if (nextMatchType === 'wager' && mode !== 'solo' && onChainEnabled && !betTokenContract) {
                        setError('Wager is not available yet because XLM staking is not configured on-chain.');
                        setMatchType('free');
                        return;
                      }
                      setMatchType(nextMatchType);
                    }}
                  >
                    <option value="free">Free play</option>
                    <option value="wager" disabled={mode !== 'solo' && onChainEnabled && !betTokenContract}>Wager match</option>
                  </select>
                  {mode !== 'solo' && onChainEnabled && !betTokenContract && (
                    <div className="inline-hint">Wager disabled: admin must configure native XLM staking on-chain (`prover:set-bet-token`).</div>
                  )}
                </div>
                <div className="setup-block">
                  <label>Playground size</label>
                  <select value={boardScale} disabled={joinFromInvite} onChange={(e) => setBoardScale(e.target.value as BoardScale)}>
                    <option value="compact">Compact</option>
                    <option value="standard">Standard</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                {mode !== 'solo' && (
                  <div className="setup-block">
                    <label>Settlement</label>
                    <select
                      value={onChainEnabled ? 'onchain' : 'offchain'}
                      disabled={joinFromInvite}
                      onChange={(e) => setOnChainEnabled(e.target.value === 'onchain')}
                    >
                      <option value="onchain">On-chain (Soroban)</option>
                      <option value="offchain">Off-chain (UI only)</option>
                    </select>
                  </div>
                )}
                {mode !== 'solo' && onChainEnabled && (
                  <div className="setup-block">
                    <label>Privacy prover</label>
                    <div className="inline-hint">{isNoirProverConfigured() ? 'Configured' : 'Not configured'}</div>
                  </div>
                )}
                {mode !== 'solo' && onChainEnabled && (
                  <div className="setup-block">
                    <label>Trustless zk verifier</label>
                    <div className="inline-hint">{zkVerifierContract ? 'Configured on-chain' : 'Not configured (attestation mode)'}</div>
                  </div>
                )}
                {mode !== 'solo' && onChainEnabled && (
                  <div className="setup-block">
                    <label>Wager escrow token</label>
                    <div className="inline-hint">{betTokenContract ? 'Configured on-chain' : 'Not configured'}</div>
                  </div>
                )}
              </div>

              {mode !== 'solo' && onChainEnabled && !config.battleshipId && (
                <div className="notice error">Contract ID missing. Run setup/deploy to enable on-chain mode.</div>
              )}
              {mode !== 'solo' && onChainEnabled && chainStatus
                && (chainStatus !== AUTO_JOIN_CONNECT_WALLET_STATUS || !isConnected || !publicKey) && (
                <div className="notice success">{chainStatus}</div>
              )}

              <div className="section-title" style={{ marginTop: 10 }}>Players and stake</div>
              {matchType === 'wager' ? (
                <div className="setup-grid">
                  <div className="setup-block">
                    <label>Your stake (XLM)</label>
                    <input
                      value={player1Points}
                      onChange={(e) => setPlayer1Points(e.target.value)}
                    />
                  </div>
                  {mode !== 'solo' && (
                    <div className="setup-block">
                      <label>Their stake (XLM)</label>
                      <input
                        value={player2Points}
                        onChange={(e) => setPlayer2Points(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="inline-hint">Free play selected — no stake required.</div>
              )}

              {mode !== 'solo' && !joinFromInvite && (
                <div className="stack" style={{ marginTop: 12 }}>
                  <label>Opponent address</label>
                  <input value={player2Address} onChange={(e) => setPlayer2Address(e.target.value.trim())} placeholder="Enter wallet / player ID" />
                </div>
              )}

              {mode === 'join' && !joinFromInvite && (
                <div className="stack" style={{ marginTop: 12 }}>
                  <label>Invite link or XDR</label>
                  <input
                    placeholder="Paste invite URL / XDR"
                    value={importXdr}
                    onChange={(e) => setImportXdr(e.target.value.trim())}
                  />
                  <div className="actions">
                    <button className="ghost" onClick={loadInviteSettings}>Load invite settings</button>
                  </div>
                  <div className="inline-hint">Loads mode, stakes, fleet preset, theme, difficulty and board size from invite.</div>
                </div>
              )}

              {joinFromInvite && (
                <div className="notice info" style={{ marginTop: 12 }}>
                  Invite detected from URL. Joining is automatic — no manual copy/paste or setting changes needed.
                </div>
              )}

              {mode === 'invite' && (
                <div className="stack" style={{ marginTop: 12 }}>
                  <div className="actions">
                    <button className="ghost" onClick={() => createInviteLink(onChainEnabled)} disabled={isSyncingChain}>Generate invite link</button>
                  </div>
                  {inviteXdr && (
                    <>
                      <label>Shareable invite link</label>
                      <textarea
                        readOnly
                        value={inviteXdr}
                        rows={3}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="card stack">
              <div className="section-title">Look and fleet</div>
              <div className="setup-grid">
                <div className="setup-block">
                  <label>Fleet preset</label>
                  <select value={fleetPreset} onChange={(e) => changePreset(e.target.value as FleetPreset)}>
                    {Object.entries(FLEET_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>{preset.label}</option>
                    ))}
                  </select>
                  <div className="inline-hint">Presets: Classic (5 ships), Compact (3 ships), Heavy (6 ships).</div>
                </div>
                <div className="setup-block">
                  <label>Board theme</label>
                  <select
                    value={theme}
                    onChange={(e) => setTheme((e.target.value as ThemeMode))}
                  >
                    <option value="green">Grid Green</option>
                    <option value="blue">Grid Blue</option>
                    <option value="violet">Grid Violet</option>
                  </select>
                  <div className="inline-hint">Choose grid accent to match your preference.</div>
                </div>
              </div>

              <div className="alert" style={{ marginTop: 10 }}>
                <h4 style={{ marginBottom: 8 }}>Match summary</h4>
                <div className="inline-hint" style={{ display: 'grid', gap: 6 }}>
                  <span>Mode: {mode === 'solo' ? 'Solo vs AI' : mode === 'invite' ? 'Invite friend' : 'Join invite'}</span>
                  <span>Difficulty: {difficulty}</span>
                  <span>Playground: {boardScale} ({cellSizePx}px cells)</span>
                  <span>Stake model: {matchType === 'wager' ? `Wager (${totalStake.toFixed(2)} XLM total)` : 'Free play'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="ghost" onClick={() => goHome()}>Cancel</button>
            {!joinFromInvite && (
              <button
                disabled={isSyncingChain || (mode === 'join' ? (!importXdr && !loadedInvitePayload) : mode === 'invite' ? !player2Address : false)}
                onClick={continueFromSetup}
              >
                {isSyncingChain ? 'Syncing on-chain...' : 'Continue to placement'}
              </button>
            )}
          </div>

          {error && <div className="notice error">{error}</div>}
          {success && <div className="notice success">{success}</div>}
        </div>
      </div>
    );
  }

  if (screen === 'placement') {
    return (
      <div className={`classic-shell ${themeClass}`} style={shellStyle}>
        <div className="home-shell" style={{ display: 'grid', gap: 16, paddingTop: 14 }}>
          <div className="hero-head" style={{ marginBottom: 0 }}>
            <pre className="battleship-logo" aria-label="Battleship logo">{LOGO}</pre>
            <p className="hero-subtitle">Arrange your fleet — ships must not touch.</p>
          </div>

          <div className="game_placement">
            <div className="placement_instructions">
              <div className="alert">
                <h4 style={{ marginBottom: 8 }}>Mode: {mode === 'solo' ? 'Solo vs AI' : mode === 'invite' ? 'Invite Friend' : 'Join Invite'}</h4>
                <ul className="inline-hint" style={{ display: 'grid', gap: 6, paddingLeft: 16 }}>
                  <li>Difficulty: {difficulty} · Match: {matchType === 'wager' ? 'Wager' : 'Free play'}.</li>
                  <li>Drag ships onto the board. Ships cannot touch each other.</li>
                  <li>Rotate a placed ship by clicking it.</li>
                  <li>Use Randomize for a legal instant layout.</li>
                </ul>
              </div>
            </div>

            <div className="placement_board">
              <div
                className="board"
                style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, var(--classic-cell-size))` }}
              >
                {Array.from({ length: CELL_COUNT }).map((_, idx) => {
                  const x = idx % BOARD_SIZE;
                  const y = Math.floor(idx / BOARD_SIZE);
                  const occupiedBy = ships.find((ship) => {
                    if (ship.x === null || ship.y === null) return false;
                    for (let i = 0; i < ship.size; i += 1) {
                      const dx = ship.axis === 'h' ? i : 0;
                      const dy = ship.axis === 'v' ? i : 0;
                      if (ship.x + dx === x && ship.y + dy === y) return true;
                    }
                    return false;
                  });
                  return (
                    <div
                      key={idx}
                      className={`board_box ${occupiedBy ? 'selected' : ''}`}
                      data-x={x}
                      data-y={y}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleCellDrop}
                      onClick={() => {
                        if (occupiedBy) rotateShip(occupiedBy.id);
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="placement_ships" style={{ gap: 12 }}>
              <div className="ships_actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                <button onClick={() => setShips((prev) => prev.map((s) => ({ ...s, axis: s.axis === 'h' ? 'v' : 'h' })))}>Toggle Axis (All)</button>
                <button
                  onClick={() => {
                    const randomized = randomizeFleet();
                    if (!randomized) {
                      setError('Randomize failed, try again.');
                      return;
                    }
                    setShips(randomized.map((s) => ({ ...s })) as unknown as ShipPlacement[]);
                    setError(null);
                  }}
                >
                  Randomize
                </button>
                <button onClick={() => resetPlacement()}>Reset</button>
                <button className="btn-secondary" onClick={() => setScreen('setup')}>Back</button>
              </div>

              <div className="ships_available">
                {ships.map((ship) => {
                  const isPlaced = ship.x !== null && ship.y !== null;
                  const width = ship.axis === 'h' ? ship.size : 1;
                  const height = ship.axis === 'v' ? ship.size : 1;
                  const style = {
                    width: `calc(var(--classic-cell-size) * ${width})`,
                    height: `calc(var(--classic-cell-size) * ${height})`,
                    opacity: isPlaced ? 0.4 : 1,
                  } as React.CSSProperties;
                  return (
                    <div
                      key={ship.id}
                      className={`ship ${ship.axis === 'v' ? 'vertical' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, ship.id, ship.axis, 0)}
                      style={style}
                    >
                      {Array.from({ length: ship.size }).map((_, idx) => (
                        <div key={idx} className="board_box" />
                      ))}
                      <span className="board_box-marker" style={{ position: 'absolute', top: 2, left: 6 }}>{ship.label}</span>
                    </div>
                  );
                })}
              </div>

              <div className="placement_instructions" style={{ gap: 10 }}>
                <div className="inline-hint">Placed ships: {ships.filter((s) => s.x !== null).length} / {ships.length}</div>
                {isOnChainMultiplayerMode() && (
                  <div className="inline-hint">
                    {boardCommitted
                      ? 'Board committed on-chain.'
                      : matchType === 'wager'
                        ? 'Start will first deposit your stake (if pending), then commit your board to Soroban.'
                        : 'Start will commit your board to Soroban first.'}
                  </div>
                )}
                <button disabled={!allPlaced() || isSyncingChain} onClick={startBattle} className="btn-primary btn-start">
                  {isOnChainMultiplayerMode()
                    ? (isSyncingChain
                      ? 'Syncing chain...'
                      : matchType === 'wager'
                        ? 'Stake, Commit & Start'
                        : 'Commit & Start')
                    : 'Start Game'}
                </button>
              </div>
            </div>
          </div>

          {error && <div className="notice error">{error}</div>}
          {success && <div className="notice success">{success}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`classic-shell ${themeClass}`} style={shellStyle}>
      <div className="home-shell" style={{ display: 'grid', gap: 16 }}>
        <div className="hero-head" style={{ marginBottom: 4 }}>
          <pre className="battleship-logo" aria-label="Battleship logo">{LOGO}</pre>
          <p className="hero-subtitle">Engage the enemy — click enemy waters to fire.</p>
        </div>

        <div className="game_header">
          <div className="game_status">
            STATUS: {
              enemyDefeated
                ? 'You win'
                : playerDefeated
                  ? 'You lose'
                  : mode === 'solo'
                    ? 'Your turn vs AI'
                    : onChainPendingDefender && onChainPendingDefender !== publicKey
                      ? 'Pending defender resolution'
                      : myOnChainTurn
                        ? 'Your on-chain turn'
                        : 'Waiting for opponent'
            }
          </div>
        </div>

        <div className="match-metrics">
          <span>Session: {sessionId}</span>
          <span>Difficulty: {difficulty}</span>
          <span>Rule: {matchType === 'wager' ? `Wager (${totalStake.toFixed(2)} XLM)` : 'Free play'}</span>
          {isOnChainMultiplayerMode() && <span>Settlement: On-chain</span>}
          {isOnChainMultiplayerMode() && matchType === 'wager' && <span>Payout: {onChainPayoutProcessed ? 'Processed' : 'Pending'}</span>}
          <span>Fleet Ready: {ships.filter((s) => s.x !== null).length}/{ships.length}</span>
          <span>Hits taken: {hitsPlayer.size}</span>
        </div>

        {lastRewardClaimText && (
          <div className="notice success">{lastRewardClaimText}</div>
        )}

        {isOnChainMultiplayerMode() && chainStatus && <div className="notice success">{chainStatus}</div>}

        {isOnChainMultiplayerMode() && publicKey && (
          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <div className="inline-hint">
              {sessionSigner
                ? `One-tap signing active via delegated key ${sessionSigner.publicKey.slice(0, 6)}...${sessionSigner.publicKey.slice(-6)}.`
                : 'Enable one-tap signing once to avoid wallet popup on every attack/resolve.'}
            </div>
            {sessionSigner ? (
              <button className="btn-secondary" disabled={isSyncingChain} onClick={revokeSessionDelegation}>
                {isSyncingChain ? 'Revoking...' : 'Disable One-Tap Signing'}
              </button>
            ) : (
              <button className="btn-primary" disabled={isSyncingChain} onClick={enableSessionDelegation}>
                {isSyncingChain ? 'Authorizing...' : 'Enable One-Tap Signing'}
              </button>
            )}
          </div>
        )}

        {(enemyDefeated || playerDefeated) && (
          <div className="result-view card">
            <h3 className="accent-color">{enemyDefeated ? 'Victory' : 'Defeat'}</h3>
            <p className="inline-hint">
              {enemyDefeated
                ? 'You successfully discovered and destroyed all enemy ships.'
                : 'Your fleet has been fully destroyed. Reconfigure and try again.'}
            </p>
            {isOnChainMultiplayerMode() && matchType === 'wager' && (
              <p className="inline-hint">Wager pot: {formatXlmFromStroops(onChainPotStroops)} XLM</p>
            )}
            <div className="result-actions">
              <button className="btn-secondary" onClick={() => startPlacement(mode)}>Play Again</button>
              <button onClick={goHome}>Back Home</button>
            </div>
          </div>
        )}

        {showRewardModal && onChainRewardWinner && (
          <div className="handoff-overlay" role="dialog" aria-modal="true">
            <div className="handoff-card">
              <h3 className="accent-color">Victory Reward</h3>
              <p className="inline-hint">You won this on-chain wager match.</p>
              <p className="inline-hint">Total pot: {formatXlmFromStroops(onChainPotStroops)} XLM</p>
              <div className="result-actions" style={{ marginTop: 6 }}>
                <button
                  className="btn-primary"
                  disabled={isRewardClaiming}
                  onClick={claimWinnerReward}
                >
                  {isRewardClaiming ? 'Checking on-chain reward...' : 'Get Reward'}
                </button>
                <button className="btn-secondary" onClick={() => setShowRewardModal(false)}>
                  Later
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="game_boards">
          <div>
            <div className="board-title">Your Fleet</div>
            <div className="board">
              {Array.from({ length: CELL_COUNT }).map((_, idx) => {
                const x = idx % BOARD_SIZE;
                const y = Math.floor(idx / BOARD_SIZE);
                const occupied = boardMask[y][x];
                const wasHit = hitsPlayer.has(`${x},${y}`);
                const wasMiss = shotsEnemy.has(`${x},${y}`) && !wasHit;
                return (
                  <div key={idx} className={`board_box ${wasHit ? 'hit' : ''} ${wasMiss ? 'miss' : ''} ${occupied ? 'selected' : ''}`} />
                );
              })}
            </div>
          </div>

          <div>
            <div className="board-title">Enemy Waters</div>
            <div className="board-enemy">
              {Array.from({ length: CELL_COUNT }).map((_, idx) => {
                const x = idx % BOARD_SIZE;
                const y = Math.floor(idx / BOARD_SIZE);
                const key = `${x},${y}`;
                const wasShot = enemyShots.has(key);
                const isHit = enemyHits.has(key);
                const isSunk = isHit && enemyMask[y][x];
                const isPendingAttack = myPendingAttackKey === key && !wasShot;
                return (
                  <div
                    key={idx}
                    className={`board_box ${isHit ? 'hit' : ''} ${wasShot && !isHit ? 'miss' : ''} ${isSunk ? 'selected' : ''} ${isPendingAttack ? 'pending' : ''}`}
                    onClick={async () => {
                      if (enemyDefeated || playerDefeated) return;
                      await fireAtEnemy(x, y);
                      if (!isOnChainMultiplayerMode()) {
                        enemyFires();
                      }
                    }}
                  >
                    {isPendingAttack ? <span className="board_box-marker">…</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {error && <div className="notice error">{error}</div>}
        {success && <div className="notice success">{success}</div>}
      </div>
    </div>
  );
}
