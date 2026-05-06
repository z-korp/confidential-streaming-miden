use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use confidential_streaming_rust_client::{
    build_client, claim_descriptor, current_block, list_streams, AccountsFile, StreamDescriptor,
    TrancheStatus,
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
    let now = current_block(&mut client).await?;
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
        let claimed = claim_descriptor(&mut client, desc, bob).await?;
        if claimed == 0 {
            let next = desc
                .tranches
                .iter()
                .find(|t| t.status == TrancheStatus::Pending)
                .map(|t| t.unlock_block.to_string())
                .unwrap_or_else(|| "—".into());
            println!(
                "stream {}: no unlocked tranches yet (next unlock @ block {next})",
                desc.id
            );
        } else {
            println!("stream {}: claimed {} tranche(s)", desc.id, claimed);
        }
    }

    println!("\nclaim done");
    Ok(())
}
