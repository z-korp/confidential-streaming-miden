"use client";

import dynamic from "next/dynamic";
import { ArrowDown, EyeOff, Layers, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const StoneHero = dynamic(() => import("./stone-hero"), { ssr: false });

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      <div aria-hidden className="absolute inset-0 hero-grid" />
      <div aria-hidden className="absolute inset-0 opacity-60">
        <StoneHero />
      </div>
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background"
      />

      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-24 pb-20 text-center sm:px-6 sm:pt-32 sm:pb-28">
        <Badge
          variant="outline"
          className="rounded-full border-border/80 bg-background/40 px-3 py-1 text-xs font-normal text-muted-foreground backdrop-blur-sm"
        >
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          Miden testnet · private notes (P2IDE)
        </Badge>

        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
          Confidential
          <br />
          <span className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent">
            Token Streaming
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
          Sablier-style payment streams on Miden. Note amounts, parties, and
          unlock schedules stay off-chain — only commitments and nullifiers go
          on-chain.
        </p>

        <a
          href="#dashboard"
          className="mt-10 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Open the demo
          <ArrowDown className="h-4 w-4" />
        </a>

        <div className="mt-16 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          <Feature
            icon={<EyeOff className="h-4 w-4" />}
            title="Private notes"
            body="Amounts and parties never appear on-chain. Only commitments and nullifiers."
          />
          <Feature
            icon={<Layers className="h-4 w-4" />}
            title="Tranched unlocks"
            body="A stream is N timelocked private notes (P2IDE), one per tranche."
          />
          <Feature
            icon={<Zap className="h-4 w-4" />}
            title="Local or remote prover"
            body="Generate the STARK in-browser, or offload to Miden's hosted prover."
          />
        </div>
      </div>
    </section>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-5 text-left backdrop-blur-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-foreground">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
