use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use confidential_streaming_rust_client::{
    build_client, AccountsFile, StreamDescriptor, TrancheRecord, TrancheStatus,
};
use miden_client::{
    asset::FungibleAsset,
    crypto::FeltRng,
    note::{Note, NoteAssets, NoteMetadata, NoteRecipient, NoteStorage, NoteTag, NoteType},
    transaction::TransactionRequestBuilder,
    Felt,
};
use rand::RngCore;

const SCRIPT_PATH: &str = "../masm/notes/stream_tranche.masm";

#[derive(Parser, Debug)]
#[command(version, about = "Open a confidential stream from Alice to Bob")]
struct Args {
    /// Total amount to stream (in faucet base units).
    #[arg(long, default_value_t = 1000)]
    total: u64,

    /// Number of discrete tranches.
    #[arg(long, default_value_t = 10)]
    tranches: u32,

    /// Duration in blocks. First unlock is at start_offset; last unlock at start_offset + duration.
    #[arg(long, default_value_t = 100)]
    duration: u32,

    /// Offset in blocks from `now` where the first tranche unlocks.
    #[arg(long, default_value_t = 0)]
    start_offset: u32,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    if args.tranches == 0 || args.total == 0 {
        return Err(anyhow!("--tranches and --total must be > 0"));
    }

    let (mut client, _ks) = build_client().await?;
    let summary = client.sync_state().await?;
    let now: u32 = summary.block_num.as_u32();
    println!("synced; current block = {now}");

    let accounts = AccountsFile::load()?;
    let alice = accounts.alice()?;
    let bob = accounts.bob()?;
    let faucet = accounts.faucet()?;

    // ---- Compile note script (once) ---------------------------------------
    let masm_path = std::env::current_dir()?.join(SCRIPT_PATH);
    let script_src = std::fs::read_to_string(&masm_path)
        .with_context(|| format!("read MASM at {}", masm_path.display()))?;
    let script = client
        .code_builder()
        .compile_note_script(script_src)
        .map_err(|e| anyhow!("compile MASM: {e}"))?;

    // ---- Plan tranches ----------------------------------------------------
    let n = args.tranches;
    let base_amount = args.total / n as u64;
    let remainder = args.total - base_amount * n as u64;
    let step = (args.duration as f64 / n as f64).ceil() as u32;
    let first_unlock = now + args.start_offset.max(1);

    println!("opening stream:");
    println!("  total          = {}", args.total);
    println!("  tranches       = {n} ({base_amount} per tranche, last gets +{remainder})");
    println!("  unlock window  = block {first_unlock}..{}", first_unlock + step * (n - 1));

    // Per-stream identifiers
    let stream_id = {
        let mut buf = [0u8; 8];
        client.rng().fill_bytes(&mut buf);
        hex::encode(buf)
    };
    let note_tag = {
        let mut buf = [0u8; 4];
        client.rng().fill_bytes(&mut buf);
        u32::from_le_bytes(buf)
    };
    println!("  stream id      = {stream_id}");
    println!("  note tag       = 0x{:08x}", note_tag);

    // ---- Build the N tranche notes ----------------------------------------
    let zero = Felt::new(0);
    let r_suffix = bob.suffix();
    let r_prefix = bob.prefix().as_felt();
    let s_suffix = alice.suffix();
    let s_prefix = alice.prefix().as_felt();

    let mut notes: Vec<Note> = Vec::with_capacity(n as usize);
    let mut tranches: Vec<TrancheRecord> = Vec::with_capacity(n as usize);
    let mut serial_nums_hex: Vec<String> = Vec::with_capacity(n as usize);

    for i in 0..n {
        let unlock_block = first_unlock + step * i;
        let amount = if i + 1 == n { base_amount + remainder } else { base_amount };

        let storage_items = vec![
            r_suffix, r_prefix, zero, zero,
            s_suffix, s_prefix, zero, zero,
            Felt::new(unlock_block as u64), zero, zero, zero,
        ];
        let storage = NoteStorage::new(storage_items)
            .map_err(|e| anyhow!("note storage: {e}"))?;

        let serial_num = client.rng().draw_word();
        let recipient = NoteRecipient::new(serial_num, script.clone(), storage);

        let asset = FungibleAsset::new(faucet, amount)
            .map_err(|e| anyhow!("asset: {e}"))?;
        let assets = NoteAssets::new(vec![asset.into()])
            .map_err(|e| anyhow!("note assets: {e}"))?;

        let metadata = NoteMetadata::new(alice, NoteType::Private)
            .with_tag(NoteTag::new(note_tag));

        let note = Note::new(assets, metadata, recipient);
        let note_id_hex = note.id().to_hex();

        tranches.push(TrancheRecord {
            index: i,
            note_id_hex: note_id_hex.clone(),
            amount,
            unlock_block,
            status: TrancheStatus::Pending,
        });
        serial_nums_hex.push(format!("{:?}", serial_num));
        notes.push(note);

        println!("  tranche #{i:02}  unlock@{unlock_block}  amount={amount}  id={note_id_hex}");
    }

    // ---- Submit single tx with all output notes ---------------------------
    let tx = TransactionRequestBuilder::new()
        .own_output_notes(notes)
        .build()
        .map_err(|e| anyhow!("build tx: {e}"))?;

    let tx_id = client.submit_new_transaction(alice, tx).await?;
    println!("\nopen tx submitted: {}", tx_id.to_hex());

    // Best-effort: wait briefly for commit so subsequent claims can proceed
    for _ in 0..15 {
        client.sync_state().await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    // ---- Persist descriptor ----------------------------------------------
    let descriptor = StreamDescriptor {
        id: stream_id,
        sender_bech32: accounts.alice_bech32.clone(),
        recipient_bech32: accounts.bob_bech32.clone(),
        faucet_bech32: accounts.faucet_bech32.clone(),
        created_at_block: now,
        total: args.total,
        note_tag,
        serial_nums_hex,
        tranches,
    };
    descriptor.save()?;
    println!(
        "\nstream descriptor written to {}",
        descriptor.path().display()
    );

    Ok(())
}
