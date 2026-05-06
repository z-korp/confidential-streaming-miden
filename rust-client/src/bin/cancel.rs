use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use confidential_streaming_rust_client::{
    build_client, cancel_descriptor, current_block, list_streams, AccountsFile, StreamDescriptor,
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
    let now = current_block(&mut client).await?;
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
        let cancelled = cancel_descriptor(&mut client, desc, alice).await?;
        if cancelled == 0 {
            println!(
                "stream {}: nothing to cancel — no tranche still locked & pending",
                desc.id
            );
        } else {
            println!("stream {}: reclaimed {} locked tranche(s)", desc.id, cancelled);
        }
    }

    println!("\ncancel done");
    Ok(())
}
