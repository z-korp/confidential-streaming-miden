// Thin wrapper over the Miden web SDK. All calls run in the browser only.
import {
  AccountId,
  AccountType,
  FungibleAsset,
  MidenClient,
  Note,
  NoteArray,
  NoteAssets,
  NoteAttachment,
  NoteType,
  NoteVisibility,
  StorageMode,
  TransactionProver,
  TransactionRequestBuilder,
} from "@miden-sdk/miden-sdk/lazy";

import type { ProverMode } from "./storage";

const RPC_URL = "https://rpc.testnet.miden.io";
const REMOTE_PROVER_URL = "https://tx-prover.testnet.miden.io";

let _clientPromise: Promise<MidenClient> | null = null;

export async function getClient(): Promise<MidenClient> {
  if (typeof window === "undefined") {
    throw new Error("Miden client only runs in the browser");
  }
  if (!_clientPromise) {
    _clientPromise = (async () => {
      await MidenClient.ready();
      return MidenClient.create({ rpcUrl: RPC_URL });
    })();
  }
  return _clientPromise;
}

// Construct provers lazily and cache one per mode. Local prover does the STARK
// proof inside the browser WASM; testnet prover offloads to Miden's hosted
// service (faster, but the prover sees the witness).
const _provers: Partial<Record<ProverMode, TransactionProver>> = {};

export async function getProver(mode: ProverMode): Promise<TransactionProver> {
  await MidenClient.ready();
  let p = _provers[mode];
  if (!p) {
    p = mode === "local"
      ? TransactionProver.newLocalProver()
      : TransactionProver.newRemoteProver(REMOTE_PROVER_URL);
    _provers[mode] = p;
  }
  return p;
}

export async function syncBlock(): Promise<number> {
  const client = await getClient();
  const summary = await client.sync();
  return summary.blockNum();
}

export async function createWallet() {
  const client = await getClient();
  return client.accounts.create({
    type: AccountType.RegularAccountUpdatableCode,
    storage: StorageMode.Public,
  });
}

export async function createStreamFaucet(symbol = "STREAM") {
  const client = await getClient();
  return client.accounts.create({
    type: AccountType.FungibleFaucet,
    symbol,
    decimals: 6,
    maxSupply: BigInt(1_000_000_000),
    storage: StorageMode.Public,
  });
}

export async function mintTo(
  faucetId: string,
  recipientId: string,
  amount: bigint,
  prover?: TransactionProver,
) {
  const client = await getClient();
  const { txId } = await client.transactions.mint({
    account: faucetId,
    to: recipientId,
    amount,
    type: NoteVisibility.Public,
    prover,
  });
  await client.transactions.waitFor(txId);
  await client.transactions.consumeAll({ account: recipientId, prover });
  return txId;
}

export type TrancheSpec = {
  amount: bigint;
  /** Block height before which recipient cannot claim. */
  timelockUntil: number;
  /**
   * Block height after which sender can reclaim. Set to 0 for "anytime";
   * note this also lets sender race the recipient after unlock.
   */
  reclaimAfter: number;
};

export type SendTranchesArgs = {
  senderId: string;
  recipientId: string;
  faucetId: string;
  tranches: TrancheSpec[];
  prover?: TransactionProver;
};

/**
 * Emit N timelocked + reclaimable private notes (P2IDE) in a single transaction.
 * Returns the on-chain note ids (canonical hex), in input order.
 */
export async function sendTranches(args: SendTranchesArgs): Promise<string[]> {
  if (args.tranches.length === 0) return [];
  const client = await getClient();

  const sender = AccountId.fromHex(args.senderId);
  const target = AccountId.fromHex(args.recipientId);
  const faucet = AccountId.fromHex(args.faucetId);

  const notes = args.tranches.map((t) => {
    const asset = new FungibleAsset(faucet, t.amount);
    const assets = new NoteAssets([asset]);
    return Note.createP2IDENote(
      sender,
      target,
      assets,
      t.reclaimAfter,
      t.timelockUntil,
      NoteType.Private,
      new NoteAttachment(),
    );
  });

  const noteIds = notes.map((n) => n.id().toString());

  const txReq = new TransactionRequestBuilder()
    .withOwnOutputNotes(new NoteArray(notes))
    .build();

  const { txId } = await client.transactions.submit(args.senderId, txReq, {
    prover: args.prover,
  });
  await client.transactions.waitFor(txId);

  return noteIds;
}

export async function consumeNoteIds(
  consumerId: string,
  noteIdsHex: string[],
  prover?: TransactionProver,
) {
  if (noteIdsHex.length === 0) return null;
  const client = await getClient();
  const records = await client.notes.list({ ids: noteIdsHex });
  if (records.length === 0) return null;
  const notes = records.map((r) => r.toNote());
  const { txId } = await client.transactions.consume({
    account: consumerId,
    notes,
    prover,
  });
  await client.transactions.waitFor(txId);
  return txId;
}

export async function getBalance(accountId: string, faucetId: string): Promise<bigint> {
  const client = await getClient();
  const acct = await client.accounts.get(accountId);
  if (!acct) return BigInt(0);
  const vault = acct.vault();
  for (const a of vault.fungibleAssets()) {
    if (a.faucetId().toString() === faucetId) return a.amount();
  }
  return BigInt(0);
}
