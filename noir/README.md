# Noir Circuits for Battleship

This folder contains Noir circuits for the Battleship privacy flow.

## Circuits

- `circuits/board_commitment`: proves board is binary, ship count matches expected total, and each commitment is consistent with board/salt/index relation.
- `circuits/attack_resolution`: proves hit/miss correctness for a targeted cell and commitment consistency with board/salt/coordinate relation.

## Intended onchain flow

1. Player commits board cell hashes onchain via `commit_board`.
2. During play, attacker submits `attack`.
3. Defender resolves using proof output + public inputs through `resolve_attack`.

The contract consumes `zk_proof_hash` in `resolve_attack` to validate the reveal payload against attack coordinates.
