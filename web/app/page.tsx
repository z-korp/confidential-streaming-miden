"use client";

import { useEffect, useState } from "react";
import {
  createStreamFaucet,
  createWallet,
  getBalance,
  mintTo,
  sendTranche,
  syncBlock,
  consumeNoteIds,
} from "@/lib/miden";
import {
  AccountsState,
  Stream,
  Tranche,
  genStreamId,
  loadAccounts,
  loadStreams,
  saveAccounts,
  upsertStream,
} from "@/lib/storage";

export default function Home() {
  const [block, setBlock] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<AccountsState>({});
  const [streams, setStreams] = useState<Stream[]>([]);
  const [aliceBal, setAliceBal] = useState<bigint>(BigInt(0));
  const [bobBal, setBobBal] = useState<bigint>(BigInt(0));
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // form state
  const [total, setTotal] = useState(1000);
  const [tranches, setTranches] = useState(5);
  const [duration, setDuration] = useState(20);

  const append = (msg: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 50));

  useEffect(() => {
    setAccounts(loadAccounts());
    setStreams(loadStreams());
  }, []);

  async function refresh() {
    try {
      const b = await syncBlock();
      setBlock(b);
      if (accounts.alice && accounts.faucet) setAliceBal(await getBalance(accounts.alice, accounts.faucet));
      if (accounts.bob && accounts.faucet) setBobBal(await getBalance(accounts.bob, accounts.faucet));
    } catch (e) {
      append(`refresh error: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.alice, accounts.bob, accounts.faucet]);

  async function onSetup() {
    setBusy("setup");
    try {
      append("creating Alice…");
      const alice = await createWallet();
      append(`Alice: ${alice.id().toString()}`);
      append("creating Bob…");
      const bob = await createWallet();
      append(`Bob: ${bob.id().toString()}`);
      append("deploying STREAM faucet…");
      const faucet = await createStreamFaucet("STREAM");
      append(`Faucet: ${faucet.id().toString()}`);

      const next: AccountsState = {
        alice: alice.id().toString(),
        bob: bob.id().toString(),
        faucet: faucet.id().toString(),
      };
      saveAccounts(next);
      setAccounts(next);

      append("minting 100 000 STREAM to Alice…");
      await mintTo(next.faucet!, next.alice!, BigInt(100_000));
      append("setup complete");
      await refresh();
    } catch (e) {
      append(`setup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onOpenStream() {
    if (!accounts.alice || !accounts.bob || !accounts.faucet) {
      append("run setup first");
      return;
    }
    if (total <= 0 || tranches <= 0 || duration <= 0) return;
    setBusy("open");
    try {
      const now = await syncBlock();
      const base = Math.floor(total / tranches);
      const rem = total - base * tranches;
      const step = Math.max(1, Math.ceil(duration / tranches));
      const id = genStreamId();
      const trancheList: Tranche[] = [];
      append(`opening stream ${id} (${tranches} tranches × ${base})`);

      for (let i = 0; i < tranches; i++) {
        const amount = i + 1 === tranches ? base + rem : base;
        const unlockBlock = now + (i + 1) * step;
        const noteId = await sendTranche({
          senderId: accounts.alice,
          recipientId: accounts.bob,
          faucetId: accounts.faucet,
          amount: BigInt(amount),
          timelockUntil: unlockBlock,
          reclaimAfter: 0,
        });
        trancheList.push({ index: i, amount, unlockBlock, status: "pending", noteId });
        append(`  tranche #${i} unlock@${unlockBlock} note=${noteId.slice(0, 10)}…`);
      }

      const stream: Stream = {
        id,
        createdAtBlock: now,
        total,
        durationBlocks: duration,
        tranches: trancheList,
      };
      upsertStream(stream);
      setStreams(loadStreams());
      append(`stream ${id} opened`);
    } catch (e) {
      append(`open failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onClaim(streamId: string) {
    if (!accounts.bob) return;
    const s = streams.find((x) => x.id === streamId);
    if (!s) return;
    setBusy(`claim:${streamId}`);
    try {
      const now = await syncBlock();
      const eligible = s.tranches.filter(
        (t) => t.status === "pending" && t.unlockBlock <= now && t.noteId,
      );
      if (eligible.length === 0) {
        append(`stream ${streamId}: no unlocked tranches yet`);
        return;
      }
      append(`claiming ${eligible.length} tranche(s) from ${streamId}…`);
      const txId = await consumeNoteIds(
        accounts.bob,
        eligible.map((t) => t.noteId!),
      );
      if (txId) append(`  tx ${txId.toHex()}`);
      const next = { ...s, tranches: s.tranches.map((t) => (eligible.includes(t) ? { ...t, status: "claimed" as const } : t)) };
      upsertStream(next);
      setStreams(loadStreams());
    } catch (e) {
      append(`claim failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onCancel(streamId: string) {
    if (!accounts.alice) return;
    const s = streams.find((x) => x.id === streamId);
    if (!s) return;
    setBusy(`cancel:${streamId}`);
    try {
      // P2IDE with reclaimAfter=0 lets sender reclaim any pending note at any block.
      const reclaimable = s.tranches.filter((t) => t.status === "pending" && t.noteId);
      if (reclaimable.length === 0) {
        append(`stream ${streamId}: nothing to reclaim`);
        return;
      }
      append(`reclaiming ${reclaimable.length} tranche(s) from ${streamId}…`);
      const txId = await consumeNoteIds(
        accounts.alice,
        reclaimable.map((t) => t.noteId!),
      );
      if (txId) append(`  tx ${txId.toHex()}`);
      const next = { ...s, tranches: s.tranches.map((t) => (reclaimable.includes(t) ? { ...t, status: "cancelled" as const } : t)) };
      upsertStream(next);
      setStreams(loadStreams());
    } catch (e) {
      append(`cancel failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Confidential Streaming · Miden</h1>
        <p className="text-[var(--muted)] mt-1 text-sm">
          Sablier-style payment streams using private notes (P2IDE) on Miden testnet.
          Note data — amounts, schedules, parties — stays off-chain;
          only commitments and nullifiers are public.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Card title="Network">
          <Row k="block (testnet)" v={block ?? "…"} />
          <Row k="rpc" v="rpc.testnet.miden.io" />
        </Card>
        <Card title="Accounts">
          <Row k="alice" v={accounts.alice ? short(accounts.alice) : "—"} />
          <Row k="bob" v={accounts.bob ? short(accounts.bob) : "—"} />
          <Row k="faucet" v={accounts.faucet ? short(accounts.faucet) : "—"} />
          <Row k="alice STREAM" v={accounts.alice && accounts.faucet ? aliceBal.toString() : "—"} />
          <Row k="bob STREAM" v={accounts.bob && accounts.faucet ? bobBal.toString() : "—"} />
        </Card>
      </section>

      <section className="mb-8">
        <Card title="1. Setup">
          <p className="text-sm text-[var(--muted)] mb-3">
            Create wallets for Alice (sender) and Bob (recipient), deploy the STREAM
            faucet, mint Alice an initial balance.
          </p>
          <button
            onClick={onSetup}
            disabled={busy !== null}
            className="px-4 py-2 rounded bg-[var(--accent)] text-black font-medium disabled:opacity-50"
          >
            {busy === "setup" ? "running…" : accounts.alice ? "re-run setup" : "run setup"}
          </button>
        </Card>
      </section>

      <section className="mb-8">
        <Card title="2. Open a stream (Alice → Bob)">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Field label="total" value={total} onChange={setTotal} />
            <Field label="tranches" value={tranches} onChange={setTranches} />
            <Field label="duration (blocks)" value={duration} onChange={setDuration} />
          </div>
          <button
            onClick={onOpenStream}
            disabled={busy !== null || !accounts.alice}
            className="px-4 py-2 rounded bg-[var(--accent)] text-black font-medium disabled:opacity-50"
          >
            {busy === "open" ? "opening…" : "open stream"}
          </button>
        </Card>
      </section>

      <section className="mb-8">
        <Card title="3. Streams">
          {streams.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">no streams yet.</p>
          ) : (
            <div className="space-y-4">
              {streams.map((s) => (
                <StreamView
                  key={s.id}
                  stream={s}
                  block={block ?? 0}
                  busy={busy}
                  onClaim={() => onClaim(s.id)}
                  onCancel={() => onCancel(s.id)}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      <section>
        <Card title="Activity log">
          <pre className="text-xs leading-relaxed text-[var(--muted)] whitespace-pre-wrap">
            {log.join("\n")}
          </pre>
        </Card>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--card)]">
      <h2 className="font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-[var(--muted)]">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col text-sm">
      <span className="text-[var(--muted)] mb-1">{label}</span>
      <input
        type="number"
        value={value}
        min={1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 font-mono"
      />
    </label>
  );
}

function StreamView({
  stream,
  block,
  busy,
  onClaim,
  onCancel,
}: {
  stream: Stream;
  block: number;
  busy: string | null;
  onClaim: () => void;
  onCancel: () => void;
}) {
  const claimed = stream.tranches.filter((t) => t.status === "claimed").length;
  const cancelled = stream.tranches.filter((t) => t.status === "cancelled").length;
  const pendingUnlocked = stream.tranches.filter(
    (t) => t.status === "pending" && t.unlockBlock <= block,
  ).length;
  const claimedAmount = stream.tranches
    .filter((t) => t.status === "claimed")
    .reduce((acc, t) => acc + t.amount, 0);

  return (
    <div className="border border-[var(--border)] rounded p-3">
      <div className="flex justify-between mb-2 text-sm">
        <span className="font-mono text-xs text-[var(--muted)]">stream {stream.id}</span>
        <span className="text-xs text-[var(--muted)]">
          claimed {claimedAmount}/{stream.total} · pending-unlocked {pendingUnlocked} · cancelled {cancelled}
        </span>
      </div>
      <div className="flex gap-1 mb-3">
        {stream.tranches.map((t) => (
          <div
            key={t.index}
            title={`#${t.index} unlock@${t.unlockBlock} amount=${t.amount} ${t.status}`}
            className={`flex-1 h-3 rounded-sm ${trancheColor(t, block)}`}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onClaim}
          disabled={busy !== null || pendingUnlocked === 0}
          className="px-3 py-1 text-sm rounded bg-emerald-600 disabled:opacity-30"
        >
          claim ({pendingUnlocked})
        </button>
        <button
          onClick={onCancel}
          disabled={busy !== null || claimed + cancelled === stream.tranches.length}
          className="px-3 py-1 text-sm rounded bg-rose-700 disabled:opacity-30"
        >
          cancel remaining
        </button>
      </div>
    </div>
  );
}

function trancheColor(t: Tranche, block: number): string {
  if (t.status === "claimed") return "bg-emerald-500";
  if (t.status === "cancelled") return "bg-rose-700";
  return t.unlockBlock <= block ? "bg-amber-400" : "bg-zinc-700";
}

function short(s: string): string {
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}
