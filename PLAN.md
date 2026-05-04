# Plan — confidential-streaming-miden

## Vision

Bring Sablier-style continuous payment streams to **Miden**, leveraging
Miden's native privacy primitives instead of FHE. The on-chain observer should
not learn the amount streamed, the schedule, the parties, or the very fact that
a specific stream exists.

## Locked decisions (v0)

| Topic | Decision |
|---|---|
| Architecture | **Option A** — chain of `N` private time-locked + reclaimable notes |
| Network | Miden testnet (public) |
| Operations | `open`, `claim`, `cancel` |
| Token | `STREAM` faucet created by the PoC `setup` command |
| Frontend | Next.js 15 + React 19 + `@miden-sdk/miden-sdk` 0.14.5 + Tailwind 4 |
| Off-chain handoff | localStorage shared in browser session (sender ↔ recipient roles toggleable in same UI) |
| Granularity | Discrete tranches (e.g. `N=10`); continuous vesting deferred to v1 |

### Note-script backing (CLI vs web)

| Side | Note script | Cancel semantics |
|---|---|---|
| `rust-client/` | Custom MASM (`masm/notes/stream_tranche.masm`) | Sender can reclaim only **before** unlock; after unlock, recipient has exclusive rights. |
| `web/` | Standard **P2IDE** (`createP2IDENote` / `transactions.send` with `timelockUntil`/`reclaimAfter`) | Sender can reclaim **any unclaimed** tranche at any time (`reclaimAfter: 0`). Race condition with recipient after unlock. |

The web demo trades exact semantics for zero MASM at build time — it's the smallest possible UI that exercises private timelocked notes on testnet. The Rust CLI is the reference implementation of the strict streaming semantics.

## Why Option A first

Option A maps directly to Miden's UTXO model: a script-controlled private note
is the *natural* primitive. No custom account code is required, the privacy
properties are maximal, and the script is small enough to audit by eye.

Option B (a custom "Stream" account holding the bundle) gives continuous
vesting and a single source of truth, but requires custom account procedures
and exposes the stream account itself as an entity (even if its storage is
private). Deferred.

## Note script semantics

Each tranche note has storage:

| Slot | Word                                            |
|------|-------------------------------------------------|
| 0    | `recipient_id`                                  |
| 1    | `sender_id`                                     |
| 2    | `unlock_block` (in slot.0; rest = 0)            |

On consume:
1. Read executing account id from tx kernel.
2. Read current block number from tx kernel.
3. Branch:
   - `acct == recipient && block >= unlock` → `wallet::add_assets_to_account`
   - `acct == sender    && block <  unlock` → `wallet::add_assets_to_account` (reclaim path)
   - otherwise → `assert(0)` with a typed error

## Open flow

1. Sender chooses `(recipient_id, total, start_block, end_block, N)`.
2. Compute `tranche_amount = total / N` (round-down; remainder added to last tranche).
3. Compute `unlock_block_i = start_block + i * (end_block - start_block) / N` for `i in 1..=N`.
4. Build `N` `Note`s, all carrying the same script + storage template (only `unlock_block` differs), assets = `tranche_amount` of `STREAM`.
5. Submit a single transaction with all `N` notes as own_output_notes.
6. Persist `stream-<id>.json` locally with the list of note IDs and unlock schedule, share with recipient.

## Claim flow (recipient)

1. Read `stream-<id>.json`.
2. `client.sync_state()`; query consumable notes filtered by stream tag.
3. For each note where `unlock_block <= current_block` and not yet claimed → submit consume tx.

## Cancel flow (sender)

1. Read `stream-<id>.json`.
2. `client.sync_state()`; for each note still un-nullified where `current_block < unlock_block` → submit consume tx (reclaim path).

## Privacy model

| Visible on-chain | Private (off-chain) |
|---|---|
| Note commitments | Amounts |
| Nullifier on consumption | Recipient & sender ids |
| Tx submitter (best-effort obfuscated by Miden) | Unlock schedule |
| Block in which note was created | Asset type |

## Known limitations carried into v0

- **Reference-block manipulation on `cancel`** — the executor picks the
  transaction's reference block; it can be older than the tip. A sender
  can therefore submit a cancel after `unlock_block` referencing a
  pre-unlock block, slipping through the `block < unlock` branch.
  Mitigation (v1): set a transaction expiration delta. See
  [`ARCHITECTURE.md`](./ARCHITECTURE.md#known-limitation-reference-block-selection).
- **No on-chain discovery** — recipient learns of the stream via an
  out-of-band JSON descriptor. v0 channel is local file (CLI) or shared
  `localStorage` (web). Product-grade channel deferred to v3.
- **Single-client PoC** — sender and recipient share the same Miden
  client / store. Multi-process deployment requires `client.notes.import`
  on the recipient side; deferred.

## Roadmap

- **v0 (this PoC)** — Option A, CLI + minimal Next.js, single-asset, discrete tranches.
- **v1** — Option B (vesting account), continuous vesting, cliffs, transaction expiration delta hardening.
- **v2** — Multi-asset streams, NFT-streams.
- **v3** — Privacy-preserving discovery channel (encrypted descriptor + per-stream tag) so the recipient doesn't need an out-of-band handoff.
