use anyhow::Result;
use confidential_streaming_rust_client::{build_client, list_streams, TrancheStatus};

#[tokio::main]
async fn main() -> Result<()> {
    let (mut client, _ks) = build_client().await?;
    let summary = client.sync_state().await?;
    let now: u32 = summary.block_num.as_u32();
    println!("current block = {now}\n");

    let streams = list_streams()?;
    if streams.is_empty() {
        println!("no streams.");
        return Ok(());
    }

    for s in &streams {
        let pending = s.tranches.iter().filter(|t| t.status == TrancheStatus::Pending).count();
        let unlocked_now = s
            .tranches
            .iter()
            .filter(|t| t.status == TrancheStatus::Pending && t.unlock_block <= now)
            .count();
        let claimed = s.tranches.iter().filter(|t| t.status == TrancheStatus::Claimed).count();
        let cancelled = s.tranches.iter().filter(|t| t.status == TrancheStatus::Cancelled).count();

        println!("─── stream {} ───────────────────────", s.id);
        println!("  sender    : {}", s.sender_bech32);
        println!("  recipient : {}", s.recipient_bech32);
        println!("  faucet    : {}", s.faucet_bech32);
        println!("  total     : {}", s.total);
        println!("  tranches  : {} (pending {} • unlocked-now {} • claimed {} • cancelled {})",
            s.tranches.len(), pending, unlocked_now, claimed, cancelled);
        for t in &s.tranches {
            let mark = match t.status {
                TrancheStatus::Pending if t.unlock_block <= now => "[unlocked]",
                TrancheStatus::Pending => "[locked]  ",
                TrancheStatus::Claimed => "[claimed] ",
                TrancheStatus::Cancelled => "[cancelled]",
            };
            println!(
                "    {mark}  #{:02}  unlock@{:>8}  amount={:>10}",
                t.index, t.unlock_block, t.amount
            );
        }
        println!();
    }

    Ok(())
}
