#![cfg(test)]

use crate::{BattleshipContract, BattleshipContractClient, Error};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};

#[contract]
pub struct TestGameHub;

#[contractimpl]
impl TestGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}

    pub fn add_game(_env: Env, _game_address: Address) {}
}

fn setup_test() -> (
    Env,
    BattleshipContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register(TestGameHub, ());
    let game_hub = TestGameHubClient::new(&env, &hub_addr);

    let admin = Address::generate(&env);
    let contract_id = env.register(BattleshipContract, (&admin, &hub_addr));
    let client = BattleshipContractClient::new(&env, &contract_id);

    game_hub.add_game(&contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, player1, player2, hub_addr)
}

fn commit_for(env: &Env, is_ship: bool) -> [u8; 32] {
    let mut payload = Bytes::new(env);
    payload.push_back(if is_ship { 1 } else { 0 });
    payload.append(&Bytes::from_array(env, &[9u8; 32]));
    env.crypto().keccak256(&payload).to_array()
}

fn build_board(env: &Env, board_size: u32, ship_indexes: &[u32]) -> Vec<BytesN<32>> {
    let mut board = Vec::new(env);
    let total = board_size * board_size;
    let hit = commit_for(env, true);
    let miss = commit_for(env, false);

    for i in 0..total {
        let mut is_ship = false;
        let mut idx = 0usize;
        while idx < ship_indexes.len() {
            if ship_indexes[idx] == i {
                is_ship = true;
                break;
            }
            idx += 1;
        }
        if is_ship {
            board.push_back(BytesN::from_array(env, &hit));
        } else {
            board.push_back(BytesN::from_array(env, &miss));
        }
    }

    board
}

fn proof_hash_for(env: &Env, is_ship: bool, x: u32, y: u32) -> [u8; 32] {
    let mut payload = Bytes::new(env);
    payload.push_back(if is_ship { 1 } else { 0 });
    payload.append(&Bytes::from_array(env, &[9u8; 32]));
    payload.push_back(((x >> 24) & 0xff) as u8);
    payload.push_back(((x >> 16) & 0xff) as u8);
    payload.push_back(((x >> 8) & 0xff) as u8);
    payload.push_back((x & 0xff) as u8);
    payload.push_back(((y >> 24) & 0xff) as u8);
    payload.push_back(((y >> 16) & 0xff) as u8);
    payload.push_back(((y >> 8) & 0xff) as u8);
    payload.push_back((y & 0xff) as u8);
    env.crypto().keccak256(&payload).to_array()
}

fn assert_contract_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected_error: Error,
) {
    match result {
        Err(Ok(actual_error)) => {
            assert_eq!(*actual_error, expected_error);
        }
        _ => panic!("Expected {:?}", expected_error),
    }
}

#[test]
fn test_start_commit_attack_resolve() {
    let (env, client, player1, player2, _hub_addr) = setup_test();

    let session_id = 77u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let board_size = 10;
    let p1_board = build_board(&env, board_size, &[0, 1, 2]);
    let p2_board = build_board(&env, board_size, &[0, 5, 10]);

    client.commit_board(&session_id, &player1, &p1_board, &3, &None, &None);
    client.commit_board(&session_id, &player2, &p2_board, &3, &None, &None);

    let game = client.get_game(&session_id);
    assert!(game.turn.is_some());
    assert_eq!(game.turn.unwrap(), player1);

    client.attack(&session_id, &player1, &0, &0);

    let salt = Bytes::from_array(&env, &[9u8; 32]);
    client.resolve_attack(
        &session_id,
        &player2,
        &true,
        &salt,
        &BytesN::from_array(&env, &proof_hash_for(&env, true, 0, 0)),
        &None,
    );

    let updated = client.get_game(&session_id);
    assert_eq!(updated.player1_hits, 1);
    assert!(updated.pending_attacker.is_none());
    assert_eq!(updated.turn.unwrap(), player2);
}

#[test]
fn test_reject_duplicate_attack() {
    let (env, client, player1, player2, _hub_addr) = setup_test();

    let session_id = 88u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let board_size = 10;
    let p1_board = build_board(&env, board_size, &[0, 1, 2]);
    let p2_board = build_board(&env, board_size, &[0, 5, 10]);

    client.commit_board(&session_id, &player1, &p1_board, &3, &None, &None);
    client.commit_board(&session_id, &player2, &p2_board, &3, &None, &None);

    let salt = Bytes::from_array(&env, &[9u8; 32]);

    client.attack(&session_id, &player1, &0, &0);
    client.resolve_attack(
        &session_id,
        &player2,
        &true,
        &salt,
        &BytesN::from_array(&env, &proof_hash_for(&env, true, 0, 0)),
        &None,
    );

    client.attack(&session_id, &player2, &0, &0);
    client.resolve_attack(
        &session_id,
        &player1,
        &true,
        &salt,
        &BytesN::from_array(&env, &proof_hash_for(&env, true, 0, 0)),
        &None,
    );

    let err = client.try_attack(&session_id, &player1, &0, &0);
    assert_contract_error(&err, Error::AlreadyAttacked);
}

#[test]
fn test_invalid_reveal_fails() {
    let (env, client, player1, player2, _hub_addr) = setup_test();

    let session_id = 99u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let board_size = 10;
    let p1_board = build_board(&env, board_size, &[0, 1, 2]);
    let p2_board = build_board(&env, board_size, &[0, 5, 10]);

    client.commit_board(&session_id, &player1, &p1_board, &3, &None, &None);
    client.commit_board(&session_id, &player2, &p2_board, &3, &None, &None);

    client.attack(&session_id, &player1, &0, &0);

    let bad_salt = Bytes::from_array(&env, &[7u8; 32]);
    let err = client.try_resolve_attack(
        &session_id,
        &player2,
        &true,
        &bad_salt,
        &BytesN::from_array(&env, &proof_hash_for(&env, true, 0, 0)),
        &None,
    );
    assert_contract_error(&err, Error::InvalidCellReveal);
}

#[test]
fn test_invalid_proof_hash_fails() {
    let (env, client, player1, player2, _hub_addr) = setup_test();

    let session_id = 101u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let board_size = 10;
    let p1_board = build_board(&env, board_size, &[0, 1, 2]);
    let p2_board = build_board(&env, board_size, &[0, 5, 10]);

    client.commit_board(&session_id, &player1, &p1_board, &3, &None, &None);
    client.commit_board(&session_id, &player2, &p2_board, &3, &None, &None);

    client.attack(&session_id, &player1, &0, &0);

    let salt = Bytes::from_array(&env, &[9u8; 32]);
    let err = client.try_resolve_attack(
        &session_id,
        &player2,
        &true,
        &salt,
        &BytesN::from_array(&env, &[9u8; 32]),
        &None,
    );
    assert_contract_error(&err, Error::InvalidProofHash);
}

#[test]
fn test_zk_verifier_admin_config() {
    let (env, client, _player1, _player2, _hub_addr) = setup_test();

    assert!(client.get_zk_verifier().is_none());

    let zk_contract = Address::generate(&env);
    client.set_zk_verifier(&zk_contract);
    assert_eq!(client.get_zk_verifier().unwrap(), zk_contract);

    client.clear_zk_verifier();
    assert!(client.get_zk_verifier().is_none());
}
