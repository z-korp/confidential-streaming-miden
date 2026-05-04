# confidential-streaming-miden

Sablier-style payment streams on **Miden** — with native confidentiality.

Unlike FHE-based confidential streaming (where balances are encrypted on-chain),
Miden achieves confidentiality through its **private UTXO note model**: only
cryptographic commitments live on-chain, while stream amounts, parties and
unlock schedules stay off-chain between sender and recipient.

## How it works (PoC v0)

A **stream** of `T` tokens from sender → recipient over `D` blocks is materialised
as `N` **private notes** emitted in a single transaction. Each note carries
`T/N` tokens and a custom MASM script enforcing:

```
on consume:
  if  consumer == recipient && current_block >= unlock_block  → release to recipient
  if  consumer == sender    && current_block <  unlock_block  → reclaim to sender
  else                                                         → abort
```

The recipient claims tranches one by one as time passes. The sender can cancel
at any point and reclaim every tranche not yet unlocked.

On-chain footprint: just commitments + nullifiers. No-one outside the two
parties can see the amount, schedule, or even the existence of a specific stream.

## Layout

```
masm/notes/        # MASM note scripts
rust-client/       # CLI: setup / open / claim / cancel / status
web/               # Next.js 15 single-page UI for the demo
```

## Quickstart (CLI)

```bash
cd rust-client
cargo run --bin setup           # creates Alice, Bob, STREAM faucet, mints to Alice
cargo run --bin open_stream     # Alice opens a stream to Bob
cargo run --bin status          # shows local stream state
cargo run --bin claim           # Bob claims unlocked tranches
cargo run --bin cancel          # Alice cancels remaining locked tranches
```

## Quickstart (Web)

```bash
cd web && pnpm install && pnpm dev   # http://localhost:3000
```

## CLI vs Web — what differs and why

Both targets implement the same `open / claim / cancel` flow against
testnet, but they back the tranche note differently:

| Aspect | `rust-client/` (CLI) | `web/` (Next.js demo) |
|---|---|---|
| Note script | Custom MASM (`masm/notes/stream_tranche.masm`) | Standard **P2IDE** via `Note.createP2IDENote` |
| Sender reclaim | Allowed **only before** `unlock_block` — exclusive recipient ownership after | Allowed **anytime** (`reclaimAfter: 0`) — sender races recipient after unlock |
| Build-time cost | Compiles MASM script in-process | No MASM compilation, smaller WASM bundle |
| Reference impl | Yes, this is the strict streaming semantics | Demo simplification; race condition is acceptable for UX walkthrough |

The CLI is the canonical implementation of "vested ⇒ recipient owns it
forever". The web target trades exact semantics for the smallest possible
UI exercising private timelocked notes in the browser.

## Known limitations (PoC v0)

1. **Reference-block manipulation** — Miden's `tx::get_block_timestamp` /
   `get_block_number` exposes the *transaction reference block*, which the
   executor can choose. They cannot pick a future block, but they **can**
   pick an older one. A motivated sender could attempt a cancel after
   `unlock_block` by referencing a block from before the unlock, defeating
   the script's branch guard. Mitigation, deferred to v1: set a transaction
   expiration delta so reference blocks must be recent. See the upstream
   warning in
   [`miden-base` / `protocol/tx.masm` → `get_block_timestamp`](https://github.com/0xMiden/miden-base/blob/next/crates/miden-protocol/asm/protocol/tx.masm).
2. **No on-chain discovery** — recipient learns of a stream out-of-band:
   the CLI dumps a JSON descriptor under `data/streams/` that sender shares
   with recipient; the web demo keeps both roles in the same browser
   session and uses `localStorage` as the channel. A real product would
   need either a privacy-preserving registry, encrypted note transport,
   or a known per-recipient discovery tag.
3. **Sender and recipient share a client** — for the PoC, both accounts
   live in the same Miden client / sqlite store / IndexedDB. In a real
   deployment they'd be separate processes that exchange the descriptor
   and then each track only their own side of the stream
   (`client.notes.import` for the recipient).
4. **Discrete tranches only** — vesting jumps at each `unlock_block`. A
   continuous-vesting stream (Sablier-classic) needs Option B (a custom
   "stream account"); deferred to v1, see [`PLAN.md`](./PLAN.md).

## Docs

- [`PLAN.md`](./PLAN.md) — design decisions, scope, roadmap
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — note script, tx flow, privacy model
