#![no_std]

use soroban_sdk::{
  contract, contractclient, contracterror, contractimpl, contracttype, vec,
  token, Address, Bytes, BytesN, Env, IntoVal, Vec,
};

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
  fn start_game(
    env: Env,
    game_id: Address,
    session_id: u32,
    player1: Address,
    player2: Address,
    player1_points: i128,
    player2_points: i128,
  );
  fn end_game(env: Env, session_id: u32, player1_won: bool);
}

#[contractclient(name = "ZkVerifierClient")]
pub trait ZkVerifier {
  fn verify_board(
    env: Env,
    session_id: u32,
    ship_cells: u32,
    commitment_root: BytesN<32>,
    proof: Bytes,
  ) -> bool;

  fn verify_attack(
    env: Env,
    session_id: u32,
    x: u32,
    y: u32,
    expected_commitment: BytesN<32>,
    proof: Bytes,
  ) -> bool;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
  GameNotFound = 1,
  NotPlayer = 2,
  GameAlreadyEnded = 3,
  InvalidBoardCommitmentLength = 4,
  BoardAlreadyCommitted = 5,
  BoardsNotReady = 6,
  NotYourTurn = 7,
  InvalidCoordinate = 8,
  AlreadyAttacked = 9,
  PendingAttackResolution = 10,
  NoPendingAttack = 11,
  NotPendingDefender = 12,
  InvalidCellReveal = 13,
  InvalidShipCount = 14,
  InvalidProofHash = 15,
  MissingProofSignature = 16,
  InvalidStakeAmount = 17,
  BetTokenNotConfigured = 18,
  AlreadyDeposited = 19,
  StakesNotFunded = 20,
  InvalidFeeBps = 21,
  ZkVerifierNotConfigured = 22,
  ZkVerificationFailed = 23,
  ZkProofRequired = 24,
  InvalidSession = 25,
  SessionExpired = 26,
  InvalidSessionConfig = 27,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
  pub player1: Address,
  pub player2: Address,
  pub player1_points: i128,
  pub player2_points: i128,
  pub board_size: u32,
  pub player1_board: Option<Vec<BytesN<32>>>,
  pub player2_board: Option<Vec<BytesN<32>>>,
  pub player1_ship_cells: Option<u32>,
  pub player2_ship_cells: Option<u32>,
  pub player1_hits: u32,
  pub player2_hits: u32,
  pub player1_attacks: Vec<u32>,
  pub player2_attacks: Vec<u32>,
  pub player1_hit_attacks: Vec<u32>,
  pub player2_hit_attacks: Vec<u32>,
  pub turn: Option<Address>,
  pub pending_attacker: Option<Address>,
  pub pending_defender: Option<Address>,
  pub pending_x: Option<u32>,
  pub pending_y: Option<u32>,
  pub winner: Option<Address>,
  pub player1_deposited: bool,
  pub player2_deposited: bool,
  pub payout_processed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionGrant {
  pub expires_ledger: u32,
  pub uses_left: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey { Game(u32), GameHubAddress, Admin, VerifierPubKey, ZkVerifierContract, Session(Address, Address, u32) }

#[contracttype]
#[derive(Clone)]
pub enum ConfigKey { BetToken, FeeRecipient, FeeBps }

const GAME_TTL_LEDGERS: u32 = 518_400;
const DEFAULT_BOARD_SIZE: u32 = 10;
const DEFAULT_SHIP_CELLS: u32 = 17;
const DEFAULT_FEE_BPS: u32 = 500;
const BPS_DENOMINATOR: i128 = 10_000;
const MAX_SESSION_TTL_LEDGERS: u32 = 172_800;
const SESSION_GRANT_TTL_LEDGERS: u32 = 172_800;

#[contract]
pub struct BattleshipContract;

#[contractimpl]
impl BattleshipContract {
  pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().set(&DataKey::GameHubAddress, &game_hub);
    env.storage().instance().set(&ConfigKey::FeeRecipient, &admin);
    env.storage().instance().set(&ConfigKey::FeeBps, &DEFAULT_FEE_BPS);
  }

  pub fn start_game(
    env: Env,
    session_id: u32,
    player1: Address,
    player2: Address,
    player1_points: i128,
    player2_points: i128,
  ) -> Result<(), Error> {
    if player1 == player2 { return Err(Error::NotPlayer); }
    if player1_points < 0 || player2_points < 0 { return Err(Error::InvalidStakeAmount); }

    let is_wager = player1_points > 0 || player2_points > 0;

    player1.require_auth_for_args(vec![&env, session_id.into_val(&env), player1_points.into_val(&env)]);
    player2.require_auth_for_args(vec![&env, session_id.into_val(&env), player2_points.into_val(&env)]);

    let game_hub_addr: Address = env.storage().instance().get(&DataKey::GameHubAddress).expect("GameHub address not set");
    let game_hub = GameHubClient::new(&env, &game_hub_addr);
    game_hub.start_game(&env.current_contract_address(), &session_id, &player1, &player2, &player1_points, &player2_points);

    let game = Game {
      player1, player2, player1_points, player2_points,
      board_size: DEFAULT_BOARD_SIZE,
      player1_board: None, player2_board: None,
      player1_ship_cells: None, player2_ship_cells: None,
      player1_hits: 0, player2_hits: 0,
      player1_attacks: Vec::new(&env), player2_attacks: Vec::new(&env),
      player1_hit_attacks: Vec::new(&env), player2_hit_attacks: Vec::new(&env),
      turn: None, pending_attacker: None, pending_defender: None, pending_x: None, pending_y: None,
      winner: None,
      player1_deposited: !is_wager || player1_points == 0,
      player2_deposited: !is_wager || player2_points == 0,
      payout_processed: !is_wager,
    };

    let key = DataKey::Game(session_id);
    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn commit_board(
    env: Env,
    session_id: u32,
    player: Address,
    cell_commitments: Vec<BytesN<32>>,
    ship_cells: u32,
    board_proof_hash: Option<BytesN<32>>,
    board_proof_signature: Option<BytesN<64>>,
  ) -> Result<(), Error> {
    player.require_auth();
    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary().get(&key).ok_or(Error::GameNotFound)?;
    if game.winner.is_some() { return Err(Error::GameAlreadyEnded); }

    let board_cells = game.board_size.saturating_mul(game.board_size);
    if cell_commitments.len() != board_cells { return Err(Error::InvalidBoardCommitmentLength); }
    if ship_cells == 0 || ship_cells > board_cells { return Err(Error::InvalidShipCount); }
    if is_wager_game(&game) && !(game.player1_deposited && game.player2_deposited) {
      return Err(Error::StakesNotFunded);
    }

    if env.storage().instance().has(&DataKey::ZkVerifierContract) {
      return Err(Error::ZkProofRequired);
    }

    if let Some(verifier_key) = env.storage().instance().get::<DataKey, BytesN<32>>(&DataKey::VerifierPubKey) {
      let proof_hash = board_proof_hash.ok_or(Error::MissingProofSignature)?;
      let proof_signature = board_proof_signature.ok_or(Error::MissingProofSignature)?;
      let commitment_root = compute_commitment_root(&env, &cell_commitments);
      let message = build_board_proof_message(&env, session_id, ship_cells, &commitment_root, &proof_hash);
      env.crypto().ed25519_verify(&verifier_key, &message, &proof_signature);
    }

    apply_board_commit(&mut game, player, cell_commitments, ship_cells)?;

    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn commit_board_zk(
    env: Env,
    session_id: u32,
    player: Address,
    cell_commitments: Vec<BytesN<32>>,
    ship_cells: u32,
    zk_board_proof: Bytes,
  ) -> Result<(), Error> {
    player.require_auth();

    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary().get(&key).ok_or(Error::GameNotFound)?;
    if game.winner.is_some() { return Err(Error::GameAlreadyEnded); }

    let board_cells = game.board_size.saturating_mul(game.board_size);
    if cell_commitments.len() != board_cells { return Err(Error::InvalidBoardCommitmentLength); }
    if ship_cells == 0 || ship_cells > board_cells { return Err(Error::InvalidShipCount); }
    if is_wager_game(&game) && !(game.player1_deposited && game.player2_deposited) {
      return Err(Error::StakesNotFunded);
    }

    let verifier_addr: Address = env
      .storage()
      .instance()
      .get(&DataKey::ZkVerifierContract)
      .ok_or(Error::ZkVerifierNotConfigured)?;
    let verifier = ZkVerifierClient::new(&env, &verifier_addr);
    let commitment_root = compute_commitment_root(&env, &cell_commitments);
    let board_ok = verifier.verify_board(&session_id, &ship_cells, &commitment_root, &zk_board_proof);
    if !board_ok { return Err(Error::ZkVerificationFailed); }

    apply_board_commit(&mut game, player, cell_commitments, ship_cells)?;

    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn attack(env: Env, session_id: u32, attacker: Address, x: u32, y: u32) -> Result<(), Error> {
    require_player_or_session_auth(&env, session_id, &attacker)?;
    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary().get(&key).ok_or(Error::GameNotFound)?;

    if game.winner.is_some() { return Err(Error::GameAlreadyEnded); }
    if is_wager_game(&game) && !(game.player1_deposited && game.player2_deposited) {
      return Err(Error::StakesNotFunded);
    }
    if x >= game.board_size || y >= game.board_size { return Err(Error::InvalidCoordinate); }
    if game.player1_board.is_none() || game.player2_board.is_none() { return Err(Error::BoardsNotReady); }
    if game.pending_attacker.is_some() { return Err(Error::PendingAttackResolution); }

    let turn = game.turn.clone().ok_or(Error::BoardsNotReady)?;
    if attacker != turn { return Err(Error::NotYourTurn); }

    let target_index = y.saturating_mul(game.board_size).saturating_add(x);
    let attacked = if attacker == game.player1 { &game.player1_attacks } else if attacker == game.player2 { &game.player2_attacks } else { return Err(Error::NotPlayer); };
    if contains_u32(attacked, target_index) { return Err(Error::AlreadyAttacked); }

    let defender = if attacker == game.player1 { game.player2.clone() } else { game.player1.clone() };
    game.pending_attacker = Some(attacker);
    game.pending_defender = Some(defender);
    game.pending_x = Some(x);
    game.pending_y = Some(y);

    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn resolve_attack(
    env: Env,
    session_id: u32,
    defender: Address,
    is_ship: bool,
    salt: Bytes,
    zk_proof_hash: BytesN<32>,
    zk_proof_signature: Option<BytesN<64>>,
  ) -> Result<(), Error> {
    require_player_or_session_auth(&env, session_id, &defender)?;
    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary().get(&key).ok_or(Error::GameNotFound)?;

    if game.winner.is_some() { return Err(Error::GameAlreadyEnded); }

    let pending_defender = game.pending_defender.clone().ok_or(Error::NoPendingAttack)?;
    let pending_x = game.pending_x.ok_or(Error::NoPendingAttack)?;
    let pending_y = game.pending_y.ok_or(Error::NoPendingAttack)?;
    if pending_defender != defender { return Err(Error::NotPendingDefender); }

    if env.storage().instance().has(&DataKey::ZkVerifierContract) {
      return Err(Error::ZkProofRequired);
    }

    let target_index = pending_y.saturating_mul(game.board_size).saturating_add(pending_x);
    let board = if defender == game.player1 { game.player1_board.clone().ok_or(Error::BoardsNotReady)? } else if defender == game.player2 { game.player2_board.clone().ok_or(Error::BoardsNotReady)? } else { return Err(Error::NotPlayer); };
    let expected = board.get(target_index).ok_or(Error::InvalidCoordinate)?;

    let mut payload = Bytes::new(&env);
    payload.push_back(if is_ship { 1 } else { 0 });
    payload.append(&salt);
    let computed = env.crypto().keccak256(&payload).to_array();
    if expected != computed { return Err(Error::InvalidCellReveal); }

    let mut proof_payload = Bytes::new(&env);
    proof_payload.push_back(if is_ship { 1 } else { 0 });
    proof_payload.append(&salt);
    append_u32_be(&mut proof_payload, pending_x);
    append_u32_be(&mut proof_payload, pending_y);
    let computed_proof_hash = env.crypto().keccak256(&proof_payload).to_array();
    if zk_proof_hash != computed_proof_hash { return Err(Error::InvalidProofHash); }

    if let Some(verifier_key) = env.storage().instance().get::<DataKey, BytesN<32>>(&DataKey::VerifierPubKey) {
      let proof_signature = zk_proof_signature.ok_or(Error::MissingProofSignature)?;
      let message = build_attack_proof_message(&env, session_id, pending_x, pending_y, is_ship, &zk_proof_hash);
      env.crypto().ed25519_verify(&verifier_key, &message, &proof_signature);
    }

    apply_resolved_attack(&env, session_id, &mut game, target_index, is_ship)?;

    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn resolve_attack_zk(
    env: Env,
    session_id: u32,
    defender: Address,
    zk_attack_proof: Bytes,
  ) -> Result<(), Error> {
    require_player_or_session_auth(&env, session_id, &defender)?;

    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary().get(&key).ok_or(Error::GameNotFound)?;
    if game.winner.is_some() { return Err(Error::GameAlreadyEnded); }

    let pending_defender = game.pending_defender.clone().ok_or(Error::NoPendingAttack)?;
    let pending_x = game.pending_x.ok_or(Error::NoPendingAttack)?;
    let pending_y = game.pending_y.ok_or(Error::NoPendingAttack)?;
    if pending_defender != defender { return Err(Error::NotPendingDefender); }

    let verifier_addr: Address = env
      .storage()
      .instance()
      .get(&DataKey::ZkVerifierContract)
      .ok_or(Error::ZkVerifierNotConfigured)?;

    let target_index = pending_y.saturating_mul(game.board_size).saturating_add(pending_x);
    let board = if defender == game.player1 {
      game.player1_board.clone().ok_or(Error::BoardsNotReady)?
    } else if defender == game.player2 {
      game.player2_board.clone().ok_or(Error::BoardsNotReady)?
    } else {
      return Err(Error::NotPlayer);
    };
    let expected = board.get(target_index).ok_or(Error::InvalidCoordinate)?;

    let verifier = ZkVerifierClient::new(&env, &verifier_addr);
    let is_ship = verifier.verify_attack(&session_id, &pending_x, &pending_y, &expected, &zk_attack_proof);

    apply_resolved_attack(&env, session_id, &mut game, target_index, is_ship)?;

    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn authorize_session(
    env: Env,
    session_id: u32,
    player: Address,
    delegate: Address,
    ttl_ledgers: u32,
    uses_left: u32,
  ) -> Result<(), Error> {
    player.require_auth();

    if delegate == player || ttl_ledgers == 0 || ttl_ledgers > MAX_SESSION_TTL_LEDGERS {
      return Err(Error::InvalidSessionConfig);
    }

    let game_key = DataKey::Game(session_id);
    let game: Game = env.storage().temporary().get(&game_key).ok_or(Error::GameNotFound)?;
    if player != game.player1 && player != game.player2 {
      return Err(Error::NotPlayer);
    }

    let expires_ledger = env.ledger().sequence().saturating_add(ttl_ledgers);
    let session_key = DataKey::Session(player, delegate, session_id);
    let grant = SessionGrant {
      expires_ledger,
      uses_left,
    };

    env.storage().persistent().set(&session_key, &grant);
    extend_session_ttl(&env, &session_key);
    Ok(())
  }

  pub fn revoke_session(env: Env, session_id: u32, player: Address, delegate: Address) -> Result<(), Error> {
    player.require_auth();

    let session_key = DataKey::Session(player, delegate, session_id);
    if !env.storage().persistent().has(&session_key) {
      return Err(Error::InvalidSession);
    }

    env.storage().persistent().remove(&session_key);
    Ok(())
  }

  pub fn get_session(
    env: Env,
    session_id: u32,
    player: Address,
    delegate: Address,
  ) -> Option<SessionGrant> {
    let session_key = DataKey::Session(player, delegate, session_id);
    env.storage().persistent().get(&session_key)
  }

  pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
    let key = DataKey::Game(session_id);
    env.storage().temporary().get(&key).ok_or(Error::GameNotFound)
  }

  pub fn get_admin(env: Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).expect("Admin not set")
  }

  pub fn set_admin(env: Env, new_admin: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().set(&DataKey::Admin, &new_admin);
  }

  pub fn get_hub(env: Env) -> Address {
    env.storage().instance().get(&DataKey::GameHubAddress).expect("GameHub address not set")
  }

  pub fn get_bet_token(env: Env) -> Option<Address> {
    env.storage().instance().get(&ConfigKey::BetToken)
  }

  pub fn set_bet_token(env: Env, token_contract: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().set(&ConfigKey::BetToken, &token_contract);
  }

  pub fn clear_bet_token(env: Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().remove(&ConfigKey::BetToken);
  }

  pub fn get_fee_bps(env: Env) -> u32 {
    env.storage().instance().get(&ConfigKey::FeeBps).unwrap_or(DEFAULT_FEE_BPS)
  }

  pub fn get_fee_recipient(env: Env) -> Address {
    env.storage().instance().get(&ConfigKey::FeeRecipient).expect("Fee recipient not set")
  }

  pub fn set_fee_bps(env: Env, fee_bps: u32) -> Result<(), Error> {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    if fee_bps > 2_000 { return Err(Error::InvalidFeeBps); }
    env.storage().instance().set(&ConfigKey::FeeBps, &fee_bps);
    Ok(())
  }

  pub fn set_fee_recipient(env: Env, recipient: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().set(&ConfigKey::FeeRecipient, &recipient);
  }

  pub fn deposit_stake(env: Env, session_id: u32, player: Address) -> Result<(), Error> {
    player.require_auth();

    let key = DataKey::Game(session_id);
    let mut game: Game = env.storage().temporary().get(&key).ok_or(Error::GameNotFound)?;
    if game.winner.is_some() { return Err(Error::GameAlreadyEnded); }
    if !is_wager_game(&game) { return Ok(()); }

    let amount = if player == game.player1 {
      if game.player1_deposited { return Err(Error::AlreadyDeposited); }
      game.player1_points
    } else if player == game.player2 {
      if game.player2_deposited { return Err(Error::AlreadyDeposited); }
      game.player2_points
    } else {
      return Err(Error::NotPlayer);
    };

    if amount <= 0 {
      if player == game.player1 {
        game.player1_deposited = true;
      } else {
        game.player2_deposited = true;
      }
      env.storage().temporary().set(&key, &game);
      extend_game_ttl(&env, &key);
      return Ok(());
    }

    let token_contract: Address = env.storage().instance().get(&ConfigKey::BetToken).ok_or(Error::BetTokenNotConfigured)?;
    let token_client = token::Client::new(&env, &token_contract);
    let escrow = env.current_contract_address();
    token_client.transfer(&player, &escrow, &amount);

    if player == game.player1 {
      game.player1_deposited = true;
    } else {
      game.player2_deposited = true;
    }

    env.storage().temporary().set(&key, &game);
    extend_game_ttl(&env, &key);
    Ok(())
  }

  pub fn get_verifier(env: Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::VerifierPubKey)
  }

  pub fn get_zk_verifier(env: Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::ZkVerifierContract)
  }

  pub fn set_verifier(env: Env, verifier_pub_key: BytesN<32>) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().set(&DataKey::VerifierPubKey, &verifier_pub_key);
  }

  pub fn clear_verifier(env: Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().remove(&DataKey::VerifierPubKey);
  }

  pub fn set_zk_verifier(env: Env, verifier_contract: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().set(&DataKey::ZkVerifierContract, &verifier_contract);
  }

  pub fn clear_zk_verifier(env: Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().remove(&DataKey::ZkVerifierContract);
  }

  pub fn set_hub(env: Env, new_hub: Address) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.storage().instance().set(&DataKey::GameHubAddress, &new_hub);
  }

  pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Admin not set");
    admin.require_auth();
    env.deployer().update_current_contract_wasm(new_wasm_hash);
  }
}

fn end_game_hub(env: &Env, session_id: u32, player1_won: bool) {
  let game_hub_addr: Address = env.storage().instance().get(&DataKey::GameHubAddress).expect("GameHub address not set");
  let game_hub = GameHubClient::new(env, &game_hub_addr);
  game_hub.end_game(&session_id, &player1_won);
}

fn is_wager_game(game: &Game) -> bool {
  game.player1_points > 0 || game.player2_points > 0
}

fn settle_wager(env: &Env, game: &mut Game) -> Result<(), Error> {
  if game.payout_processed { return Ok(()); }
  if !is_wager_game(game) {
    game.payout_processed = true;
    return Ok(());
  }
  if !game.player1_deposited || !game.player2_deposited { return Err(Error::StakesNotFunded); }

  let winner = game.winner.clone().ok_or(Error::GameAlreadyEnded)?;
  let token_contract: Address = env.storage().instance().get(&ConfigKey::BetToken).ok_or(Error::BetTokenNotConfigured)?;
  let fee_bps: u32 = env.storage().instance().get(&ConfigKey::FeeBps).unwrap_or(DEFAULT_FEE_BPS);
  let fee_recipient: Address = env.storage().instance().get(&ConfigKey::FeeRecipient).expect("Fee recipient not set");

  let total_pot = game.player1_points.saturating_add(game.player2_points);
  let fee_amount = total_pot.saturating_mul(fee_bps as i128) / BPS_DENOMINATOR;
  let winner_amount = total_pot.saturating_sub(fee_amount);

  let token_client = token::Client::new(env, &token_contract);
  let escrow = env.current_contract_address();

  if winner_amount > 0 {
    token_client.transfer(&escrow, &winner, &winner_amount);
  }
  if fee_amount > 0 {
    token_client.transfer(&escrow, &fee_recipient, &fee_amount);
  }

  game.payout_processed = true;
  Ok(())
}

fn apply_board_commit(
  game: &mut Game,
  player: Address,
  cell_commitments: Vec<BytesN<32>>,
  ship_cells: u32,
) -> Result<(), Error> {
  if player == game.player1 {
    if game.player1_board.is_some() { return Err(Error::BoardAlreadyCommitted); }
    game.player1_board = Some(cell_commitments);
    game.player1_ship_cells = Some(ship_cells);
  } else if player == game.player2 {
    if game.player2_board.is_some() { return Err(Error::BoardAlreadyCommitted); }
    game.player2_board = Some(cell_commitments);
    game.player2_ship_cells = Some(ship_cells);
  } else {
    return Err(Error::NotPlayer);
  }

  if game.player1_board.is_some() && game.player2_board.is_some() && game.turn.is_none() {
    game.turn = Some(game.player1.clone());
    if game.player1_ship_cells.is_none() { game.player1_ship_cells = Some(DEFAULT_SHIP_CELLS); }
    if game.player2_ship_cells.is_none() { game.player2_ship_cells = Some(DEFAULT_SHIP_CELLS); }
  }

  Ok(())
}

fn apply_resolved_attack(env: &Env, session_id: u32, game: &mut Game, target_index: u32, is_ship: bool) -> Result<(), Error> {
  let pending_attacker = game.pending_attacker.clone().ok_or(Error::NoPendingAttack)?;

  if pending_attacker == game.player1 {
    game.player1_attacks.push_back(target_index);
    if is_ship {
      game.player1_hits = game.player1_hits.saturating_add(1);
      game.player1_hit_attacks.push_back(target_index);
    }
    game.turn = Some(game.player2.clone());
  } else {
    game.player2_attacks.push_back(target_index);
    if is_ship {
      game.player2_hits = game.player2_hits.saturating_add(1);
      game.player2_hit_attacks.push_back(target_index);
    }
    game.turn = Some(game.player1.clone());
  }

  game.pending_attacker = None;
  game.pending_defender = None;
  game.pending_x = None;
  game.pending_y = None;

  let player1_ship_cells = game.player1_ship_cells.unwrap_or(DEFAULT_SHIP_CELLS);
  let player2_ship_cells = game.player2_ship_cells.unwrap_or(DEFAULT_SHIP_CELLS);
  if game.player1_hits >= player2_ship_cells {
    game.winner = Some(game.player1.clone());
    settle_wager(env, game)?;
    end_game_hub(env, session_id, true);
  } else if game.player2_hits >= player1_ship_cells {
    game.winner = Some(game.player2.clone());
    settle_wager(env, game)?;
    end_game_hub(env, session_id, false);
  }

  Ok(())
}

fn extend_game_ttl(env: &Env, key: &DataKey) {
  env.storage().temporary().extend_ttl(key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
}

fn extend_session_ttl(env: &Env, key: &DataKey) {
  env.storage().persistent().extend_ttl(key, SESSION_GRANT_TTL_LEDGERS, SESSION_GRANT_TTL_LEDGERS);
}

fn require_player_or_session_auth(env: &Env, session_id: u32, player: &Address) -> Result<(), Error> {
  let invoker = env.invoker();

  if invoker == *player {
    player.require_auth();
    return Ok(());
  }

  invoker.require_auth();

  let session_key = DataKey::Session(player.clone(), invoker, session_id);
  let mut grant: SessionGrant = env.storage().persistent().get(&session_key).ok_or(Error::InvalidSession)?;

  if env.ledger().sequence() > grant.expires_ledger {
    env.storage().persistent().remove(&session_key);
    return Err(Error::SessionExpired);
  }

  if grant.uses_left > 0 {
    grant.uses_left = grant.uses_left.saturating_sub(1);
    if grant.uses_left == 0 {
      env.storage().persistent().remove(&session_key);
      return Ok(());
    }
    env.storage().persistent().set(&session_key, &grant);
  }

  extend_session_ttl(env, &session_key);
  Ok(())
}

fn contains_u32(list: &Vec<u32>, value: u32) -> bool {
  let mut index = 0;
  while index < list.len() {
    if list.get(index).unwrap_or_default() == value { return true; }
    index += 1;
  }
  false
}

fn append_u32_be(bytes: &mut Bytes, value: u32) {
  bytes.push_back(((value >> 24) & 0xff) as u8);
  bytes.push_back(((value >> 16) & 0xff) as u8);
  bytes.push_back(((value >> 8) & 0xff) as u8);
  bytes.push_back((value & 0xff) as u8);
}

fn compute_commitment_root(env: &Env, commitments: &Vec<BytesN<32>>) -> BytesN<32> {
  let mut packed = Bytes::new(env);
  let mut index = 0;
  while index < commitments.len() {
    packed.append(&Bytes::from_array(env, &commitments.get(index).unwrap().to_array()));
    index += 1;
  }
  BytesN::from_array(env, &env.crypto().keccak256(&packed).to_array())
}

fn build_board_proof_message(
  env: &Env,
  session_id: u32,
  ship_cells: u32,
  commitment_root: &BytesN<32>,
  proof_hash: &BytesN<32>,
) -> Bytes {
  let mut msg = Bytes::new(env);
  msg.push_back(1u8);
  append_u32_be(&mut msg, session_id);
  append_u32_be(&mut msg, ship_cells);
  msg.append(&Bytes::from_array(env, &commitment_root.to_array()));
  msg.append(&Bytes::from_array(env, &proof_hash.to_array()));
  msg
}

fn build_attack_proof_message(
  env: &Env,
  session_id: u32,
  x: u32,
  y: u32,
  is_ship: bool,
  proof_hash: &BytesN<32>,
) -> Bytes {
  let mut msg = Bytes::new(env);
  msg.push_back(2u8);
  append_u32_be(&mut msg, session_id);
  append_u32_be(&mut msg, x);
  append_u32_be(&mut msg, y);
  msg.push_back(if is_ship { 1 } else { 0 });
  msg.append(&Bytes::from_array(env, &proof_hash.to_array()));
  msg
}
