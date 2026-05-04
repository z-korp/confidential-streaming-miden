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
  TransactionRequestBuilder,
} from "@miden-sdk/miden-sdk/lazy";

const RPC_URL = "https://rpc.testnet.miden.io";

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
) {
  const client = await getClient();
  const { txId } = await client.transactions.mint({
    account: faucetId,
    to: recipientId,
    amount,
    type: NoteVisibility.Public,
  });
  await client.transactions.waitFor(txId);
  await client.transactions.consumeAll({ account: recipientId });
  return txId;
}

export type SendTrancheArgs = {
  senderId: string;
  recipientId: string;
  faucetId: string;
  amount: bigint;
  /** Block height before which recipient cannot claim. */
  timelockUntil: number;
  /**
   * Block height after which sender can reclaim. Set to 0 for "anytime";
   * note this also lets sender race the recipient after unlock.
   */
  reclaimAfter: number;
};

/**
 * Emit a single timelocked + reclaimable private note (P2IDE).
 * Returns the on-chain note id (canonical hex).
 */
export async function sendTranche(args: SendTrancheArgs): Promise<string> {
  const client = await getClient();

  const sender = AccountId.fromHex(args.senderId);
  const target = AccountId.fromHex(args.recipientId);
  const faucet = AccountId.fromHex(args.faucetId);

  const asset = new FungibleAsset(faucet, args.amount);
  const assets = new NoteAssets([asset]);
  const attachment = new NoteAttachment();

  const note = Note.createP2IDENote(
    sender,
    target,
    assets,
    args.reclaimAfter,
    args.timelockUntil,
    NoteType.Private,
    attachment,
  );

  const noteId = note.id().toString();

  const txReq = new TransactionRequestBuilder()
    .withOwnOutputNotes(new NoteArray([note]))
    .build();

  const { txId } = await client.transactions.submit(args.senderId, txReq);
  await client.transactions.waitFor(txId);

  return noteId;
}

export async function consumeNoteIds(consumerId: string, noteIdsHex: string[]) {
  if (noteIdsHex.length === 0) return null;
  const client = await getClient();
  const records = await client.notes.list({ ids: noteIdsHex });
  if (records.length === 0) return null;
  const notes = records.map((r) => r.toNote());
  const { txId } = await client.transactions.consume({
    account: consumerId,
    notes,
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
