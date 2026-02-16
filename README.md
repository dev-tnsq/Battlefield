# Stellar Battleship (Hackathon Build)

This repository is trimmed to a Battleship-only implementation for the Stellar ZK game hackathon.

## Included

- `contracts/battleship` (Soroban onchain game contract)
- `battleship-frontend` (standalone frontend wired to Battleship contract)
- `bindings/battleship` (generated TypeScript contract bindings)
- `noir/` (Noir circuits for board commitment and attack resolution)

## Quickstart

```bash
bun install
bun run setup
bun run build battleship
bun run deploy battleship
bun run bindings battleship

# Noir prover + verifier (privacy attestation mode)
bun run prover:init      # generate prover key + env values
bun run prover:set       # set verifier pubkey on battleship contract (admin)
bun run prover:set-fee   # set fee bps from BATTLESHIP_FEE_BPS (default 500)
# export BET_TOKEN_CONTRACT_ID=<SAC token contract id>
bun run prover:set-bet-token  # set wager escrow token contract
## Optional (next phase): set trustless zk verifier contract on battleship
# export NOIR_ZK_VERIFIER_CONTRACT_ID=<your zk verifier contract id>
# bun run prover:set-zk
bun run prover:dev       # run local prover API at VITE_NOIR_PROVER_URL

bun run dev

# Optional runtime verification (2-player on-chain smoke)
bun --cwd=battleship-frontend run smoke:onchain
```

## Verifier Troubleshooting

- If `bun run prover:set` fails with `txBadAuth`, your local admin secret does not match the deployed contract admin.
- Run `bun run deploy battleship` to refresh admin keys and update `.env`, then rerun `bun run prover:set`.
- Ensure `.env` contains `VITE_DEV_ADMIN_ADDRESS`, `VITE_DEV_ADMIN_SECRET`, `NOIR_VERIFIER_PUBKEY_HEX`, and `VITE_NOIR_PROVER_URL`.

## Player Playbook (End-User Flow)

1. In terminal A (from `stellar-game-studio`): `bun run prover:dev`
2. In terminal B (from `stellar-game-studio`): `bun run dev`
3. Open app in two browser sessions (or two devices), connect two different wallets.
4. Player 1 chooses **Invite Friend**, enables **On-chain**, sets Player 2 wallet address, then generates invite link.
5. Player 2 opens invite link, connects the invited wallet, continues setup, and starts placement.
6. Both players place ships and commit; then attack/resolve turns proceed on-chain.

## Linked Status

- Frontend ↔ contract flow is linked for invite/join/start/commit/attack/resolve.
- Invite join now validates contract deployment match and intended Player 2 wallet.
- Contract verifier key is set and frontend requests prover signatures when verifier mode is enabled.
- Wager mode now supports on-chain escrow deposit + winner payout + protocol fee split in the Battleship contract.

## Noir / Privacy Model

- Current implementation is **verifier-attested integrity**, not full trustless on-chain ZK verification.
- Prover signs board/attack proof hashes, and contract verifies those signatures.
- `resolve_attack` still includes `is_ship` + `salt` reveal to satisfy commitment checks on-chain.
- Result: anti-cheat guarantees are strong, but strict hidden-cell privacy is not fully achieved yet.

## Trustless ZK Migration Hooks

- Battleship contract now exposes trustless verifier hooks: `get_zk_verifier`, `set_zk_verifier`, `clear_zk_verifier`.
- Admin commands are available: `bun run prover:set-zk` and `bun run prover:clear-zk`.
- These hooks let you attach a dedicated on-chain Noir verifier contract in the next phase.
- Full trustless privacy requires implementing that verifier contract and replacing `is_ship/salt` public reveal flow in `resolve_attack`.

## Multiplayer Scope

- Battleship contract session is strictly **2 players per game** (`player1`, `player2`).
- Multi-game tournaments/lobbies can be orchestrated externally via Game Hub sessions.

## Game Hub Requirement

The contract integrates with Stellar Game Hub lifecycle:
- `start_game()` on session start
- `end_game()` on winner finalization

Game Hub testnet contract:
`CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

## ZK Status

- Onchain contract verifies both per-cell commitment and attack proof hash in `resolve_attack`.
- Noir circuits in `noir/circuits/*` mirror the commitment/resolution constraints used by the game flow.
