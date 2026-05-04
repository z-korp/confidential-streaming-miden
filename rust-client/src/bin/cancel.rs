use std::{path::PathBuf, time::Duration};

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use confidential_streaming_rust_client::{
    build_client, list_streams, AccountsFile, StreamDescriptor, TrancheStatus,
};
use miden_client::{
    note::{Note, NoteId},
    store::NoteFilter,
    transaction::TransactionRequestBuilder,
};

#[derive(Parser, Debug)]
#[command(version, about = "Cancel a stream as Alice — reclaims tranches still locked")]
struct Args {
    /// Path to a stream descriptor. If omitted, cancels across all streams.
    #[arg(long)]
    stream: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let (mut client, _ks) = build_client().await?;
    let summary = client.sync_state().await?;
    let now: u32 = summary.block_num.as_u32();
    println!("synced; current block = {now}");

    let accounts = AccountsFile::load()?;
    let alice = accounts.alice()?;

    let mut descriptors: Vec<StreamDescriptor> = match args.stream {
        Some(path) => vec![StreamDescriptor::load(&path)?],
        None => list_streams()?,
    };
    if descriptors.is_empty() {
        println!("no stream descriptors found in ./data/streams/");
        return Ok(());
    }

    for desc in descriptors.iter_mut() {
        let still_locked: Vec<usize> = desc
            .tranches
            .iter()
            .enumerate()
            .filter(|(_, t)| t.status == TrancheStatus::Pending && t.unlock_block > now)
            .map(|(i, _)| i)
            .collect();

        if still_locked.is_empty() {
            println!("stream {}: nothing to cancel — no tranche still locked & pending", desc.id);
            continue;
        }

        println!(
            "stream {}: reclaiming {} locked tranche(s)",
            desc.id,
            still_locked.len()
        );

        let mut notes: Vec<Note> = Vec::new();
        for &idx in &still_locked {
            let t = &desc.tranches[idx];
            let note_id = NoteId::try_from_hex(&t.note_id_hex)
                .map_err(|e| anyhow!("bad note id {}: {e}", t.note_id_hex))?;
            let record = client
                .get_input_notes(NoteFilter::Unique(note_id))
                .await?
                .pop()
                .with_context(|| format!("tranche #{} note not in store", idx))?;
            let note: Note = record.try_into().map_err(|e| anyhow!("note convert: {e}"))?;
            notes.push(note);
        }

        let tx = TransactionRequestBuilder::new()
            .build_consume_notes(notes)
            .map_err(|e| anyhow!("consume tx: {e}"))?;
        let tx_id = client.submit_new_transaction(alice, tx).await?;
        println!("  reclaim tx: {}", tx_id.to_hex());

        for &idx in &still_locked {
            desc.tranches[idx].status = TrancheStatus::Cancelled;
        }
        desc.save()?;
    }

    for _ in 0..3 {
        client.sync_state().await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    println!("\ncancel done");
    Ok(())
}
