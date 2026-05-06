//! End-to-end test against Miden testnet.
//!
//! Requires `cargo run --bin setup` to have been run first (so ./data/accounts.json
//! exists and Alice already holds STREAM tokens).
//!
//! Runs two scenarios in sequence:
//!   1. claim happy path — open a short-window stream, wait for all tranches to
//!      unlock, Bob claims them all in one tx, assert balance deltas.
//!   2. cancel reclaim path — open a future-locked stream, Alice cancels every
//!      tranche before any unlocks, assert Alice's balance is unchanged.

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use confidential_streaming_rust_client::{
    balance, build_client, cancel_descriptor, claim_descriptor, current_block, open_stream,
    wait_for_block, AccountsFile, OpenStreamParams, TrancheStatus,
};

const POLL: Duration = Duration::from_secs(3);

#[tokio::main]
async fn main() -> Result<()> {
    let (mut client, _ks) = build_client().await?;
    let accounts = AccountsFile::load().context("./data/accounts.json — run `setup` first")?;
    let alice = accounts.alice()?;
    let bob = accounts.bob()?;
    let faucet = accounts.faucet()?;

    let start_block = current_block(&mut client).await?;
    let alice_start = balance(&client, alice, faucet).await?;
    let bob_start = balance(&client, bob, faucet).await?;
    println!("starting at block {start_block}");
    println!("  Alice STREAM = {alice_start}");
    println!("  Bob   STREAM = {bob_start}");

    // ----- scenario 1: claim happy path ------------------------------------
    println!("\n=== scenario 1: claim happy path ===");
    let total_a = 1_000;
    let mut desc_a = open_stream(
        &mut client,
        &accounts,
        OpenStreamParams {
            total: total_a,
            tranches: 5,
            duration: 10,
            start_offset: 1,
        },
    )
    .await?;
    println!(
        "opened stream {} ({} tranches, last unlock @ block {})",
        desc_a.id,
        desc_a.tranches.len(),
        desc_a.tranches.last().unwrap().unlock_block,
    );

    // Alice's vault should already reflect the locked-up tokens.
    let alice_after_open = balance(&client, alice, faucet).await?;
    assert_eq!(
        alice_start - alice_after_open,
        total_a,
        "Alice should have {total_a} STREAM moved into the tranche notes"
    );

    let last_unlock = desc_a.tranches.last().unwrap().unlock_block;
    println!("waiting for block {last_unlock}…");
    wait_for_block(&mut client, last_unlock + 1, POLL).await?;

    let claimed = claim_descriptor(&mut client, &mut desc_a, bob).await?;
    assert_eq!(claimed, 5, "all 5 tranches should have been claimed in one tx");
    assert!(
        desc_a.tranches.iter().all(|t| t.status == TrancheStatus::Claimed),
        "every tranche should be marked Claimed"
    );

    // Settle so the balance read is post-consume.
    for _ in 0..5 {
        client.sync_state().await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    let alice_after_claim = balance(&client, alice, faucet).await?;
    let bob_after_claim = balance(&client, bob, faucet).await?;
    assert_eq!(
        bob_after_claim - bob_start,
        total_a,
        "Bob should have gained {total_a} STREAM"
    );
    assert_eq!(
        alice_after_claim, alice_after_open,
        "Alice's balance should not have moved during claim"
    );
    println!("  ✓ Bob received {total_a} STREAM, Alice unchanged after claim");

    // ----- scenario 2: cancel reclaim path ---------------------------------
    println!("\n=== scenario 2: cancel reclaim path ===");
    let total_b = 500;
    let mut desc_b = open_stream(
        &mut client,
        &accounts,
        OpenStreamParams {
            total: total_b,
            tranches: 5,
            duration: 200,
            // Push the first unlock far enough into the future that even with
            // a slow runner, every tranche is still locked when we cancel.
            start_offset: 200,
        },
    )
    .await?;
    println!(
        "opened stream {} (first unlock @ block {})",
        desc_b.id,
        desc_b.tranches.first().unwrap().unlock_block,
    );

    let alice_after_open_b = balance(&client, alice, faucet).await?;
    assert_eq!(
        alice_after_claim - alice_after_open_b,
        total_b,
        "Alice should have {total_b} STREAM locked into the new tranches"
    );

    // Sanity: every tranche must still be in the future before we cancel.
    let now = current_block(&mut client).await?;
    let earliest_unlock = desc_b.tranches.iter().map(|t| t.unlock_block).min().unwrap();
    if earliest_unlock <= now {
        return Err(anyhow!(
            "scenario 2 invariant broken: earliest unlock {earliest_unlock} <= now {now} — \
             rerun with a larger start_offset"
        ));
    }

    let cancelled = cancel_descriptor(&mut client, &mut desc_b, alice).await?;
    assert_eq!(cancelled, 5, "all 5 tranches should have been reclaimed");
    assert!(
        desc_b.tranches.iter().all(|t| t.status == TrancheStatus::Cancelled),
        "every tranche should be marked Cancelled"
    );

    for _ in 0..5 {
        client.sync_state().await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    let alice_final = balance(&client, alice, faucet).await?;
    assert_eq!(
        alice_final, alice_after_claim,
        "Alice's net balance should be unchanged after the cancelled stream"
    );
    println!("  ✓ Alice reclaimed {total_b} STREAM, net balance restored");

    // ----- summary ---------------------------------------------------------
    println!("\n=== summary ===");
    println!(
        "Alice STREAM: start={alice_start}  end={alice_final}  (delta = -{})",
        alice_start - alice_final
    );
    println!(
        "Bob   STREAM: start={bob_start}  end={bob_after_claim}  (delta = +{})",
        bob_after_claim - bob_start
    );
    println!("\nall scenarios passed ✓");
    Ok(())
}
