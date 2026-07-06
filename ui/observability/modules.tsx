import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson } from "./api";
import { Panel } from "./atoms";

// ── Tool Modules view ────────────────────────────────────────────────────────
// Every catalog module with a live on/off toggle. Flipping one writes the
// config file's `tools` block (added to disabledModules / enabledModules) and
// applies it live; the MCP client must reconnect for the tool list to change.

interface ModuleItem {
  slug: string;
  label: string;
  group: string;
  description: string;
  toolCount: number;
  enabled: boolean;
}
interface ConfigSource {
  path: string;
  fromFile: boolean;
}
interface ModuleSurface {
  modules: ModuleItem[];
  total: number;
  enabledModules: number;
  enabledTools: number;
  totalTools: number;
  hasAllowList: boolean;
  source?: ConfigSource;
  appViews?: boolean;
}
interface ToggleResult extends ModuleSurface {
  ok?: boolean;
  persisted?: boolean;
  warning?: string;
  error?: string;
}

/** A single module row: checkbox + name/slug + tool count + scope description. */
function ModuleRow({
  m,
  busy,
  onToggle,
}: {
  m: ModuleItem;
  busy: boolean;
  onToggle: (slug: string, enabled: boolean) => void;
}): ReactNode {
  return (
    <label className="mod-row" data-on={m.enabled ? "1" : undefined} title={m.description}>
      <input
        type="checkbox"
        checked={m.enabled}
        disabled={busy}
        onChange={() => onToggle(m.slug, !m.enabled)}
      />
      <span className="mod-row__main">
        <span className="mod-row__name">
          {m.label}
          <code className="mod-row__slug">{m.slug}</code>
        </span>
        <span className="mod-row__desc muted">{m.description}</span>
      </span>
      <span className="mod-row__count muted">
        {m.toolCount} tool{m.toolCount === 1 ? "" : "s"}
      </span>
    </label>
  );
}

/** List every module grouped by scope, with per-module and bulk on/off toggles. */
export function ModulesView(): ReactNode {
  const [data, setData] = useState<ModuleSurface | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appViews, setAppViews] = useState<boolean>(false);
  const [appViewsBusy, setAppViewsBusy] = useState(false);

  const load = useCallback(() => {
    void api<ModuleSurface>("/api/modules")
      .then((d) => {
        setData(d);
        if (d.appViews !== undefined) setAppViews(d.appViews);
      })
      .catch(() => setMsg("could not load modules"));
  }, []);
  useEffect(() => load(), [load]);

  // Apply a toggle result (or the initial load) into state, keeping the surface
  // counts and every module's enabled flag in sync with the server's answer.
  const adopt = (r: ModuleSurface): void => setData((prev) => (prev ? { ...prev, ...r } : r));

  const toggle = useCallback(
    async (slug: string, enabled: boolean): Promise<void> => {
      setBusy((s) => new Set(s).add(slug));
      // Optimistic flip so the checkbox responds instantly.
      setData((prev) =>
        prev
          ? { ...prev, modules: prev.modules.map((m) => (m.slug === slug ? { ...m, enabled } : m)) }
          : prev,
      );
      const r = await postJson<ToggleResult>("/api/modules/toggle", { slug, enabled }).catch(
        (): ToggleResult => ({ error: "request failed" }) as ToggleResult,
      );
      setBusy((s) => {
        const next = new Set(s);
        next.delete(slug);
        return next;
      });
      if (r.error || r.ok === false) {
        setMsg(r.error ?? "toggle failed");
        load(); // resync from the server (undo the optimistic flip)
        return;
      }
      adopt(r);
      const where = r.persisted ? "saved to config" : "applied live (not saved)";
      const warn = r.warning ? ` ⚠ ${r.warning}` : "";
      setMsg(
        `${slug} ${enabled ? "enabled" : "disabled"} — ${where}. Reconnect the MCP client ` +
          `(or restart the server) for the tool list to update.${warn}`,
      );
    },
    [load],
  );

  // Bulk enable/disable every module currently shown (respects the search filter)
  // by toggling each one whose state differs from the target — sequentially so
  // each write lands on the prior result's filter.
  const bulk = useCallback(
    async (slugs: string[], enabled: boolean): Promise<void> => {
      for (const slug of slugs) await toggle(slug, enabled);
    },
    [toggle],
  );

  const toggleAppViews = useCallback(
    async (enabled: boolean): Promise<void> => {
      setAppViewsBusy(true);
      setAppViews(enabled);
      const r = await postJson<{
        ok?: boolean;
        persisted?: boolean;
        warning?: string;
        error?: string;
        appViews?: boolean;
      }>("/api/modules/app-views", { enabled }).catch(() => ({ error: "request failed" }));
      setAppViewsBusy(false);
      if ("error" in r && r.error) {
        setMsg(r.error);
        setAppViews(!enabled);
        return;
      }
      if ("appViews" in r && r.appViews !== undefined) setAppViews(r.appViews);
      const where = "persisted" in r && r.persisted ? "saved to config" : "applied live (not saved)";
      const warn = "warning" in r && r.warning ? ` — ${r.warning}` : "";
      setMsg(
        `App views ${enabled ? "enabled" : "disabled"} — ${where}. ` +
          `Restart the server for the change to take effect.${warn}`,
      );
    },
    [],
  );

  const groups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const match = (m: ModuleItem): boolean =>
      !q ||
      m.slug.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.group.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q);
    const byGroup = new Map<string, ModuleItem[]>();
    for (const m of data.modules) {
      if (!match(m)) continue;
      const arr = byGroup.get(m.group) ?? [];
      arr.push(m);
      byGroup.set(m.group, arr);
    }
    return [...byGroup.entries()].map(([group, modules]) => ({ group, modules }));
  }, [data, query]);

  if (!data) return <div className="muted">loading modules…</div>;

  const shown = groups.reduce((n, g) => n + g.modules.length, 0);

  return (
    <section className="view">
      <Panel
        title="Tool modules"
        className="reveal"
        extra={
          <>
            <span className="muted">
              {data.enabledModules}/{data.total} modules · {data.enabledTools}/{data.totalTools}{" "}
              tools exposed
            </span>
            <button className="btn" onClick={load} style={{ marginLeft: 10 }}>
              ↻ Refresh
            </button>
          </>
        }
      >
        <label
          className="mod-row"
          data-on={appViews ? "1" : undefined}
          title="Emit MCP App view metadata (_meta.ui) on read tools"
          style={{ marginBottom: 10, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}
        >
          <input
            type="checkbox"
            checked={appViews}
            disabled={appViewsBusy}
            onChange={() => void toggleAppViews(!appViews)}
          />
          <span className="mod-row__main">
            <span className="mod-row__name">MCP App Views</span>
            <span className="mod-row__desc muted">
              When on, read tools emit interactive table/detail widgets via <code>_meta.ui</code>.
              Disable to keep the LLM context lean. Requires server restart.
            </span>
          </span>
        </label>

        <div className="legend" style={{ margin: "0 0 10px" }}>
          <span>
            writes to: <code>{data.source?.path ?? "config file"}</code>
          </span>
          <span>{data.hasAllowList ? "allow-list active" : "all modules on by default"}</span>
        </div>

        <p className="muted" style={{ margin: "0 0 12px", fontSize: 12 }}>
          Toggle a module to expose or hide all of its tools. Disabling adds it to{" "}
          <code>tools.disabledModules</code> in your config file; enabling removes it (or adds it to{" "}
          <code>tools.enabledModules</code> when an allow-list is in force). Trimming the surface
          below ~150–200 tools makes every remaining tool reliably findable by the MCP client. The
          client must reconnect for changes to take effect.
        </p>

        <div className="mod-toolbar">
          <input
            className="input"
            placeholder="Filter modules by name, slug, group or description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() =>
              void bulk(
                data.modules.filter((m) => !m.enabled).map((m) => m.slug),
                true,
              )
            }
          >
            Enable all
          </button>{" "}
          <button
            className="btn"
            onClick={() =>
              void bulk(
                data.modules.filter((m) => m.enabled).map((m) => m.slug),
                false,
              )
            }
          >
            Disable all
          </button>
        </div>

        {msg && (
          <div className="cfg-msg" style={{ marginTop: 12 }}>
            {msg}
          </div>
        )}

        {shown === 0 ? (
          <div className="muted" style={{ padding: 12 }}>
            No modules match “{query}”.
          </div>
        ) : (
          <div className="mod-groups">
            {groups.map(({ group, modules }) => {
              const on = modules.filter((m) => m.enabled).length;
              const slugs = modules.map((m) => m.slug);
              return (
                <div key={group} className="mod-group">
                  <div className="mod-group__hd">
                    <h3 className="mod-group__title">{group}</h3>
                    <span className="muted">
                      {on}/{modules.length} on
                    </span>
                    <span style={{ flex: 1 }} />
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        void bulk(
                          slugs.filter((s) => {
                            const m = modules.find((x) => x.slug === s);
                            return m ? !m.enabled : false;
                          }),
                          true,
                        )
                      }
                    >
                      Enable group
                    </button>{" "}
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        void bulk(
                          slugs.filter((s) => {
                            const m = modules.find((x) => x.slug === s);
                            return m ? m.enabled : false;
                          }),
                          false,
                        )
                      }
                    >
                      Disable group
                    </button>
                  </div>
                  <div className="mod-list">
                    {modules.map((m) => (
                      <ModuleRow
                        key={m.slug}
                        m={m}
                        busy={busy.has(m.slug)}
                        onToggle={(slug, enabled) => void toggle(slug, enabled)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </section>
  );
}
