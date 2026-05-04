use std::{path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use miden_client::{
    account::AccountId,
    address::NetworkId,
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    rpc::{Endpoint, GrpcClient},
    Client,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
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
