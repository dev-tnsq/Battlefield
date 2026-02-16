#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAdmin = 1,
    VerifierNotConfigured = 2,
    InvalidProofLength = 3,
    InvalidHitFlag = 4,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    VerifierPubKey,
}

#[contract]
pub struct NoirVerifierContract;

#[contractimpl]
impl NoirVerifierContract {
    pub fn __constructor(env: Env, admin: Address, _game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn set_verifier(env: Env, verifier_pub_key: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::VerifierPubKey, &verifier_pub_key);
    }

    pub fn clear_verifier(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        admin.require_auth();
        env.storage().instance().remove(&DataKey::VerifierPubKey);
    }

    pub fn get_verifier(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::VerifierPubKey)
    }

    pub fn verify_board(
        env: Env,
        session_id: u32,
        ship_cells: u32,
        commitment_root: BytesN<32>,
        proof: Bytes,
    ) -> bool {
        let verifier_key: BytesN<32> = match env.storage().instance().get(&DataKey::VerifierPubKey) {
            Some(v) => v,
            None => return false,
        };

        if proof.len() != 64 {
            return false;
        }

        let signature = match bytes_to_sig64(&proof) {
            Some(sig) => sig,
            None => return false,
        };

        let mut message = Bytes::new(&env);
        message.push_back(1u8);
        append_u32_be(&mut message, session_id);
        append_u32_be(&mut message, ship_cells);
        message.append(&Bytes::from_array(&env, &commitment_root.to_array()));

        env.crypto().ed25519_verify(&verifier_key, &message, &signature);
        true
    }

    pub fn verify_attack(
        env: Env,
        session_id: u32,
        x: u32,
        y: u32,
        expected_commitment: BytesN<32>,
        proof: Bytes,
    ) -> bool {
        let verifier_key: BytesN<32> = match env.storage().instance().get(&DataKey::VerifierPubKey) {
            Some(v) => v,
            None => return false,
        };

        if proof.len() != 65 {
            return false;
        }

        let is_ship = proof.get(0).unwrap_or(2);
        if is_ship > 1 {
            return false;
        }

        let signature = match proof_tail_to_sig64(&proof) {
            Some(sig) => sig,
            None => return false,
        };

        let mut message = Bytes::new(&env);
        message.push_back(2u8);
        append_u32_be(&mut message, session_id);
        append_u32_be(&mut message, x);
        append_u32_be(&mut message, y);
        message.append(&Bytes::from_array(&env, &expected_commitment.to_array()));
        message.push_back(is_ship);

        env.crypto().ed25519_verify(&verifier_key, &message, &signature);
        is_ship == 1
    }
}

fn append_u32_be(bytes: &mut Bytes, value: u32) {
    bytes.push_back(((value >> 24) & 0xff) as u8);
    bytes.push_back(((value >> 16) & 0xff) as u8);
    bytes.push_back(((value >> 8) & 0xff) as u8);
    bytes.push_back((value & 0xff) as u8);
}

fn bytes_to_sig64(bytes: &Bytes) -> Option<BytesN<64>> {
    if bytes.len() != 64 {
        return None;
    }
    let mut raw = [0u8; 64];
    let mut i = 0;
    while i < 64 {
        raw[i] = bytes.get(i as u32).unwrap_or(0);
        i += 1;
    }
    Some(BytesN::from_array(bytes.env(), &raw))
}

fn proof_tail_to_sig64(bytes: &Bytes) -> Option<BytesN<64>> {
    if bytes.len() != 65 {
        return None;
    }
    let mut raw = [0u8; 64];
    let mut i = 0;
    while i < 64 {
        raw[i] = bytes.get((i + 1) as u32).unwrap_or(0);
        i += 1;
    }
    Some(BytesN::from_array(bytes.env(), &raw))
}
