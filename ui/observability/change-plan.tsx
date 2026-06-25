import { useState } from "react";
import type { ReactNode } from "react";
import { postJson } from "./api";
import { Panel } from "./atoms";

// ── Change plan (dry-run) view ───────────────────────────────────────────────
interface PlanStep {
  index: number;
  command: string;
  path: string;
  op: string;
  risk: string;
  summary: string;
  lockoutRisk?: string;
}
interface ChangePlan {
  steps: PlanStep[];
  counts: { add: number; modify: number; remove: number; other: number; total: number };
  riskScore: number;
  grade: string;
  warnings: string[];
  reordered: boolean;
}
const OP_BADGE: Record<string, string> = {
  add: "+",
  set: "~",
  remove: "−",
  enable: "▲",
  disable: "▽",
  move: "⇅",
};

/** Paste intended commands and preview a risk-scored, safely-ordered plan (no device I/O). */
export function ChangePlanView(): ReactNode {
  const [script, setScript] = useState("");
  const [res, setRes] = useState<{ plan: ChangePlan; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await postJson<{ plan?: ChangePlan; text?: string; error?: string }>("/api/plan", {
      script,
    }).catch((): { plan?: ChangePlan; text?: string; error?: string } => ({
      error: "request failed",
    }));
    setBusy(false);
    if (r.error || !r.plan) {
      setErr(r.error ?? "no plan produced");
      setRes(null);
      return;
    }
    setRes({ plan: r.plan, text: r.text ?? "" });
  };

  const grade = res?.plan.grade ?? "";
  const gradeBad = grade === "critical" || grade === "high";

  return (
    <section className="view">
      <Panel
        title="Change plan — dry-run"
        className="reveal"
        extra={
          <span className="muted">
            terraform-style preview · pure analysis, never touches a device
          </span>
        }
      >
        <textarea
          className="plan-input"
          spellCheck={false}
          placeholder={
            "Paste intended RouterOS commands, one per line, e.g.\n/ip firewall filter add chain=input action=drop in-interface=WAN\n/ip address add address=10.0.0.1/24 interface=ether1\n/ip address remove [find address=192.168.88.1/24]"
          }
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button
            className="btn is-active"
            onClick={() => void run()}
            disabled={busy || !script.trim()}
          >
            {busy ? "Planning…" : "▸ Plan"}
          </button>
          {err && <span className="cfg-err">{err}</span>}
        </div>
      </Panel>

      {res && (
        <Panel
          title="Plan"
          className="reveal"
          extra={
            <span className={`cfg-status ${gradeBad ? "is-bad" : "is-ok"}`}>
              risk {res.plan.riskScore} · {grade}
            </span>
          }
        >
          <div className="legend" style={{ marginTop: 0 }}>
            <span>+{res.plan.counts.add} to add</span>
            <span>~{res.plan.counts.modify} to modify</span>
            <span>-{res.plan.counts.remove} to remove</span>
            {res.plan.reordered && <span>· reordered into a safe sequence</span>}
          </div>
          {res.plan.warnings.length > 0 && (
            <div className="cfg-errors" style={{ margin: "10px 0" }}>
              {res.plan.warnings.map((w, i) => (
                <div className="cfg-err" key={i} style={{ color: "var(--mt-warn)" }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          <div className="plan-steps">
            {res.plan.steps.map((s) => (
              <div className={`plan-step risk-${s.risk}`} key={s.index}>
                <span className="plan-op">{OP_BADGE[s.op] ?? "•"}</span>
                <code>{s.command}</code>
                {s.lockoutRisk && <span className="plan-lock">⚠ lock-out</span>}
                <span className="plan-risk">{s.risk}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </section>
  );
}
