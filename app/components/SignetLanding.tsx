"use client";

import { useLedger } from "@/lib/ledger";
import { Logo, LogoIcon } from "./Logo";

/* ─── Signet Seal SVG ─── */
function SealMark() {
  return (
    <svg
      viewBox="0 0 500 500"
      className="seal-reveal h-full w-full"
      aria-hidden="true"
    >
      {/* Outer ring */}
      <circle
        cx="250" cy="250" r="245"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.6"
        opacity="0.2"
      />
      {/* Text track */}
      <defs>
        <path
          id="sealTextPath"
          d="M250,250 m-200,0 a200,200 0 1,1 400,0 a200,200 0 1,1 -400,0"
        />
      </defs>
      <text
        fill="var(--accent)"
        opacity="0.18"
        fontSize="13"
        fontFamily="var(--font-geist-mono), monospace"
        letterSpacing="6"
      >
        <textPath href="#sealTextPath">
          SIGNET &#183; SAFE AGENT SESSIONS &#183; ON-CHAIN PERMISSIONS &#183; LEDGER SECURED &#183; EIP-7702 &#183;
        </textPath>
      </text>
      {/* Middle ring */}
      <circle
        cx="250" cy="250" r="165"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.5"
        opacity="0.12"
      />
      {/* Dashed ring — rotates */}
      <g className="spin-slow" style={{ transformOrigin: "250px 250px" }}>
        <circle
          cx="250" cy="250" r="140"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="0.4"
          strokeDasharray="8 12"
          opacity="0.15"
        />
      </g>
      {/* Inner ring */}
      <circle
        cx="250" cy="250" r="110"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.5"
        opacity="0.1"
      />
      {/* Center monogram */}
      <text
        x="250" y="290"
        textAnchor="middle"
        fontFamily="var(--font-syne), sans-serif"
        fontSize="140"
        fontWeight="800"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1"
        opacity="0.1"
      >
        S
      </text>
      {/* Notch marks at cardinal points */}
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1="250" y1="10"
          x2="250" y2="30"
          stroke="var(--accent)"
          strokeWidth="0.5"
          opacity="0.2"
          transform={`rotate(${deg} 250 250)`}
        />
      ))}
      {/* Small dots at 45-degree positions */}
      {[45, 135, 225, 315].map((deg) => (
        <circle
          key={deg}
          cx="250"
          cy="20"
          r="2"
          fill="var(--accent)"
          opacity="0.12"
          transform={`rotate(${deg} 250 250)`}
        />
      ))}
    </svg>
  );
}

/* ─── Marquee Strip ─── */
function MarqueeStrip() {
  const items = [
    "ON-CHAIN ENFORCEMENT",
    "GRANULAR SCOPES",
    "HUMAN-IN-THE-LOOP",
    "EIP-7702",
    "SESSION KEYS",
    "SMART CONTRACT LOGIC",
    "SPEND LIMITS",
    "TIME-BOUNDED",
    "LEDGER APPROVED",
  ];

  const track = items.map((t) => (
    <span key={t} className="flex items-center gap-6">
      <span className="whitespace-nowrap text-[11px] font-medium tracking-[0.25em] text-[var(--muted)]">
        {t}
      </span>
      <span className="h-1 w-1 rounded-full bg-[var(--accent)] opacity-40" />
    </span>
  ));

  return (
    <div className="relative overflow-hidden border-y border-[var(--rule)] py-5">
      <div className="marquee-track flex w-max items-center gap-6">
        {track}
        {/* Duplicate for seamless loop */}
        {track}
      </div>
    </div>
  );
}

/* ─── Main Landing ─── */
export function SignetLanding() {
  const { connect, connectionStatus, error } = useLedger();
  const isLoading =
    connectionStatus === "discovering" || connectionStatus === "connecting";

  return (
    <div className="grain grid-bg relative min-h-screen bg-black text-[var(--foreground)] overflow-x-hidden">

      {/* ══════ NAV ══════ */}
      <nav className="reveal-fade relative z-20 flex items-center justify-between px-8 py-6 md:px-12 lg:px-20">
        <Logo size="md" />

        <button
          onClick={connect}
          disabled={isLoading}
          className="rounded-full border border-[var(--foreground)]/10 bg-transparent px-5 py-2 text-[13px] font-medium text-[var(--foreground)]/70 transition-all hover:border-[var(--accent)]/40 hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-40"
        >
          {isLoading ? "Connecting..." : "Launch App"}
        </button>
      </nav>

      {/* ══════ HERO ══════ */}
      <section className="relative flex min-h-[85vh] flex-col items-center justify-center px-8 pb-24 pt-8 md:px-12">
        {/* Seal watermark — centered behind text */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[480px] w-[480px] md:h-[600px] md:w-[600px] lg:h-[700px] lg:w-[700px]">
            <SealMark />
          </div>
        </div>

        {/* Ambient glow */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]/[0.03] blur-[150px]" />

        {/* Content */}
        <div className="relative z-10 max-w-4xl text-center">
          <p
            className="reveal-up mb-8 font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-[var(--accent)]"
            style={{ animationDelay: "0.1s" }}
          >
            The Programmable Economy, Secured
          </p>

          <h1
            className="reveal-up font-[var(--font-syne)] text-[clamp(2.8rem,7vw,6.5rem)] font-extrabold leading-[0.95] tracking-[-0.03em]"
            style={{ animationDelay: "0.2s" }}
          >
            Stop giving agents
            <br />
            <span className="text-[var(--accent)]">your private keys</span>
          </h1>

          <p
            className="reveal-up mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--muted)] md:text-lg"
            style={{ animationDelay: "0.4s" }}
          >
            Signet creates on-chain session scopes for AI agents.
            Granular. Time-limited. Enforced by smart contracts.
            Your Ledger stays in control.
          </p>

          <div
            className="reveal-up mt-12 flex flex-col items-center gap-4"
            style={{ animationDelay: "0.55s" }}
          >
            <button
              onClick={connect}
              disabled={isLoading}
              className="group relative overflow-hidden rounded-full bg-[var(--accent)] px-10 py-4 text-[15px] font-semibold text-black transition-all hover:shadow-[0_0_60px_rgba(232,82,14,0.25)] disabled:cursor-wait disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center gap-3">
                {isLoading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  <>
                    Connect Ledger
                    <span className="inline-block transition-transform group-hover:translate-x-1">&rarr;</span>
                  </>
                )}
              </span>
              {/* Hover sheen */}
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </button>
            <span className="font-mono text-[11px] text-[var(--muted)]/60">
              Requires Ledger hardware wallet via USB
            </span>
          </div>

          {error && (
            <div className="mx-auto mt-6 max-w-md rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      </section>

      {/* ══════ MARQUEE ══════ */}
      <MarqueeStrip />

      {/* ══════ THE PROBLEM ══════ */}
      <section className="px-8 py-28 md:px-12 lg:px-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid items-start gap-16 lg:grid-cols-[1fr,1.2fr]">
            {/* Left: Statement */}
            <div>
              <p className="mb-6 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-[var(--accent)]">
                The vulnerability
              </p>
              <h2 className="font-[var(--font-syne)] text-3xl font-bold leading-[1.15] md:text-4xl">
                Every AI agent today
                holds a loaded gun
              </h2>
              <p className="mt-6 text-base leading-relaxed text-[var(--muted)]">
                To transact autonomously, agents need your private key.
                One prompt injection, one compromised model, one bad API call
                &mdash; and there are no guardrails. No limits. No undo.
              </p>
            </div>

            {/* Right: Before/After contrast */}
            <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-[var(--rule)]">
              {/* Before */}
              <div className="bg-[var(--surface)] p-7">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10 font-mono text-[10px] font-bold text-red-400">
                    !
                  </span>
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-red-400/80">
                    Without Signet
                  </span>
                </div>
                <div className="space-y-2.5 font-mono text-[13px] leading-relaxed text-[var(--muted)]">
                  <p><span className="mr-2 text-red-500/40">&mdash;</span>Agent holds full private key access</p>
                  <p><span className="mr-2 text-red-500/40">&mdash;</span>No spending limits or boundaries</p>
                  <p><span className="mr-2 text-red-500/40">&mdash;</span>Prompt injection drains everything</p>
                  <p><span className="mr-2 text-red-500/40">&mdash;</span>Zero human oversight at runtime</p>
                </div>
              </div>
              {/* After */}
              <div className="bg-[var(--surface)] p-7">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent)]/10 font-mono text-[10px] font-bold text-[var(--accent)]">
                    &#10003;
                  </span>
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-[var(--accent)]/80">
                    With Signet
                  </span>
                </div>
                <div className="space-y-2.5 font-mono text-[13px] leading-relaxed text-[var(--muted)]">
                  <p><span className="mr-2 text-[var(--accent)]/40">&mdash;</span>Agent gets a scoped session key</p>
                  <p><span className="mr-2 text-[var(--accent)]/40">&mdash;</span>Spend limits enforced on-chain</p>
                  <p><span className="mr-2 text-[var(--accent)]/40">&mdash;</span>Contract and function restrictions</p>
                  <p><span className="mr-2 text-[var(--accent)]/40">&mdash;</span>Out-of-scope? Ledger asks you first</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════ HOW IT WORKS ══════ */}
      <section className="border-t border-[var(--rule)] px-8 py-28 md:px-12 lg:px-20">
        <div className="mx-auto max-w-5xl">
          <p className="mb-6 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-[var(--accent)]">
            How it works
          </p>
          <h2 className="mb-20 max-w-lg font-[var(--font-syne)] text-3xl font-bold leading-[1.15] md:text-4xl">
            Three steps to safe autonomy
          </h2>

          {/* Numbered principles — editorial stack */}
          <div className="flex flex-col">
            {[
              {
                n: "01",
                title: "Connect your Ledger",
                body: "Your hardware wallet is your identity and your authority. Plug in via USB — private keys never leave the secure element. Your EOA becomes a smart account through EIP-7702 delegation.",
              },
              {
                n: "02",
                title: "Define agent scopes",
                body: "Set which contracts the agent can call, which functions it can invoke, how much it can spend, and for how long. Every parameter is written to smart contract storage — not an API layer, not a database. The EVM itself enforces your rules.",
              },
              {
                n: "03",
                title: "Monitor and approve",
                body: "Agents operate freely within their granted bounds. When a transaction exceeds the scope — higher value, unauthorized contract, expired session — it's escalated to your Ledger for explicit approval. You stay in the loop without being in the way.",
              },
            ].map((item, i) => (
              <div key={item.n} className="group grid grid-cols-[auto,1fr] gap-8 border-t border-[var(--rule)] py-10 md:grid-cols-[80px,260px,1fr] md:gap-12 md:py-14">
                {/* Number */}
                <span className="font-[var(--font-syne)] text-5xl font-extrabold text-[var(--foreground)]/[0.04] transition-colors group-hover:text-[var(--accent)]/15 md:text-6xl">
                  {item.n}
                </span>
                {/* Title + Body */}
                <div className="col-span-1 md:col-span-2">
                  <h3 className="font-[var(--font-syne)] text-xl font-bold md:text-2xl">
                    {item.title}
                  </h3>
                  <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
            {/* Final rule */}
            <div className="border-t border-[var(--rule)]" />
          </div>
        </div>
      </section>

      {/* ══════ FINAL CTA ══════ */}
      <section className="relative overflow-hidden px-8 py-32 md:px-12">
        {/* Background seal echo */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-40">
          <div className="h-[500px] w-[500px]">
            <SealMark />
          </div>
        </div>

        <div className="relative z-10 mx-auto max-w-2xl text-center">
          <h2 className="font-[var(--font-syne)] text-3xl font-extrabold leading-[1.1] md:text-5xl lg:text-6xl">
            Stop sharing keys.
            <br />
            <span className="text-[var(--accent)]">Set scopes.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base text-[var(--muted)] md:text-lg">
            Connect your Ledger and grant your first agent session
            in under a minute.
          </p>
          <button
            onClick={connect}
            disabled={isLoading}
            className="group relative mt-12 overflow-hidden rounded-full bg-[var(--accent)] px-12 py-4 text-[15px] font-semibold text-black transition-all hover:shadow-[0_0_80px_rgba(232,82,14,0.2)] disabled:cursor-wait disabled:opacity-50"
          >
            <span className="relative z-10">
              {isLoading ? "Connecting..." : "Connect Ledger"}
            </span>
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </button>
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer className="border-t border-[var(--rule)] px-8 py-8 md:px-12 lg:px-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoIcon size={20} />
            <span className="text-[12px] text-[var(--muted)]/60">Signet</span>
          </div>
          <p className="font-mono text-[11px] text-[var(--muted)]/40">
            EIP-7702 &middot; Ledger WebHID &middot; Base Sepolia
          </p>
        </div>
      </footer>
    </div>
  );
}
