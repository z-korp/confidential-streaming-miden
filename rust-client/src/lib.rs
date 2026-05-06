use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::{anyhow, Context, Result};
use miden_client::{
    account::AccountId,
    address::NetworkId,
    asset::FungibleAsset,
    builder::ClientBuilder,
    crypto::FeltRng,
    keystore::FilesystemKeyStore,
    note::{Note, NoteAssets, NoteId, NoteMetadata, NoteRecipient, NoteStorage, NoteTag, NoteType},
    rpc::{Endpoint, GrpcClient},
    store::NoteFilter,
    transaction::TransactionRequestBuilder,
    Client, Felt,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};

pub const NETWORK: NetworkId = NetworkId::Testnet;
pub const TIMEOUT_MS: u64 = 10_000;

pub fn data_dir() -> PathBuf {
    PathBuf::from("./data")
}

pub fn store_path() -> PathBuf {
    data_dir().join("store.sqlite3")
}

pub fn keystore_path() -> PathBuf {
    data_dir().join("keystore")
}

pub fn streams_dir() -> PathBuf {
    data_dir().join("streams")
}

pub fn accounts_path() -> PathBuf {
    data_dir().join("accounts.json")
}

pub fn ensure_dirs() -> Result<()> {
    std::fs::create_dir_all(data_dir())?;
    std::fs::create_dir_all(keystore_path())?;
    std::fs::create_dir_all(streams_dir())?;
    Ok(())
}

/// Build the shared Miden client, connected to public testnet.
pub async fn build_client() -> Result<(Client<FilesystemKeyStore>, Arc<FilesystemKeyStore>)> {
    ensure_dirs()?;

    let endpoint = Endpoint::testnet();
    let rpc = Arc::new(GrpcClient::new(&endpoint, TIMEOUT_MS));
    let keystore = Arc::new(
        FilesystemKeyStore::new(keystore_path())
            .map_err(|e| anyhow::anyhow!("keystore init: {e}"))?,
    );

    let client = ClientBuilder::new()
        .rpc(rpc)
        .sqlite_store(store_path())
        .authenticator(keystore.clone())
        .in_debug_mode(true.into())
        .build()
        .await
        .context("client build")?;

    Ok((client, keystore))
}

// ---------------------------------------------------------------------------
// Accounts persistence
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountsFile {
    pub alice_bech32: String,
    pub bob_bech32: String,
    pub faucet_bech32: String,
}

impl AccountsFile {
    pub fn load() -> Result<Self> {
        let raw = std::fs::read_to_string(accounts_path())
            .context("accounts.json not found — run `setup` first")?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self) -> Result<()> {
        std::fs::write(accounts_path(), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn alice(&self) -> Result<AccountId> {
        AccountId::from_bech32(&self.alice_bech32)
            .map(|(_, id)| id)
            .map_err(|e| anyhow::anyhow!("bad alice id: {e}"))
    }

    pub fn bob(&self) -> Result<AccountId> {
        AccountId::from_bech32(&self.bob_bech32)
            .map(|(_, id)| id)
            .map_err(|e| anyhow::anyhow!("bad bob id: {e}"))
    }

    pub fn faucet(&self) -> Result<AccountId> {
        AccountId::from_bech32(&self.faucet_bech32)
            .map(|(_, id)| id)
            .map_err(|e| anyhow::anyhow!("bad faucet id: {e}"))
    }
}

// ---------------------------------------------------------------------------
// Stream descriptor (off-chain handoff)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum TrancheStatus {
    Pending,
    Claimed,
    Cancelled,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrancheRecord {
    pub index: u32,
    pub note_id_hex: String,
    pub amount: u64,
    pub unlock_block: u32,
    pub status: TrancheStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamDescriptor {
    pub id: String,
    pub sender_bech32: String,
    pub recipient_bech32: String,
    pub faucet_bech32: String,
    pub created_at_block: u32,
    pub total: u64,
    pub note_tag: u32,
    /// Serial numbers per tranche, hex-encoded as 4 felts (32 bytes).
    /// Required to rebuild the note on both sides.
    pub serial_nums_hex: Vec<String>,
    pub tranches: Vec<TrancheRecord>,
}

impl StreamDescriptor {
    pub fn path(&self) -> PathBuf {
        streams_dir().join(format!("stream-{}.json", self.id))
    }

    pub fn save(&self) -> Result<()> {
        std::fs::write(self.path(), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn load(path: &std::path::Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("read {}", path.display()))?;
        Ok(serde_json::from_str(&raw)?)
    }
}

pub fn list_streams() -> Result<Vec<StreamDescriptor>> {
    let dir = streams_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(s) = StreamDescriptor::load(&path) {
            out.push(s);
        }
    }
    out.sort_by(|a, b| a.created_at_block.cmp(&b.created_at_block));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Stream operations (shared by CLI bins and the e2e harness)
// ---------------------------------------------------------------------------

pub const SCRIPT_PATH: &str = "../masm/notes/stream_tranche.masm";

#[derive(Debug, Clone, Copy)]
pub struct OpenStreamParams {
    pub total: u64,
    pub tranches: u32,
    pub duration: u32,
    pub start_offset: u32,
}

pub async fn current_block(client: &mut Client<FilesystemKeyStore>) -> Result<u32> {
    let summary = client.sync_state().await?;
    Ok(summary.block_num.as_u32())
}

pub async fn balance(
    client: &Client<FilesystemKeyStore>,
    account: AccountId,
    faucet: AccountId,
) -> Result<u64> {
    Ok(client.account_reader(account).get_balance(faucet).await?)
}

/// Block until `client.sync_state()` reports a tip >= `target`.
pub async fn wait_for_block(
    client: &mut Client<FilesystemKeyStore>,
    target: u32,
    poll: Duration,
) -> Result<u32> {
    loop {
        let now = current_block(client).await?;
        if now >= target {
            return Ok(now);
        }
        tokio::time::sleep(poll).await;
    }
}

/// Build N tranche notes from a single MASM script and submit them in one tx.
/// Returns the saved descriptor.
pub async fn open_stream(
    client: &mut Client<FilesystemKeyStore>,
    accounts: &AccountsFile,
    params: OpenStreamParams,
) -> Result<StreamDescriptor> {
    if params.tranches == 0 || params.total == 0 {
        return Err(anyhow!("tranches and total must be > 0"));
    }

    let alice = accounts.alice()?;
    let bob = accounts.bob()?;
    let faucet = accounts.faucet()?;

    let now = current_block(client).await?;

    let masm_path = std::env::current_dir()?.join(SCRIPT_PATH);
    let script_src = std::fs::read_to_string(&masm_path)
        .with_context(|| format!("read MASM at {}", masm_path.display()))?;
    let script = client
        .code_builder()
        .compile_note_script(script_src)
        .map_err(|e| anyhow!("compile MASM: {e}"))?;

    let n = params.tranches;
    let base_amount = params.total / n as u64;
    let remainder = params.total - base_amount * n as u64;
    let step = (params.duration as f64 / n as f64).ceil() as u32;
    let first_unlock = now + params.start_offset.max(1);

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
            note_id_hex,
            amount,
            unlock_block,
            status: TrancheStatus::Pending,
        });
        serial_nums_hex.push(format!("{:?}", serial_num));
        notes.push(note);
    }

    let tx = TransactionRequestBuilder::new()
        .own_output_notes(notes)
        .build()
        .map_err(|e| anyhow!("build tx: {e}"))?;
    client.submit_new_transaction(alice, tx).await?;

    // Best-effort wait for commit so subsequent claims can resolve the notes locally.
    for _ in 0..15 {
        client.sync_state().await?;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    let descriptor = StreamDescriptor {
        id: stream_id,
        sender_bech32: accounts.alice_bech32.clone(),
        recipient_bech32: accounts.bob_bech32.clone(),
        faucet_bech32: accounts.faucet_bech32.clone(),
        created_at_block: now,
        total: params.total,
        note_tag,
        serial_nums_hex,
        tranches,
    };
    descriptor.save()?;
    Ok(descriptor)
}

/// Consume every Pending tranche whose unlock block is reached. Returns the
/// number of tranches actually claimed.
pub async fn claim_descriptor(
    client: &mut Client<FilesystemKeyStore>,
    descriptor: &mut StreamDescriptor,
    bob: AccountId,
) -> Result<usize> {
    let now = current_block(client).await?;
    let unlocked: Vec<usize> = descriptor
        .tranches
        .iter()
        .enumerate()
        .filter(|(_, t)| t.status == TrancheStatus::Pending && t.unlock_block <= now)
        .map(|(i, _)| i)
        .collect();
    if unlocked.is_empty() {
        return Ok(0);
    }
    let notes = resolve_notes(client, descriptor, &unlocked).await?;
    let tx = TransactionRequestBuilder::new()
        .build_consume_notes(notes)
        .map_err(|e| anyhow!("consume tx: {e}"))?;
    client.submit_new_transaction(bob, tx).await?;
    for &idx in &unlocked {
        descriptor.tranches[idx].status = TrancheStatus::Claimed;
    }
    descriptor.save()?;
    Ok(unlocked.len())
}

/// Consume every Pending tranche whose unlock block has not been reached
/// (sender reclaim path). Returns the number of tranches actually cancelled.
pub async fn cancel_descriptor(
    client: &mut Client<FilesystemKeyStore>,
    descriptor: &mut StreamDescriptor,
    alice: AccountId,
) -> Result<usize> {
    let now = current_block(client).await?;
    let still_locked: Vec<usize> = descriptor
        .tranches
        .iter()
        .enumerate()
        .filter(|(_, t)| t.status == TrancheStatus::Pending && t.unlock_block > now)
        .map(|(i, _)| i)
        .collect();
    if still_locked.is_empty() {
        return Ok(0);
    }
    let notes = resolve_notes(client, descriptor, &still_locked).await?;
    let tx = TransactionRequestBuilder::new()
        .build_consume_notes(notes)
        .map_err(|e| anyhow!("consume tx: {e}"))?;
    client.submit_new_transaction(alice, tx).await?;
    for &idx in &still_locked {
        descriptor.tranches[idx].status = TrancheStatus::Cancelled;
    }
    descriptor.save()?;
    Ok(still_locked.len())
}

async fn resolve_notes(
    client: &Client<FilesystemKeyStore>,
    descriptor: &StreamDescriptor,
    indices: &[usize],
) -> Result<Vec<Note>> {
    let mut notes = Vec::with_capacity(indices.len());
    for &idx in indices {
        let t = &descriptor.tranches[idx];
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
    Ok(notes)
}
