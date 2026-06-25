import { useState } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "./atoms";
import { bytes, ms } from "./format";
import { Button } from "./geist";
import {
  formatInputJson,
  highlightDeviceOutput,
  JsonView,
  loadPrettyInput,
  savePrettyInput,
} from "./highlight";
import type { ToolEvent } from "./types";

// ── detail drawer ────────────────────────────────────────────────────────────
export function DetailDrawer({
  event,
  onClose,
}: {
  event: ToolEvent;
  onClose: () => void;
}): ReactNode {
  // Pretty-print INPUT JSON by default; the toggle is remembered across drawers.
  const [prettyInput, setPrettyInput] = useState(loadPrettyInput);
  const togglePretty = (): void =>
    setPrettyInput((on) => {
      const next = !on;
      savePrettyInput(next);
      return next;
    });
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet__hd">
          <span className={`risk risk-${event.risk}`}>{event.risk}</span>
          <h3 className="sheet__tool">
            {event.tool}
            <CopyButton text={event.tool} className="iconbtn" icon title="Copy tool name" />
          </h3>
          <span style={{ flex: 1 }} />
          <Button type="secondary" size="sm" onClick={onClose}>
            ✕ Close
          </Button>
        </div>
        <div className="kv__body">
          <div className="kv__k">title</div>
          <div className="kv__v">{event.title}</div>
          <div className="kv__k">time</div>
          <div className="kv__v">
            {new Date(event.ts).toLocaleString(undefined, { hour12: false })}
          </div>
          <div className="kv__k">device</div>
          <div className="kv__v">{event.device ?? "—"}</div>
          <div className="kv__k">transport</div>
          <div className="kv__v">{event.transport ?? "—"}</div>
          <div className="kv__k">duration</div>
          <div className="kv__v">{ms(event.durationMs)}</div>
          <div className="kv__k">status</div>
          <div className="kv__v">
            <span className={event.isError ? "status-err" : "status-ok"}>
              {event.isError ? "error" : "ok"}
            </span>
          </div>
          <div className="kv__k">output size</div>
          <div className="kv__v">
            {bytes(event.outputBytes)}
            {event.truncated ? " (truncated)" : ""}
          </div>
          <div className="kv__k">structured</div>
          <div className="kv__v">
            {event.hasStructured ? "yes (renders an MCP App view)" : "no"}
          </div>
        </div>
        {event.error && (
          <>
            <h2 className="muted">ERROR</h2>
            <pre className="body" style={{ color: "var(--mt-bad)" }}>
              {event.error}
            </pre>
          </>
        )}
        <div className="sheet__hd">
          <h2 className="muted" style={{ margin: 0 }}>
            INPUT
          </h2>
          <span style={{ flex: 1 }} />
          {event.input && (
            <Button
              type="secondary"
              size="sm"
              ghost
              onClick={togglePretty}
              title={
                prettyInput
                  ? "Showing pretty-printed JSON — click for raw"
                  : "Showing raw JSON — click to pretty-print"
              }
            >
              {prettyInput ? "✦ Pretty" : "{ } Raw"}
            </Button>
          )}
          <CopyButton text={event.input} title="Copy input JSON" />
        </div>
        {event.input ? (
          <JsonView value={formatInputJson(event.input, prettyInput)} />
        ) : (
          <pre className="body">—</pre>
        )}
        <div className="sheet__hd">
          <h2 className="muted" style={{ margin: 0 }}>
            OUTPUT
          </h2>
          <span style={{ flex: 1 }} />
          <CopyButton text={event.output} title="Copy output" />
        </div>
        <pre className="body ros">{event.output ? highlightDeviceOutput(event.output) : "—"}</pre>
      </div>
    </div>
  );
}
