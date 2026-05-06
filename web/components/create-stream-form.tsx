"use client";

import { ArrowRight, Coins, Layers, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { blocksToHuman } from "@/lib/time";

export function CreateStreamForm({
  total,
  tranches,
  duration,
  onTotal,
  onTranches,
  onDuration,
  onSubmit,
  busy,
  disabled,
}: {
  total: number;
  tranches: number;
  duration: number;
  onTotal: (n: number) => void;
  onTranches: (n: number) => void;
  onDuration: (n: number) => void;
  onSubmit: () => void;
  busy: string | null;
  disabled: boolean;
}) {
  const perTranche = tranches > 0 ? Math.floor(total / tranches) : 0;
  const stepBlocks = tranches > 0 ? Math.max(1, Math.ceil(duration / tranches)) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Open a stream</CardTitle>
          <span className="text-xs text-muted-foreground">Alice → Bob</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Splits the total into N timelocked private notes (P2IDE) emitted in a
          single transaction.
        </p>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            icon={<Coins className="h-3.5 w-3.5" />}
            label="Total"
            hint="STREAM"
            value={total}
            onChange={onTotal}
          />
          <Field
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Tranches"
            hint="notes"
            value={tranches}
            onChange={onTranches}
          />
          <Field
            icon={<Timer className="h-3.5 w-3.5" />}
            label="Duration"
            hint={`blocks · ~${blocksToHuman(duration)}`}
            value={duration}
            onChange={onDuration}
          />
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          ≈{" "}
          <span className="font-mono text-foreground">{perTranche}</span>{" "}
          STREAM per tranche, unlocking every{" "}
          <span className="font-mono text-foreground">~{blocksToHuman(stepBlocks)}</span>{" "}
          ({stepBlocks} block{stepBlocks === 1 ? "" : "s"}). Total duration{" "}
          <span className="font-mono text-foreground">~{blocksToHuman(duration)}</span>.
        </div>

        <Button
          onClick={onSubmit}
          disabled={busy !== null || disabled || total <= 0 || tranches <= 0 || duration <= 0}
          size="lg"
          className="w-full"
        >
          {busy === "open" ? (
            "Opening…"
          ) : (
            <>
              Open stream
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
        <span className="text-[10px] normal-case tracking-normal opacity-70">
          ({hint})
        </span>
      </span>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="font-mono text-sm tabular-nums"
      />
    </label>
  );
}
