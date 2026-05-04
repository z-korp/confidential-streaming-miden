# Architecture

## Component map

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Sender (Alice)                                │
│  ┌─────────────┐   ┌─────────────────────┐   ┌────────────────────┐    │
│  │ rust-client │   │  miden-client (sdk) │   │ filesystem keystore│    │
│  │   open_*    │──▶│  build N notes      │──▶│ + sqlite store     │    │
│  └─────────────┘   └─────────┬───────────┘   └────────────────────┘    │
│                              │                                          │
│                              ▼  open tx (N output notes, all private)   │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
                               │   ┌──────────────────────────┐
                               └──▶│   Miden testnet (public) │
                                   │   commits + nullifiers   │
                                   └──────────┬───────────────┘
                                              │
                          ┌───────────────────┘
                          │  sync_state(), get_consumable_notes()
                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Recipient (Bob)                                │
│  ┌─────────────┐   ┌─────────────────────┐                             │
│  │ rust-client │   │  miden-client (sdk) │                             │
│  │   claim     │──▶│  consume notes where│                             │
│  └─────────────┘   │  unlock_block ≤ now │                             │
│                    └─────────────────────┘                             │
└────────────────────────────────────────────────────────────────────────┘
```

Off-chain channel (PoC v0): `streams/stream-<id>.json` shared by Alice with Bob.
In the web demo, this channel is just shared `localStorage` because both roles
run in the same browser session.

## Stream descriptor (off-chain)

```json
{
  "id": "0xabc…",
  "sender":    "mlcl1q…",
  "recipient": "mlcl1q…",
  "asset_faucet": "mlcl1q…",
  "tranches": [
    {"index": 0, "note_id": "0x…", "amount": 10, "unlock_block": 12345},
    {"index": 1, "note_id": "0x…", "amount": 10, "unlock_block": 12355},
    …
  ],
  "created_at_block": 12300,
  "total": 100
}
```

## Note script — `stream_tranche.masm`

Storage layout:

| Slot | Word content                                  |
|------|-----------------------------------------------|
| 0    | `[recipient_id_lo, recipient_id_hi, 0, 0]`    |
| 1    | `[sender_id_lo,    sender_id_hi,    0, 0]`    |
| 2    | `[unlock_block,    0,               0, 0]`    |

Pseudocode:

```
on consume:
  acct  ← tx::get_executing_account_id
  block ← tx::get_block_number

  recipient ← active_note::get_storage(0)
  sender    ← active_note::get_storage(1)
  unlock    ← active_note::get_storage(2).0

  if (acct == recipient) and (block >= unlock):
      wallet::add_assets_to_account
  elif (acct == sender) and (block < unlock):
      wallet::add_assets_to_account
  else:
      assert.err=ERROR_NOT_ELIGIBLE 0
```

## State machine — single tranche

```
        ┌──────────┐  block≥unlock & consumer=recipient
        │  PENDING │ ────────────────────────────────────▶ CLAIMED  (recipient holds the asset)
        └─────┬────┘
              │  block<unlock & consumer=sender
              └──────────────────────────────────────────▶ CANCELLED (sender reclaimed)
```

The tranche is "live" only while `block < unlock`; after `unlock`, sender can
no longer cancel that tranche.

## Privacy guarantees

| Property | Guaranteed by |
|---|---|
| Amount confidential | Note created with `NoteType::Private` — only the recipient hash and a commitment are public. |
| Recipient confidential | Same, plus discovery tag chosen to not leak identity (random per stream). |
| Sender confidential | Tx prover obfuscation + private note. |
| Schedule confidential | `unlock_block` is in note storage which is private. |
| Cancellation unobservable as such | Reclaim tx looks like any other note consumption. |
| Forward-secrecy after consumption | Nullifier reveals only that *some* note was consumed — content stays private. |

## Known limitation: reference-block selection

Miden's `tx::get_block_number` returns the **transaction reference block**,
which the executor *picks* — it cannot be in the future, but it can be
arbitrarily old. The
[`get_block_timestamp` doc-comment in `miden-base`](https://github.com/0xMiden/miden-base/blob/next/crates/miden-protocol/asm/protocol/tx.masm)
spells out the implication:

> consider a script that includes a "time boundary", where before time 10
> account X can consume the note and after time 10 another account Y can
> consume the note. Even if the latest block in the chain is at time 11,
> the owner of account X can choose to create a transaction referencing
> the block at time 5 and still consume the note […]

For our streaming script, the consequence is:

- A sender attempting `cancel` after `unlock_block` can construct the tx
  with a reference block from *before* the unlock and the script's
  `block < unlock` branch will pass. The recipient's "exclusive ownership
  after unlock" is therefore advisory under default settings.
- The recipient's claim path is symmetric: they cannot reach into the
  future, so they cannot claim before unlock by manipulating the reference
  block. The leak is one-directional and only benefits the sender.

**Mitigation (deferred):** set a transaction expiration delta when
submitting the cancel — the protocol then rejects reference blocks older
than `current - delta`. With a small delta the cancel-after-unlock window
shrinks to a few blocks, after which the recipient is the only consumer
that can satisfy the script.

## CLI vs. web semantics

| Aspect | CLI | Web |
|---|---|---|
| Note script | Custom MASM | Standard P2IDE |
| Reclaim | `block < unlock` only | Always (race after unlock) |
| Strictness | Reference impl | Demo simplification |

The web demo accepts the race so it can rely on Miden's standard P2IDE
note (`Note.createP2IDENote`) — no custom MASM is shipped to the browser,
WASM bundle stays small. The CLI ships the strict semantics via the
custom MASM in `masm/notes/stream_tranche.masm`.

## Off-chain stream descriptor channel

Notes here are private — only commitments are public — so the recipient
must learn of a stream's existence and details out-of-band:

- **CLI**: sender writes `data/streams/stream-<id>.json` and shares it
  (any channel: file copy, encrypted DM, etc.). Recipient places it under
  the same path locally; `claim` looks it up.
- **Web demo**: both roles live in the same browser session; the
  descriptor is persisted to `localStorage` under `csm.streams.v1`. There
  is no real network handoff in this PoC.
- **Product evolution (v3)**: encrypt the descriptor under recipient's
  public key and post it to a privacy-respecting bulletin board (e.g. the
  recipient subscribes to a per-stream tag derived from a shared secret).

## Out of scope (v0)

- Continuous vesting (v1, Option B custom account).
- Recipient discovery without off-chain handoff (see channel section above).
- Multi-asset / NFT streams.
- Frontend wallet (relies on the SDK's built-in keystore + sqlite store in CLI, IndexedDB in web).
- Transaction expiration deltas to harden the reference-block window.
