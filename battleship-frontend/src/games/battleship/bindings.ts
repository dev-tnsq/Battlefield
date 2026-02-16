import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';
export * from '@stellar/stellar-sdk'
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CBNC7OR4XNN4PRK5JJD37ONXAIDCCN4745WTJH32Q7SZYHIQ76E2B3RY",
  }
} as const


export interface Game {
  board_size: u32;
  payout_processed: boolean;
  pending_attacker: Option<string>;
  pending_defender: Option<string>;
  pending_x: Option<u32>;
  pending_y: Option<u32>;
  player1: string;
  player1_attacks: Array<u32>;
  player1_board: Option<Array<Buffer>>;
  player1_deposited: boolean;
  player1_hit_attacks: Array<u32>;
  player1_hits: u32;
  player1_points: i128;
  player1_ship_cells: Option<u32>;
  player2: string;
  player2_attacks: Array<u32>;
  player2_board: Option<Array<Buffer>>;
  player2_deposited: boolean;
  player2_hit_attacks: Array<u32>;
  player2_hits: u32;
  player2_points: i128;
  player2_ship_cells: Option<u32>;
  turn: Option<string>;
  winner: Option<string>;
}

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"GameAlreadyEnded"},
  4: {message:"InvalidBoardCommitmentLength"},
  5: {message:"BoardAlreadyCommitted"},
  6: {message:"BoardsNotReady"},
  7: {message:"NotYourTurn"},
  8: {message:"InvalidCoordinate"},
  9: {message:"AlreadyAttacked"},
  10: {message:"PendingAttackResolution"},
  11: {message:"NoPendingAttack"},
  12: {message:"NotPendingDefender"},
  13: {message:"InvalidCellReveal"},
  14: {message:"InvalidShipCount"},
  15: {message:"InvalidProofHash"},
  16: {message:"MissingProofSignature"},
  17: {message:"InvalidStakeAmount"},
  18: {message:"BetTokenNotConfigured"},
  19: {message:"AlreadyDeposited"},
  20: {message:"StakesNotFunded"},
  21: {message:"InvalidFeeBps"},
  22: {message:"ZkVerifierNotConfigured"},
  23: {message:"ZkVerificationFailed"},
  24: {message:"ZkProofRequired"},
  25: {message:"InvalidSession"},
  26: {message:"SessionExpired"},
  27: {message:"InvalidSessionConfig"}
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "Admin", values: void} | {tag: "VerifierPubKey", values: void} | {tag: "ZkVerifierContract", values: void} | {tag: "Session", values: readonly [string, string, u32]};

export type ConfigKey = {tag: "BetToken", values: void} | {tag: "FeeRecipient", values: void} | {tag: "FeeBps", values: void};


export interface SessionGrant {
  expires_ledger: u32;
  uses_left: u32;
}

export interface Client {
  /**
   * Construct and simulate a attack transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  attack: ({session_id, attacker, x, y}: {session_id: u32, attacker: string, x: u32, y: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({session_id}: {session_id: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_bps: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session: ({session_id, player, delegate}: {session_id: u32, player: string, delegate: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<SessionGrant>>>

  /**
   * Construct and simulate a set_fee_bps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_bps: ({fee_bps}: {fee_bps: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_board transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_board: ({session_id, player, cell_commitments, ship_cells, board_proof_hash, board_proof_signature}: {session_id: u32, player: string, cell_commitments: Array<Buffer>, ship_cells: u32, board_proof_hash: Option<Buffer>, board_proof_signature: Option<Buffer>}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifier: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_verifier: ({verifier_pub_key}: {verifier_pub_key: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a deposit_stake transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit_stake: ({session_id, player}: {session_id: u32, player: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_bet_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bet_token: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_bet_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_bet_token: ({token_contract}: {token_contract: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a clear_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  clear_verifier: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a resolve_attack transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve_attack: ({session_id, defender, is_ship, salt, zk_proof_hash, zk_proof_signature}: {session_id: u32, defender: string, is_ship: boolean, salt: Buffer, zk_proof_hash: Buffer, zk_proof_signature: Option<Buffer>}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_session: ({session_id, player, delegate}: {session_id: u32, player: string, delegate: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a clear_bet_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  clear_bet_token: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a commit_board_zk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_board_zk: ({session_id, player, cell_commitments, ship_cells, zk_board_proof}: {session_id: u32, player: string, cell_commitments: Array<Buffer>, ship_cells: u32, zk_board_proof: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_zk_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_zk_verifier: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_zk_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_zk_verifier: ({verifier_contract}: {verifier_contract: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a attack_by_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  attack_by_session: ({session_id, attacker, delegate, x, y}: {session_id: u32, attacker: string, delegate: string, x: u32, y: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a authorize_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  authorize_session: ({session_id, player, delegate, ttl_ledgers, uses_left}: {session_id: u32, player: string, delegate: string, ttl_ledgers: u32, uses_left: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a clear_zk_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  clear_zk_verifier: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_recipient: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a resolve_attack_zk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve_attack_zk: ({session_id, defender, zk_attack_proof}: {session_id: u32, defender: string, zk_attack_proof: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_recipient: ({recipient}: {recipient: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a resolve_attack_by_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve_attack_by_session: ({session_id, defender, delegate, is_ship, salt, zk_proof_hash, zk_proof_signature}: {session_id: u32, defender: string, delegate: string, is_ship: boolean, salt: Buffer, zk_proof_hash: Buffer, zk_proof_signature: Option<Buffer>}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resolve_attack_zk_by_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve_attack_zk_by_session: ({session_id, defender, delegate, zk_attack_proof}: {session_id: u32, defender: string, delegate: string, zk_attack_proof: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub}: {admin: string, game_hub: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAYAAAAAAAAAApib2FyZF9zaXplAAAAAAAEAAAAAAAAABBwYXlvdXRfcHJvY2Vzc2VkAAAAAQAAAAAAAAAQcGVuZGluZ19hdHRhY2tlcgAAA+gAAAATAAAAAAAAABBwZW5kaW5nX2RlZmVuZGVyAAAD6AAAABMAAAAAAAAACXBlbmRpbmdfeAAAAAAAA+gAAAAEAAAAAAAAAAlwZW5kaW5nX3kAAAAAAAPoAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAA9wbGF5ZXIxX2F0dGFja3MAAAAD6gAAAAQAAAAAAAAADXBsYXllcjFfYm9hcmQAAAAAAAPoAAAD6gAAA+4AAAAgAAAAAAAAABFwbGF5ZXIxX2RlcG9zaXRlZAAAAAAAAAEAAAAAAAAAE3BsYXllcjFfaGl0X2F0dGFja3MAAAAD6gAAAAQAAAAAAAAADHBsYXllcjFfaGl0cwAAAAQAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAABJwbGF5ZXIxX3NoaXBfY2VsbHMAAAAAA+gAAAAEAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAAD3BsYXllcjJfYXR0YWNrcwAAAAPqAAAABAAAAAAAAAANcGxheWVyMl9ib2FyZAAAAAAAA+gAAAPqAAAD7gAAACAAAAAAAAAAEXBsYXllcjJfZGVwb3NpdGVkAAAAAAAAAQAAAAAAAAATcGxheWVyMl9oaXRfYXR0YWNrcwAAAAPqAAAABAAAAAAAAAAMcGxheWVyMl9oaXRzAAAABAAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAAAAAAAEnBsYXllcjJfc2hpcF9jZWxscwAAAAAD6AAAAAQAAAAAAAAABHR1cm4AAAPoAAAAEwAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAGwAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAQR2FtZUFscmVhZHlFbmRlZAAAAAMAAAAAAAAAHEludmFsaWRCb2FyZENvbW1pdG1lbnRMZW5ndGgAAAAEAAAAAAAAABVCb2FyZEFscmVhZHlDb21taXR0ZWQAAAAAAAAFAAAAAAAAAA5Cb2FyZHNOb3RSZWFkeQAAAAAABgAAAAAAAAALTm90WW91clR1cm4AAAAABwAAAAAAAAARSW52YWxpZENvb3JkaW5hdGUAAAAAAAAIAAAAAAAAAA9BbHJlYWR5QXR0YWNrZWQAAAAACQAAAAAAAAAXUGVuZGluZ0F0dGFja1Jlc29sdXRpb24AAAAACgAAAAAAAAAPTm9QZW5kaW5nQXR0YWNrAAAAAAsAAAAAAAAAEk5vdFBlbmRpbmdEZWZlbmRlcgAAAAAADAAAAAAAAAARSW52YWxpZENlbGxSZXZlYWwAAAAAAAANAAAAAAAAABBJbnZhbGlkU2hpcENvdW50AAAADgAAAAAAAAAQSW52YWxpZFByb29mSGFzaAAAAA8AAAAAAAAAFU1pc3NpbmdQcm9vZlNpZ25hdHVyZQAAAAAAABAAAAAAAAAAEkludmFsaWRTdGFrZUFtb3VudAAAAAAAEQAAAAAAAAAVQmV0VG9rZW5Ob3RDb25maWd1cmVkAAAAAAAAEgAAAAAAAAAQQWxyZWFkeURlcG9zaXRlZAAAABMAAAAAAAAAD1N0YWtlc05vdEZ1bmRlZAAAAAAUAAAAAAAAAA1JbnZhbGlkRmVlQnBzAAAAAAAAFQAAAAAAAAAXWmtWZXJpZmllck5vdENvbmZpZ3VyZWQAAAAAFgAAAAAAAAAUWmtWZXJpZmljYXRpb25GYWlsZWQAAAAXAAAAAAAAAA9aa1Byb29mUmVxdWlyZWQAAAAAGAAAAAAAAAAOSW52YWxpZFNlc3Npb24AAAAAABkAAAAAAAAADlNlc3Npb25FeHBpcmVkAAAAAAAaAAAAAAAAABRJbnZhbGlkU2Vzc2lvbkNvbmZpZwAAABs=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAADlZlcmlmaWVyUHViS2V5AAAAAAAAAAAAAAAAABJaa1ZlcmlmaWVyQ29udHJhY3QAAAAAAAEAAAAAAAAAB1Nlc3Npb24AAAAAAwAAABMAAAATAAAABA==",
        "AAAAAgAAAAAAAAAAAAAACUNvbmZpZ0tleQAAAAAAAAMAAAAAAAAAAAAAAAhCZXRUb2tlbgAAAAAAAAAAAAAADEZlZVJlY2lwaWVudAAAAAAAAAAAAAAABkZlZUJwcwAA",
        "AAAAAQAAAAAAAAAAAAAADFNlc3Npb25HcmFudAAAAAIAAAAAAAAADmV4cGlyZXNfbGVkZ2VyAAAAAAAEAAAAAAAAAAl1c2VzX2xlZnQAAAAAAAAE",
        "AAAAAAAAAAAAAAAGYXR0YWNrAAAAAAAEAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhhdHRhY2tlcgAAABMAAAAAAAAAAXgAAAAAAAAEAAAAAAAAAAF5AAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAABEdhbWUAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAALZ2V0X2ZlZV9icHMAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAALZ2V0X3Nlc3Npb24AAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAhkZWxlZ2F0ZQAAABMAAAABAAAD6AAAB9AAAAAMU2Vzc2lvbkdyYW50",
        "AAAAAAAAAAAAAAALc2V0X2ZlZV9icHMAAAAAAQAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMY29tbWl0X2JvYXJkAAAABgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAABBjZWxsX2NvbW1pdG1lbnRzAAAD6gAAA+4AAAAgAAAAAAAAAApzaGlwX2NlbGxzAAAAAAAEAAAAAAAAABBib2FyZF9wcm9vZl9oYXNoAAAD6AAAA+4AAAAgAAAAAAAAABVib2FyZF9wcm9vZl9zaWduYXR1cmUAAAAAAAPoAAAD7gAAAEAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMZ2V0X3ZlcmlmaWVyAAAAAAAAAAEAAAPoAAAD7gAAACA=",
        "AAAAAAAAAAAAAAAMc2V0X3ZlcmlmaWVyAAAAAQAAAAAAAAAQdmVyaWZpZXJfcHViX2tleQAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANZGVwb3NpdF9zdGFrZQAAAAAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANZ2V0X2JldF90b2tlbgAAAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAAAAAAANc2V0X2JldF90b2tlbgAAAAAAAAEAAAAAAAAADnRva2VuX2NvbnRyYWN0AAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAOY2xlYXJfdmVyaWZpZXIAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAAOcmVzb2x2ZV9hdHRhY2sAAAAAAAYAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACGRlZmVuZGVyAAAAEwAAAAAAAAAHaXNfc2hpcAAAAAABAAAAAAAAAARzYWx0AAAADgAAAAAAAAANemtfcHJvb2ZfaGFzaAAAAAAAA+4AAAAgAAAAAAAAABJ6a19wcm9vZl9zaWduYXR1cmUAAAAAA+gAAAPuAAAAQAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAOcmV2b2tlX3Nlc3Npb24AAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAIZGVsZWdhdGUAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAPY2xlYXJfYmV0X3Rva2VuAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAAPY29tbWl0X2JvYXJkX3prAAAAAAUAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAQY2VsbF9jb21taXRtZW50cwAAA+oAAAPuAAAAIAAAAAAAAAAKc2hpcF9jZWxscwAAAAAABAAAAAAAAAAOemtfYm9hcmRfcHJvb2YAAAAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAPZ2V0X3prX3ZlcmlmaWVyAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAAAAAAAPc2V0X3prX3ZlcmlmaWVyAAAAAAEAAAAAAAAAEXZlcmlmaWVyX2NvbnRyYWN0AAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAARYXR0YWNrX2J5X3Nlc3Npb24AAAAAAAAFAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhhdHRhY2tlcgAAABMAAAAAAAAACGRlbGVnYXRlAAAAEwAAAAAAAAABeAAAAAAAAAQAAAAAAAAAAXkAAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAARYXV0aG9yaXplX3Nlc3Npb24AAAAAAAAFAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACGRlbGVnYXRlAAAAEwAAAAAAAAALdHRsX2xlZGdlcnMAAAAABAAAAAAAAAAJdXNlc19sZWZ0AAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAARY2xlYXJfemtfdmVyaWZpZXIAAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAARZ2V0X2ZlZV9yZWNpcGllbnQAAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAARcmVzb2x2ZV9hdHRhY2tfemsAAAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhkZWZlbmRlcgAAABMAAAAAAAAAD3prX2F0dGFja19wcm9vZgAAAAAOAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAARc2V0X2ZlZV9yZWNpcGllbnQAAAAAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAZcmVzb2x2ZV9hdHRhY2tfYnlfc2Vzc2lvbgAAAAAAAAcAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACGRlZmVuZGVyAAAAEwAAAAAAAAAIZGVsZWdhdGUAAAATAAAAAAAAAAdpc19zaGlwAAAAAAEAAAAAAAAABHNhbHQAAAAOAAAAAAAAAA16a19wcm9vZl9oYXNoAAAAAAAD7gAAACAAAAAAAAAAEnprX3Byb29mX3NpZ25hdHVyZQAAAAAD6AAAA+4AAABAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAccmVzb2x2ZV9hdHRhY2tfemtfYnlfc2Vzc2lvbgAAAAQAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACGRlZmVuZGVyAAAAEwAAAAAAAAAIZGVsZWdhdGUAAAATAAAAAAAAAA96a19hdHRhY2tfcHJvb2YAAAAADgAAAAEAAAPpAAAAAgAAAAM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    attack: this.txFromJSON<Result<void>>,
        get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        set_admin: this.txFromJSON<null>,
        start_game: this.txFromJSON<Result<void>>,
        get_fee_bps: this.txFromJSON<u32>,
        get_session: this.txFromJSON<Option<SessionGrant>>,
        set_fee_bps: this.txFromJSON<Result<void>>,
        commit_board: this.txFromJSON<Result<void>>,
        get_verifier: this.txFromJSON<Option<Buffer>>,
        set_verifier: this.txFromJSON<null>,
        deposit_stake: this.txFromJSON<Result<void>>,
        get_bet_token: this.txFromJSON<Option<string>>,
        set_bet_token: this.txFromJSON<null>,
        clear_verifier: this.txFromJSON<null>,
        resolve_attack: this.txFromJSON<Result<void>>,
        revoke_session: this.txFromJSON<Result<void>>,
        clear_bet_token: this.txFromJSON<null>,
        commit_board_zk: this.txFromJSON<Result<void>>,
        get_zk_verifier: this.txFromJSON<Option<string>>,
        set_zk_verifier: this.txFromJSON<null>,
        attack_by_session: this.txFromJSON<Result<void>>,
        authorize_session: this.txFromJSON<Result<void>>,
        clear_zk_verifier: this.txFromJSON<null>,
        get_fee_recipient: this.txFromJSON<string>,
        resolve_attack_zk: this.txFromJSON<Result<void>>,
        set_fee_recipient: this.txFromJSON<null>,
        resolve_attack_by_session: this.txFromJSON<Result<void>>,
        resolve_attack_zk_by_session: this.txFromJSON<Result<void>>
  }
}