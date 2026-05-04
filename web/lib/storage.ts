// Lightweight localStorage helpers for the demo.
// Persists account ids and stream descriptors; the Miden SDK keeps its own
// IndexedDB-backed store for accounts, notes, and keys.

export type AccountsState = {
  alice?: string;
  bob?: string;
  faucet?: string;
};

const ACCOUNTS_KEY = "csm.accounts.v1";
const STREAMS_KEY = "csm.streams.v1";

export function loadAccounts(): AccountsState {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAccounts(state: AccountsState) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state));
}

export type TrancheStatus = "pending" | "claimed" | "cancelled";

export type Tranche = {
  index: number;
  amount: number;
  unlockBlock: number;
  status: TrancheStatus;
  noteId?: string;
};

export type Stream = {
  id: string;
  createdAtBlock: number;
  total: number;
  durationBlocks: number;
  tranches: Tranche[];
};

export function loadStreams(): Stream[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STREAMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStreams(streams: Stream[]) {
  localStorage.setItem(STREAMS_KEY, JSON.stringify(streams));
}

export function upsertStream(stream: Stream) {
  const streams = loadStreams();
  const idx = streams.findIndex((s) => s.id === stream.id);
  if (idx >= 0) streams[idx] = stream;
  else streams.push(stream);
  saveStreams(streams);
}

export function genStreamId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
