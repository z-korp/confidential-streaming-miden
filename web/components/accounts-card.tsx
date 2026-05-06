"use client";

import { useState } from "react";
import { Check, Copy, Coins, RefreshCw, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, shortAddr } from "@/lib/utils";
import type { AccountsState } from "@/lib/storage";

export function AccountsCard({
  accounts,
  aliceBal,
  bobBal,
  onSetup,
  busy,
}: {
  accounts: AccountsState;
  aliceBal: bigint;
  bobBal: bigint;
  onSetup: () => void;
  busy: string | null;
}) {
  const ready = Boolean(accounts.alice && accounts.bob && accounts.faucet);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Accounts</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Alice and Bob live in this same browser session for the demo.
          </p>
        </div>
        <Button
          onClick={onSetup}
          disabled={busy !== null}
          variant={ready ? "outline" : "default"}
          size="sm"
        >
          {busy === "setup" ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Running…
            </>
          ) : ready ? (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run setup
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Run setup
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="grid gap-2.5">
        <AccountRow
          label="Alice"
          role="sender"
          accent="violet"
          id={accounts.alice}
          balance={accounts.alice && accounts.faucet ? aliceBal : null}
        />
        <AccountRow
          label="Bob"
          role="recipient"
          accent="sky"
          id={accounts.bob}
          balance={accounts.bob && accounts.faucet ? bobBal : null}
        />
        <AccountRow
          label="Faucet"
          role="STREAM"
          accent="amber"
          id={accounts.faucet}
        />
      </CardContent>
    </Card>
  );
}

function AccountRow({
  label,
  role,
  accent,
  id,
  balance,
}: {
  label: string;
  role: string;
  accent: "violet" | "sky" | "amber";
  id?: string;
  balance?: bigint | null;
}) {
  const dot =
    accent === "violet"
      ? "bg-violet-400/80"
      : accent === "sky"
        ? "bg-sky-400/80"
        : "bg-amber-400/80";
  const ring =
    accent === "violet"
      ? "ring-violet-500/20 bg-violet-500/10 text-violet-300"
      : accent === "sky"
        ? "ring-sky-500/20 bg-sky-500/10 text-sky-300"
        : "ring-amber-500/20 bg-amber-500/10 text-amber-300";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full ring-1",
            ring,
          )}
        >
          <User className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {role}
            </span>
          </div>
          <div className="mt-0.5 min-w-0 truncate font-mono text-xs text-muted-foreground">
            {id ? (
              <CopyAddress value={id} />
            ) : (
              <span className="italic">not created yet</span>
            )}
          </div>
        </div>
      </div>

      {balance !== undefined && (
        <div className="flex shrink-0 items-center gap-1.5 text-right">
          <Coins className={cn("h-3.5 w-3.5", dot, "bg-transparent")} />
          <div>
            <div className="font-mono text-sm tabular-nums">
              {balance != null ? balance.toLocaleString() : "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              STREAM
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
      title={value}
    >
      <span>{shortAddr(value)}</span>
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 opacity-60" />
      )}
    </button>
  );
}
