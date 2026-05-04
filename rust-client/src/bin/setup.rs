use std::time::Duration;

use anyhow::Result;
use confidential_streaming_rust_client::{build_client, AccountsFile, NETWORK};
use miden_client::{
    account::{
        component::{AuthControlled, BasicFungibleFaucet, BasicWallet},
        AccountBuilder, AccountStorageMode, AccountType,
    },
    asset::{FungibleAsset, TokenSymbol},
    auth::{AuthSchemeId, AuthSecretKey, AuthSingleSig},
    keystore::Keystore,
    note::NoteType,
    transaction::TransactionRequestBuilder,
    Felt,
};
use rand::RngCore;

const FAUCET_SYMBOL: &str = "STREAM";
const FAUCET_DECIMALS: u8 = 6;
const FAUCET_MAX_SUPPLY: u64 = 1_000_000_000;
const ALICE_INITIAL_BALANCE: u64 = 1_000_000;

#[tokio::main]
async fn main() -> Result<()> {
    let (mut client, keystore) = build_client().await?;
    let summary = client.sync_state().await?;
    println!("synced; latest block = {}", summary.block_num);

    // ---- Alice (sender) ---------------------------------------------------
    let alice = {
        let mut seed = [0u8; 32];
        client.rng().fill_bytes(&mut seed);
        let kp = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
        let acct = AccountBuilder::new(seed)
            .account_type(AccountType::RegularAccountUpdatableCode)
            .storage_mode(AccountStorageMode::Public)
            .with_auth_component(AuthSingleSig::new(
                kp.public_key().to_commitment(),
                AuthSchemeId::Falcon512Poseidon2,
            ))
            .with_component(BasicWallet)
            .build()
            .map_err(|e| anyhow::anyhow!("alice build: {e}"))?;
        client.add_account(&acct, false).await?;
        keystore.add_key(&kp, acct.id()).await
            .map_err(|e| anyhow::anyhow!("keystore alice: {e}"))?;
        acct
    };
    println!("Alice (sender)    : {}", alice.id().to_bech32(NETWORK));

    // ---- Bob (recipient) --------------------------------------------------
    let bob = {
        let mut seed = [0u8; 32];
        client.rng().fill_bytes(&mut seed);
        let kp = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
        let acct = AccountBuilder::new(seed)
            .account_type(AccountType::RegularAccountUpdatableCode)
            .storage_mode(AccountStorageMode::Public)
            .with_auth_component(AuthSingleSig::new(
                kp.public_key().to_commitment(),
                AuthSchemeId::Falcon512Poseidon2,
            ))
            .with_component(BasicWallet)
            .build()
            .map_err(|e| anyhow::anyhow!("bob build: {e}"))?;
        client.add_account(&acct, false).await?;
        keystore.add_key(&kp, acct.id()).await
            .map_err(|e| anyhow::anyhow!("keystore bob: {e}"))?;
        acct
    };
    println!("Bob   (recipient) : {}", bob.id().to_bech32(NETWORK));

    // ---- STREAM faucet ----------------------------------------------------
    let faucet = {
        let mut seed = [0u8; 32];
        client.rng().fill_bytes(&mut seed);
        let kp = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
        let symbol = TokenSymbol::new(FAUCET_SYMBOL)
            .map_err(|e| anyhow::anyhow!("symbol: {e}"))?;
        let acct = AccountBuilder::new(seed)
            .account_type(AccountType::FungibleFaucet)
            .storage_mode(AccountStorageMode::Public)
            .with_auth_component(AuthSingleSig::new(
                kp.public_key().to_commitment(),
                AuthSchemeId::Falcon512Poseidon2,
            ))
            .with_component(
                BasicFungibleFaucet::new(symbol, FAUCET_DECIMALS, Felt::new(FAUCET_MAX_SUPPLY))
                    .map_err(|e| anyhow::anyhow!("faucet: {e}"))?,
            )
            .with_component(AuthControlled::allow_all())
            .build()
            .map_err(|e| anyhow::anyhow!("faucet build: {e}"))?;
        client.add_account(&acct, false).await?;
        keystore.add_key(&kp, acct.id()).await
            .map_err(|e| anyhow::anyhow!("keystore faucet: {e}"))?;
        acct
    };
    println!("Faucet (STREAM)   : {}", faucet.id().to_bech32(NETWORK));

    // Persist for downstream commands
    let accounts = AccountsFile {
        alice_bech32: alice.id().to_bech32(NETWORK),
        bob_bech32: bob.id().to_bech32(NETWORK),
        faucet_bech32: faucet.id().to_bech32(NETWORK),
    };
    accounts.save()?;

    client.sync_state().await?;
    tokio::time::sleep(Duration::from_secs(2)).await;

    // ---- Mint initial balance to Alice ------------------------------------
    println!("\nMinting {} STREAM to Alice...", ALICE_INITIAL_BALANCE);
    let asset = FungibleAsset::new(faucet.id(), ALICE_INITIAL_BALANCE)
        .map_err(|e| anyhow::anyhow!("asset: {e}"))?;
    let tx = TransactionRequestBuilder::new()
        .build_mint_fungible_asset(asset, alice.id(), NoteType::Public, client.rng())
        .map_err(|e| anyhow::anyhow!("mint tx: {e}"))?;
    let tx_id = client.submit_new_transaction(faucet.id(), tx).await?;
    println!("  mint tx: {}", tx_id.to_hex());

    // Wait for mint, then have Alice consume the minted note to credit her wallet
    println!("\nAlice consuming minted note...");
    loop {
        client.sync_state().await?;
        let consumable = client.get_consumable_notes(Some(alice.id())).await?;
        let notes: Vec<_> = consumable
            .iter()
            .map(|(n, _)| n.clone().try_into())
            .collect::<Result<_, _>>()?;
        if !notes.is_empty() {
            let tx = TransactionRequestBuilder::new().build_consume_notes(notes)?;
            let tx_id = client.submit_new_transaction(alice.id(), tx).await?;
            println!("  consume tx: {}", tx_id.to_hex());
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    println!("\nSetup complete. accounts.json written.");
    Ok(())
}
