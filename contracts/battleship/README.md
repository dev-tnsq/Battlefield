# Battleship Contract (Soroban)

This contract implements a two-player Battleship flow on Stellar with Game Hub lifecycle integration.

## Onchain Flow

1. `start_game` initializes a session and calls Game Hub `start_game`.
2. Each player calls `commit_board` with 100 cell commitments and ship-cell count.
3. Attacker calls `attack(x, y)` on their turn.
4. Defender calls `resolve_attack(is_ship, salt, zk_proof_hash)` for the pending target.
5. Contract updates hit counters and ends via Game Hub `end_game` when all ship cells are hit.

## Core Methods

- `start_game(session_id, player1, player2, player1_points, player2_points)`
- `commit_board(session_id, player, cell_commitments, ship_cells)`
- `attack(session_id, attacker, x, y)`
- `resolve_attack(session_id, defender, is_ship, salt, zk_proof_hash)`
- `get_game(session_id)`

## Notes

- Storage uses temporary entries with 30-day TTL extension on writes.
- Turn order starts with `player1` once both boards are committed.
- `zk_proof_hash` is currently a verifier hook for Noir integration.

## Build & Test

```bash
bun run build battleship
cargo test -p battleship
```
