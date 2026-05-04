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
#[command(version, about = "Claim unlocked tranches as Bob")]
struct Args {
    /// Path to a stream descriptor. If omitted, claims across all streams in ./data/streams/.
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
    let bob = accounts.bob()?;

    let mut descriptors: Vec<StreamDescriptor> = match args.stream {
        Some(path) => vec![StreamDescriptor::load(&path)?],
        None => list_streams()?,
    };
    if descriptors.is_empty() {
        println!("no stream descriptors found in ./data/streams/");
        return Ok(());
    }

    for desc in descriptors.iter_mut() {
        let unlocked: Vec<usize> = desc
            .tranches
            .iter()
            .enumerate()
            .filter(|(_, t)| t.status == TrancheStatus::Pending && t.unlock_block <= now)
            .map(|(i, _)| i)
            .collect();

        if unlocked.is_empty() {
            println!(
                "stream {}: no unlocked tranches yet (next unlock @ block {})",
                desc.id,
                desc.tranches
                    .iter()
                    .find(|t| t.status == TrancheStatus::Pending)
                    .map(|t| t.unlock_block.to_string())
                    .unwrap_or_else(|| "—".into())
            );
            continue;
        }

        println!("stream {}: claiming {} tranche(s)", desc.id, unlocked.len());

        // Resolve notes from the local store (sender's open_stream populated them)
        let mut notes: Vec<Note> = Vec::new();
        for &idx in &unlocked {
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
        let tx_id = client.submit_new_transaction(bob, tx).await?;
        println!("  consume tx: {}", tx_id.to_hex());

        for &idx in &unlocked {
            desc.tranches[idx].status = TrancheStatus::Claimed;
        }
        desc.save()?;
    }

    // Brief sync for visibility
    for _ in 0..3 {
        client.sync_state().await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    println!("\nclaim done");
    Ok(())
}
