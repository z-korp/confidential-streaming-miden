use anyhow::Result;
use clap::Parser;
use confidential_streaming_rust_client::{
    build_client, open_stream, AccountsFile, OpenStreamParams,
};

#[derive(Parser, Debug)]
#[command(version, about = "Open a confidential stream from Alice to Bob")]
struct Args {
    #[arg(long, default_value_t = 1000)]
    total: u64,

    #[arg(long, default_value_t = 10)]
    tranches: u32,

    #[arg(long, default_value_t = 100)]
    duration: u32,

    #[arg(long, default_value_t = 0)]
    start_offset: u32,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let (mut client, _ks) = build_client().await?;
    let accounts = AccountsFile::load()?;

    println!("opening stream:");
    println!("  total          = {}", args.total);
    println!("  tranches       = {}", args.tranches);
    println!("  duration       = {} blocks", args.duration);
    println!("  start_offset   = {} blocks", args.start_offset);

    let descriptor = open_stream(
        &mut client,
        &accounts,
        OpenStreamParams {
            total: args.total,
            tranches: args.tranches,
            duration: args.duration,
            start_offset: args.start_offset,
        },
    )
    .await?;

    println!("\nstream id        = {}", descriptor.id);
    println!("note tag         = 0x{:08x}", descriptor.note_tag);
    println!("created at block = {}", descriptor.created_at_block);
    for t in &descriptor.tranches {
        println!(
            "  tranche #{:02}  unlock@{}  amount={}  id={}",
            t.index, t.unlock_block, t.amount, t.note_id_hex
        );
    }
    println!(
        "\nstream descriptor written to {}",
        descriptor.path().display()
    );
    Ok(())
}
