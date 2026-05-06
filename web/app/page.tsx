"use client";

import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";

import {
  createStreamFaucet,
  createWallet,
  getBalance,
  getProver,
  mintTo,
  sendTranches,
  syncBlock,
  consumeNoteIds,
} from "@/lib/miden";
import {
  AccountsState,
  ProverMode,
  Stream,
  Tranche,
  genStreamId,
  loadAccounts,
  loadProverMode,
  loadStreams,
  saveAccounts,
  saveProverMode,
  upsertStream,
} from "@/lib/storage";

import { Hero } from "@/components/hero";
import { NetworkBar } from "@/components/network-bar";
import { AccountsCard } from "@/components/accounts-card";
import { CreateStreamForm } from "@/components/create-stream-form";
import { StreamCard } from "@/components/stream-card";
import { ActivityLog } from "@/components/activity-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  const [block, setBlock] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<AccountsState>({});
  const [streams, setStreams] = useState<Stream[]>([]);
  const [aliceBal, setAliceBal] = useState<bigint>(BigInt(0));
  const [bobBal, setBobBal] = useState<bigint>(BigInt(0));
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [proverMode, setProverModeState] = useState<ProverMode>("local");

  const [total, setTotal] = useState(1000);
  const [tranches, setTranches] = useState(5);
  const [duration, setDuration] = useState(20);

  const append = (msg: string) =>
    setLog((l) =>
      [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 200),
    );

  // Time `fn`, return its result. Logs the wall-clock duration with the active
  // prover mode so it's easy to compare runs side-by-side in the activity log.
  async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    append(`${label} [${proverMode}] starting…`);
    try {
      const r = await fn();
      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      append(`${label} [${proverMode}] done in ${dt}s`);
      return r;
    } catch (e) {
      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      append(`${label} [${proverMode}] failed after ${dt}s: ${(e as Error).message}`);
      throw e;
    }
  }

  function changeProverMode(m: ProverMode) {
    setProverModeState(m);
    saveProverMode(m);
    append(`prover switched → ${m}`);
  }

  useEffect(() => {
    setAccounts(loadAccounts());
    setStreams(loadStreams());
    setProverModeState(loadProverMode());
  }, []);

  async function refresh() {
    try {
      const b = await syncBlock();
      setBlock(b);
      if (accounts.alice && accounts.faucet)
        setAliceBal(await getBalance(accounts.alice, accounts.faucet));
      if (accounts.bob && accounts.faucet)
        setBobBal(await getBalance(accounts.bob, accounts.faucet));
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
      const prover = await getProver(proverMode);
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

      await timed("mint 100k STREAM → Alice", () =>
        mintTo(next.faucet!, next.alice!, BigInt(100_000), prover),
      );
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
      const prover = await getProver(proverMode);
      const now = await syncBlock();
      const base = Math.floor(total / tranches);
      const rem = total - base * tranches;
      const step = Math.max(1, Math.ceil(duration / tranches));
      const id = genStreamId();
      append(`opening stream ${id} (${tranches} tranches × ${base}, single tx)`);

      const specs = Array.from({ length: tranches }, (_, i) => ({
        amount: i + 1 === tranches ? base + rem : base,
        unlockBlock: now + (i + 1) * step,
      }));

      const noteIds = await timed(`open ${tranches}-tranche stream`, () =>
        sendTranches({
          senderId: accounts.alice!,
          recipientId: accounts.bob!,
          faucetId: accounts.faucet!,
          tranches: specs.map((s) => ({
            amount: BigInt(s.amount),
            timelockUntil: s.unlockBlock,
            reclaimAfter: 0,
          })),
          prover,
        }),
      );

      const trancheList: Tranche[] = specs.map((s, i) => ({
        index: i,
        amount: s.amount,
        unlockBlock: s.unlockBlock,
        status: "pending",
        noteId: noteIds[i],
      }));
      for (const t of trancheList) {
        append(`  tranche #${t.index} unlock@${t.unlockBlock} note=${t.noteId!.slice(0, 10)}…`);
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
      const prover = await getProver(proverMode);
      const now = await syncBlock();
      const eligible = s.tranches.filter(
        (t) => t.status === "pending" && t.unlockBlock <= now && t.noteId,
      );
      if (eligible.length === 0) {
        append(`stream ${streamId}: no unlocked tranches yet`);
        return;
      }
      const txId = await timed(`claim ${eligible.length} tranche(s)`, () =>
        consumeNoteIds(
          accounts.bob!,
          eligible.map((t) => t.noteId!),
          prover,
        ),
      );
      if (txId) append(`  tx ${txId.toHex()}`);
      const next = {
        ...s,
        tranches: s.tranches.map((t) =>
          eligible.includes(t) ? { ...t, status: "claimed" as const } : t,
        ),
      };
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
      const prover = await getProver(proverMode);
      // P2IDE with reclaimAfter=0 lets sender reclaim any pending note at any block.
      const reclaimable = s.tranches.filter((t) => t.status === "pending" && t.noteId);
      if (reclaimable.length === 0) {
        append(`stream ${streamId}: nothing to reclaim`);
        return;
      }
      const txId = await timed(`reclaim ${reclaimable.length} tranche(s)`, () =>
        consumeNoteIds(
          accounts.alice!,
          reclaimable.map((t) => t.noteId!),
          prover,
        ),
      );
      if (txId) append(`  tx ${txId.toHex()}`);
      const next = {
        ...s,
        tranches: s.tranches.map((t) =>
          reclaimable.includes(t) ? { ...t, status: "cancelled" as const } : t,
        ),
      };
      upsertStream(next);
      setStreams(loadStreams());
    } catch (e) {
      append(`cancel failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const accountsReady = Boolean(
    accounts.alice && accounts.bob && accounts.faucet,
  );

  return (
    <main>
      {/* Top nav */}
      <nav className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <span className="text-sm font-semibold tracking-tight">
              Confidential Streaming · Miden
            </span>
          </div>
          <a
            href="https://github.com/0xMiden"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            miden-base ↗
          </a>
        </div>
      </nav>

      <Hero />

      <section
        id="dashboard"
        className="mx-auto max-w-6xl scroll-mt-16 px-4 py-12 sm:px-6 sm:py-16"
      >
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Demo
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Live dashboard
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Run setup once to provision Alice, Bob and the STREAM faucet. Open a
            stream, then claim or cancel tranches as blocks tick by on testnet.
          </p>
        </header>

        <div className="mb-6">
          <NetworkBar
            block={block}
            proverMode={proverMode}
            onChangeProver={changeProverMode}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <AccountsCard
            accounts={accounts}
            aliceBal={aliceBal}
            bobBal={bobBal}
            onSetup={onSetup}
            busy={busy}
          />
          <CreateStreamForm
            total={total}
            tranches={tranches}
            duration={duration}
            onTotal={setTotal}
            onTranches={setTranches}
            onDuration={setDuration}
            onSubmit={onOpenStream}
            busy={busy}
            disabled={!accountsReady}
          />
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Streams</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each card shows tranche progress and lets Bob claim or Alice
                  cancel.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {streams.length} {streams.length === 1 ? "stream" : "streams"}
              </span>
            </CardHeader>
            <CardContent>
              {streams.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-secondary/20 px-6 py-12 text-center">
                  <Inbox className="h-6 w-6 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">No streams yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {accountsReady
                        ? "Open your first stream above to see it here."
                        : "Run setup, then open your first stream."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  {streams.map((s) => (
                    <StreamCard
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
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <ActivityLog log={log} onClear={() => setLog([])} />
        </div>
      </section>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
          <span>Confidential Streaming · zkorp</span>
          <span>Built on Miden testnet</span>
        </div>
      </footer>
    </main>
  );
}
