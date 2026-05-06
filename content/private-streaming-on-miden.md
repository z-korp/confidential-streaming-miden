---
title: "Private payment streams on Miden, without FHE"
subtitle: "How a non-account-based zkVM lets you build Sablier-style streaming where balances, schedules, and counterparties never touch the chain."
---

## The transparency problem with streaming payments

Streaming a salary on Ethereum is a strange experience. Imagine telling your employer: *I want to be paid 8,000 USDC per month, vesting linearly, and I'd prefer that the entire internet not know.* On Sablier or LlamaPay, every dollar of vesting is a public ledger entry. The employer's address, the recipient's address, the cliff, the curve, the amount — anyone can pull the contract storage and reconstruct it byte-for-byte.

This is fine for DAO grants, where transparency is the point. It is uncomfortable for payroll, freelance retainers, family allowances, alimony, treasury vesting, or anything else that a competitor, a journalist, or a curious neighbor might be interested in.

The default fix in the Ethereum world has been *encrypted state*. Use FHE — Zama-style — to keep the balance encrypted on-chain, run the streaming math homomorphically, and never decrypt. It works in principle. In practice you trade gas costs by 2–3 orders of magnitude, you accept a heavyweight cryptographic dependency, and you still leak metadata: the *existence* of an encrypted streaming contract is itself a signal.

Miden takes a different angle. Instead of computing on encrypted public data, it makes most of the data *private to begin with*. This post walks through what that means concretely, by building a Sablier-flavored streaming primitive on Miden and showing exactly which bytes hit the chain and which never do.

## What's structurally different about Miden

Miden is a zkVM-based chain whose user-facing model is closer to Bitcoin than to Ethereum, with smart contracts bolted on. Three properties matter for our purposes.

**Notes are first-class, not accounts.** When Alice wants to send something to Bob in Miden, she does not push a row into a global mapping. She produces a *note*: a self-contained record carrying assets, a script, and some storage. The note exists in the network's note tree until someone consumes it. This is the same mental model as a Bitcoin UTXO, except that each note also carries an arbitrary executable script written in MASM (Miden Assembly).

**Notes can be private.** A *private* note's body — its assets, its script, its storage — never appears on the chain. What hits the chain is a single hash: the note commitment. The network knows that *some* note exists at that commitment, but it cannot tell what's inside, who it's for, or what the script does. Only the parties who already know the note's contents can recompute the commitment and recognize it.

**Execution happens client-side.** When a user wants to consume a note, they run the transaction locally inside Miden's zkVM, produce a STARK proof that the execution was valid, and submit only the proof + a few public outputs to the network. The state transition is verified by the network without the network ever seeing the inputs. The most important public output of a consume transaction is the *nullifier* — a deterministic hash of the consumed note that prevents double-spending — which leaks nothing about what the note contained.

So: private state, client-side execution, succinct proofs. Now let's use those to build something.

## Modeling a stream as N timelocked notes

Sablier-classic gives you a continuous vesting curve. We're going to step back and pick the simplest design that fits Miden's grain: a stream of `T` tokens from sender to recipient, vesting over `D` blocks in `N` discrete tranches, is just `N` private notes.

Each tranche note carries:

- a fungible asset of `T/N` tokens (say, 200 STREAM)
- a custom MASM script enforcing the unlock rule
- three storage words: the recipient ID, the sender ID, and the tranche's `unlock_block`

The opening transaction is a single Miden transaction in which Alice's wallet emits all `N` notes at once. From the outside this looks like one tx producing `N` note commitments. No one observing the chain learns the count means anything, the amounts, the schedule, the recipient, or even that this is a *streaming* product rather than `N` unrelated transfers.

Bob (the recipient) receives the descriptor — the list of note IDs and the metadata he needs to reconstruct each note locally — out of band: a JSON file, a Signal message, an end-to-end-encrypted blob, whatever the application wants. From that moment, he can independently recompute each commitment, ask his Miden client to track them, and consume them one at a time as they unlock.

## The MASM script — three branches

The whole streaming logic lives in a 60-line MASM note script. There are exactly three legal outcomes when somebody tries to consume a tranche:

```
on consume:
  if  caller == recipient && current_block >= unlock_block:
      # the tranche has vested — recipient takes it
      transfer assets to caller's vault
  if  caller == sender    && current_block <  unlock_block:
      # sender is canceling something not yet vested — reclaim path
      transfer assets back to sender's vault
  else:
      # any other combination — abort with a typed error
      assert(false, "stream tranche: caller not eligible")
```

The script reads the executing account's ID from the transaction kernel, reads the current block number, compares them against the values stored in the note, and dispatches. If the script asserts, the entire transaction fails inside the zkVM and produces no proof — the network never even sees the attempt.

Two things are worth pausing on.

First, the recipient's claim and the sender's reclaim are *both* enforced by the same piece of code, executed by the same zkVM, against the same private state. There's no separate "sender contract" and "recipient contract" with subtly different views — there's one note, and whoever consumes it has to satisfy one of the two branches. This is much harder to mess up than the Solidity equivalent, where you would typically have an admin role that could yank funds at any time.

Second, the script never refers to "the stream" as a whole. There is no on-chain object representing the bundle of `N` tranches. From the chain's perspective, those `N` notes are completely independent — they share a script and a tag, but only Alice and Bob know they belong together. If the IRS subpoenas Miden's network operators, there is nothing to hand over.

## What lives on-chain, and what doesn't

| Visible on-chain | Private |
|---|---|
| Note commitments | Asset amounts |
| Nullifiers (after consume) | Sender and recipient account IDs |
| The block in which each note was committed | The unlock schedule |
| The transaction submitter (best-effort obfuscated by the network) | The asset type |
| The fact that *some* note was created | The fact that this particular note belongs to a stream |

A blockchain analytics company building a dashboard for "who is paying whom on Miden" gets, at most, a stream of opaque hashes. They can count notes per block, but they can't decorate them with addresses, amounts, or relationships. The privacy is not built on top of the protocol — it *is* the protocol.

Compare this to the FHE approach. With encrypted on-chain state, the contract address itself is a public identifier. The set of senders and recipients is public. The fact that an encrypted stream exists is public. You've encrypted the *values* but not the *graph*. The graph is usually the more sensitive piece.

## The honest limits of this PoC

A serious production version of this needs to address three things, none of which are theoretical.

**Reference-block manipulation on cancel.** Miden's transaction kernel exposes `tx::get_block_number`, but the value returned is the block the transaction *references*, not the absolute current tip. The transaction submitter can choose this reference block, subject to the constraint that it cannot be in the future. After the unlock has passed, a malicious sender could submit a cancel referencing an older, pre-unlock block, slipping past the script's `block < unlock` guard. The mitigation in Miden 0.14 is to set a *transaction expiration delta* on the tx, which forces the reference block to be recent — we deferred this to v1 to keep the PoC small, but it's a one-line change.

**Off-chain discovery.** Bob has to learn the descriptor somehow. Today our CLI dumps a JSON file under `data/streams/` and the web demo cheats by sharing browser localStorage. A real product needs an encrypted descriptor channel, or a privacy-preserving registry where Bob can poll for "streams addressed to me" without the registry learning who he is. This is solvable — Miden has note tags that can be salted per-recipient — but it's its own design problem.

**Single-client PoC.** In our setup, both Alice's and Bob's wallets live in the same sqlite store on one machine. In a real deployment they're separate processes that exchange the descriptor and then each track only their own side via the client's `notes::import` API. This is mechanical, not architectural — but it does mean our walkthrough is a demo, not a deployment.

## Why this matters

The streaming use case is a stand-in for a much wider class of applications: payroll, royalty splits, pension drips, alimony, recurring B2B invoices. All of them want continuous on-chain transfer with off-chain discretion. On a transparent ledger the only options are *make it public* or *encrypt it expensively*. On Miden the option is *don't put it on the ledger in the first place* — and still keep the integrity, atomicity, and non-custodial properties we get from being on-chain.

The interesting bet, then, is whether private-by-construction execution will turn out to be cheaper, simpler, and more flexible than encrypt-after-the-fact. Building a streaming primitive on Miden took us roughly the same amount of code as a Solidity Sablier port would. The result is structurally private. That's the trade we're making.

## Try it

The code lives in [`confidential-streaming-miden`](https://github.com/zkorp/confidential-streaming-miden). The three commands you need are:

```bash
cd rust-client
cargo run --bin setup    # creates Alice, Bob, the STREAM faucet, mints to Alice
cargo run --bin e2e      # runs both flows (claim happy path + cancel reclaim) with assertions
```

A Next.js demo lives in `web/` if you'd rather click through the flow. The MASM script is in `masm/notes/stream_tranche.masm` — sixty lines, comments included.
