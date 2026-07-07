/**
 * Interactive, schema-driven config form. Renders `CONFIG_SECTIONS` as cards; each
 * section card shows a summary + an active/deactivate toggle and opens an edit
 * Sheet with its fields. Devices are sub-cards with add/edit sheets. Everything
 * mutates ONE `cfg` object (lifted to `config-editor.tsx`), so the JSON view and
 * the safe-apply pipeline stay in sync automatically.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import { Badge, Button, Input, Note, Select } from "./geist";
import { Sheet } from "./sheet";
import { CONFIG_SECTIONS, DEVICE_FIELDS } from "./config-spec";
import type { CfgField, CfgSection } from "./config-spec";

type Cfg = Record<string, unknown>;
const REDACTED = "«redacted»";

const asObj = (v: unknown): Cfg => (v && typeof v === "object" && !Array.isArray(v) ? (v as Cfg) : {});
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const uniq = (a: string[]): string[] => [...new Set(a)];
/** Safe stringify of an untyped config value (never "[object Object]"). */
const str = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function sectionObj(cfg: Cfg, s: CfgSection): Cfg {
  return s.path ? asObj(cfg[s.path]) : cfg;
}
function setField(cfg: Cfg, s: CfgSection, key: string, val: unknown): Cfg {
  if (s.path) {
    const obj = { ...asObj(cfg[s.path]) };
    if (val === undefined || val === "") delete obj[key];
    else obj[key] = val;
    return { ...cfg, [s.path]: obj };
  }
  const next = { ...cfg };
  if (val === undefined || val === "") delete next[key];
  else next[key] = val;
  return next;
}
function isActive(cfg: Cfg, s: CfgSection): boolean {
  if (!s.enable) return true;
  if (s.enable.presence) return cfg[s.path ?? ""] !== undefined;
  const obj = sectionObj(cfg, s);
  return obj[s.enable.key ?? "enabled"] !== false;
}

// ── one field control ────────────────────────────────────────────────────────

function FieldRow({ field, value, onChange }: { field: CfgField; value: unknown; onChange: (v: unknown) => void }): ReactNode {
  const id = `f_${field.key}`;
  let control: ReactNode;
  if (field.type === "bool") {
    control = (
      <label className="dev-toggle">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="dev-toggle__slider" />
      </label>
    );
  } else if (field.type === "select") {
    control = (
      <Select value={str(value ?? field.options?.[0] ?? "")} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    );
  } else if (field.type === "number") {
    control = (
      <Input
        id={id}
        type="number"
        placeholder={field.placeholder}
        value={value == null ? "" : str(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        type={field.type === "password" ? "password" : "text"}
        placeholder={field.secret && value === REDACTED ? "•••• unchanged" : field.placeholder}
        value={value == null ? "" : str(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className={`cfg-field${field.type === "bool" ? " cfg-field--bool" : ""}`}>
      <label className="cfg-field__label" htmlFor={id}>
        {field.label}
        {field.secret && <span className="cfg-field__secret"> secret</span>}
      </label>
      {control}
      {field.help && <span className="cfg-field__help muted">{field.help}</span>}
    </div>
  );
}

function FieldForm({
  fields,
  value,
  onField,
}: {
  fields: CfgField[];
  value: Cfg;
  onField: (key: string, v: unknown) => void;
}): ReactNode {
  const [showAdv, setShowAdv] = useState(false);
  const basic = fields.filter((f) => !f.advanced);
  const adv = fields.filter((f) => f.advanced);
  return (
    <div className="cfg-fields">
      {basic.map((f) => (
        <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => onField(f.key, v)} />
      ))}
      {adv.length > 0 && (
        <>
          <button type="button" className="cfg-adv-toggle" onClick={() => setShowAdv((s) => !s)}>
            {showAdv ? "▾" : "▸"} Advanced ({adv.length})
          </button>
          {showAdv && adv.map((f) => <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => onField(f.key, v)} />)}
        </>
      )}
    </div>
  );
}

// ── object section card + edit sheet ─────────────────────────────────────────

const DEFAULT_S3: Cfg = { prefix: "", presignExpiresIn: 3600 };

function sectionSummary(cfg: Cfg, s: CfgSection): string {
  const o = sectionObj(cfg, s);
  const pick = (k: string): string => (o[k] != null && o[k] !== "" ? str(o[k]) : "");
  const addr = pick("host") ? `${pick("host")}:${pick("port")}` : "";
  if (s.id === "mcp") return [pick("transport"), addr].filter(Boolean).join(" · ");
  if (s.id === "dashboard") return [addr, o.token ? "token set" : "open"].filter(Boolean).join(" · ");
  if (s.id === "ssh") return `interval ${pick("keepAliveInterval") || "?"}ms · idle ${pick("idleTimeout") || "?"}ms`;
  if (s.id === "s3")
    return isActive(cfg, s) ? [pick("bucket"), pick("region"), pick("endpoint")].filter(Boolean).join(" · ") || "not configured" : "";
  if (s.id === "memory") return pick("dbPath");
  if (s.id === "general") return `${cfg.readOnly ? "read-only" : "read-write"}${cfg.disableUpdateCheck ? " · no update check" : ""}`;
  return "";
}

function ObjectCard({ cfg, onChange, section }: { cfg: Cfg; onChange: (c: Cfg) => void; section: CfgSection }): ReactNode {
  const [editing, setEditing] = useState(false);
  const stash = useRef<Cfg | null>(null);
  const active = isActive(cfg, section);

  const toggle = (on: boolean): void => {
    if (section.enable?.presence) {
      if (on) onChange({ ...cfg, [section.path!]: stash.current ?? (section.id === "s3" ? DEFAULT_S3 : {}) });
      else {
        stash.current = asObj(cfg[section.path!]);
        const next = { ...cfg };
        delete next[section.path!];
        onChange(next);
        setEditing(false);
      }
      return;
    }
    onChange(setField(cfg, section, section.enable!.key ?? "enabled", on));
  };

  const summary = sectionSummary(cfg, section);

  return (
    <div className={`cfg-card${active ? "" : " is-off"}`}>
      <div className="cfg-card__hd">
        <span className="cfg-card__icon" aria-hidden="true">
          {section.icon}
        </span>
        <div className="cfg-card__titles">
          <div className="cfg-card__title">
            {section.title}
            {section.enable && <Badge type={active ? "success" : "secondary"}>{active ? "active" : "off"}</Badge>}
          </div>
          {summary ? <div className="cfg-card__sum muted">{summary}</div> : <div className="cfg-card__sum muted">{section.blurb}</div>}
        </div>
        <span style={{ flex: 1 }} />
        {section.enable && (
          <label className="dev-toggle" title={`${active ? "Deactivate" : "Activate"} ${section.enable.label ?? section.title}`}>
            <input type="checkbox" checked={active} onChange={(e) => toggle(e.target.checked)} />
            <span className="dev-toggle__slider" />
          </label>
        )}
        <Button size="sm" ghost onClick={() => setEditing(true)} disabled={section.enable?.presence && !active}>
          Edit
        </Button>
      </div>

      {editing && (
        <Sheet title={`${section.icon} ${section.title}`} subtitle={section.blurb} onClose={() => setEditing(false)}>
          {section.enable && (
            <label className="cfg-sheet-enable">
              <span className="dev-toggle">
                <input type="checkbox" checked={active} onChange={(e) => toggle(e.target.checked)} />
                <span className="dev-toggle__slider" />
              </span>
              {active ? "Active" : `Inactive — enable ${section.enable.label ?? section.title}`}
            </label>
          )}
          {active ? (
            <FieldForm fields={section.fields} value={sectionObj(cfg, section)} onField={(k, v) => onChange(setField(cfg, section, k, v))} />
          ) : (
            <Note type="secondary" label={false}>
              This section is turned off. Toggle it on to edit its settings.
            </Note>
          )}
        </Sheet>
      )}
    </div>
  );
}

// ── devices ──────────────────────────────────────────────────────────────────

function DeviceSheet({
  cfg,
  onChange,
  name,
  isNew,
  onClose,
}: {
  cfg: Cfg;
  onChange: (c: Cfg) => void;
  name: string;
  isNew: boolean;
  onClose: () => void;
}): ReactNode {
  const [newName, setNewName] = useState(name);
  const devices = asObj(cfg.devices);
  const dev = asObj(devices[name]);

  const setDev = (key: string, v: unknown): void => {
    const nd = { ...dev };
    if (v === undefined || v === "") delete nd[key];
    else nd[key] = v;
    onChange({ ...cfg, devices: { ...devices, [name]: nd } });
  };

  const commitName = (): void => {
    const nn = newName.trim();
    if (!nn || nn === name || devices[nn]) return;
    const nextDevices = { ...devices, [nn]: dev };
    delete nextDevices[name];
    onChange({ ...cfg, devices: nextDevices });
    onClose();
  };

  return (
    <Sheet
      title={isNew ? "Add device" : `Device · ${name}`}
      subtitle={isNew ? "New MikroTik router" : undefined}
      onClose={onClose}
      footer={<Button type="success" size="sm" onClick={onClose}>Done</Button>}
    >
      <div className="cfg-field">
        <label className="cfg-field__label" htmlFor="dev_name">
          Name
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <Input id="dev_name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="core-router" />
          {!isNew && newName.trim() !== name && (
            <Button size="sm" ghost onClick={commitName}>
              Rename
            </Button>
          )}
        </div>
      </div>
      <FieldForm fields={DEVICE_FIELDS} value={dev} onField={setDev} />
    </Sheet>
  );
}

function DevicesCard({ cfg, onChange }: { cfg: Cfg; onChange: (c: Cfg) => void }): ReactNode {
  const [sheet, setSheet] = useState<{ name: string; isNew: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const devices = asObj(cfg.devices);
  const names = Object.keys(devices);
  const defaultDevice = str(cfg.defaultDevice);

  const addDevice = (): void => {
    const base = "device";
    let i = 1;
    let n = base;
    while (devices[n]) n = `${base}-${++i}`;
    onChange({ ...cfg, devices: { ...devices, [n]: { host: "192.168.88.1", port: 22, username: "admin", password: "", timeoutMs: 10000 } } });
    setSheet({ name: n, isNew: true });
  };
  const toggleDisabled = (n: string, disabled: boolean): void => {
    onChange({ ...cfg, devices: { ...devices, [n]: { ...asObj(devices[n]), disabled } } });
  };
  const removeDevice = (n: string): void => {
    const nd = { ...devices };
    delete nd[n];
    const next: Cfg = { ...cfg, devices: nd };
    if (defaultDevice === n) next.defaultDevice = Object.keys(nd)[0] ?? "";
    onChange(next);
    setConfirmDel(null);
  };

  return (
    <div className="cfg-card">
      <div className="cfg-card__hd">
        <span className="cfg-card__icon" aria-hidden="true">
          🖧
        </span>
        <div className="cfg-card__titles">
          <div className="cfg-card__title">Devices</div>
          <div className="cfg-card__sum muted">
            {names.length} device{names.length === 1 ? "" : "s"} · default: {defaultDevice || "—"}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <label className="cfg-inline">
          <span className="muted">Default</span>
          <Select value={defaultDevice} onChange={(e) => onChange({ ...cfg, defaultDevice: e.target.value })}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <Button size="sm" onClick={addDevice} icon="＋">
          Add device
        </Button>
      </div>

      <div className="cfg-devgrid">
        {names.map((n) => {
          const d = asObj(devices[n]);
          const off = d.disabled === true;
          const addr = d.mac ? str(d.mac) : `${str(d.host) || "?"}:${str(d.port) || "22"}`;
          return (
            <div key={n} className="dev-card cfg-devcard" data-disabled={off ? "1" : undefined}>
              <div className="dev-card__top">
                <span className={`dot dot--status ${off ? "is-off" : "is-on"}`} />
                <span className="dev-card__name">{n}</span>
                {defaultDevice === n && <Badge type="accent">default</Badge>}
                <span style={{ flex: 1 }} />
                <label className="dev-toggle" title={off ? "Enable device" : "Disable device"}>
                  <input type="checkbox" checked={!off} onChange={(e) => toggleDisabled(n, !e.target.checked)} />
                  <span className="dev-toggle__slider" />
                </label>
              </div>
              <div className="dev-card__meta muted">{addr}</div>
              {d.description ? <div className="dev-card__meta muted">{str(d.description)}</div> : null}
              <div className="cfg-devcard__actions">
                <Button size="sm" ghost onClick={() => setSheet({ name: n, isNew: false })}>
                  Edit
                </Button>
                {confirmDel === n ? (
                  <Button size="sm" type="error" onClick={() => removeDevice(n)}>
                    Confirm?
                  </Button>
                ) : (
                  <Button size="sm" ghost type="error" onClick={() => setConfirmDel(n)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {names.length === 0 && (
          <Note type="secondary" label={false}>
            No devices yet. Click <b>Add device</b> to configure your first router.
          </Note>
        )}
      </div>

      {sheet && <DeviceSheet cfg={cfg} onChange={onChange} name={sheet.name} isNew={sheet.isNew} onClose={() => setSheet(null)} />}
    </div>
  );
}

// ── modules (inline management, editing cfg.tools) ───────────────────────────

interface ModuleItem {
  slug: string;
  label: string;
  group: string;
  description: string;
  toolCount: number;
}

function moduleEnabled(tools: Cfg, m: ModuleItem): boolean {
  const dm = arr(tools.disabledModules);
  const dg = arr(tools.disabledGroups);
  const em = arr(tools.enabledModules);
  const eg = arr(tools.enabledGroups);
  if (dm.includes(m.slug) || dg.includes(m.group)) return false;
  if (em.length === 0 && eg.length === 0) return true;
  return em.includes(m.slug) || eg.includes(m.group);
}

function ModulesCard({ cfg, onChange }: { cfg: Cfg; onChange: (c: Cfg) => void }): ReactNode {
  const [catalog, setCatalog] = useState<ModuleItem[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void api<{ modules: ModuleItem[] }>("/api/modules")
      .then((d) => setCatalog(d.modules))
      .catch(() => setCatalog([]));
  }, []);

  const tools = asObj(cfg.tools);
  const toggle = (m: ModuleItem, enable: boolean): void => {
    const em = new Set(arr(tools.enabledModules));
    const dm = new Set(arr(tools.disabledModules));
    if (enable) {
      dm.delete(m.slug);
      if (arr(tools.enabledModules).length > 0 || arr(tools.enabledGroups).length > 0) em.add(m.slug);
    } else {
      em.delete(m.slug);
      dm.add(m.slug);
    }
    onChange({
      ...cfg,
      tools: { ...tools, enabledModules: uniq([...em]), disabledModules: uniq([...dm]) },
    });
  };

  const modules = (catalog ?? []).filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return m.label.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q) || m.group.toLowerCase().includes(q);
  });
  const groups = new Map<string, ModuleItem[]>();
  for (const m of modules) groups.set(m.group, [...(groups.get(m.group) ?? []), m]);
  const enabledCount = (catalog ?? []).filter((m) => moduleEnabled(tools, m)).length;

  return (
    <div className="cfg-card">
      <div className="cfg-card__hd">
        <span className="cfg-card__icon" aria-hidden="true">
          🧩
        </span>
        <div className="cfg-card__titles">
          <div className="cfg-card__title">Tool Modules</div>
          <div className="cfg-card__sum muted">
            {catalog ? `${enabledCount}/${catalog.length} modules enabled` : "loading…"} · applied on Save
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <Input placeholder="Filter modules…" value={query} onChange={(e) => setQuery(e.target.value)} className="cfg-modfilter" />
        <label className="cfg-inline">
          <span className="dev-toggle" title="MCP App Views">
            <input
              type="checkbox"
              checked={asObj(cfg.mcp).appViews === true}
              onChange={(e) => onChange({ ...cfg, mcp: { ...asObj(cfg.mcp), appViews: e.target.checked } })}
            />
            <span className="dev-toggle__slider" />
          </span>
          <span className="muted">App Views</span>
        </label>
      </div>
      <div className="cfg-modgroups">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group} className="cfg-modgroup">
            <div className="cfg-modgroup__hd muted">{group}</div>
            {items.map((m) => {
              const on = moduleEnabled(tools, m);
              return (
                <label key={m.slug} className="mod-row" data-on={on ? "1" : undefined} title={m.description}>
                  <input type="checkbox" checked={on} onChange={() => toggle(m, !on)} />
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
            })}
          </div>
        ))}
        {catalog && modules.length === 0 && <span className="muted">No modules match “{query}”.</span>}
      </div>
    </div>
  );
}

// ── the form ─────────────────────────────────────────────────────────────────

export function ConfigForm({ cfg, onChange }: { cfg: Cfg; onChange: (c: Cfg) => void }): ReactNode {
  return (
    <div className="cfg-formgrid">
      {CONFIG_SECTIONS.map((s) =>
        s.kind === "deviceMap" ? (
          <DevicesCard key={s.id} cfg={cfg} onChange={onChange} />
        ) : s.kind === "modules" ? (
          <ModulesCard key={s.id} cfg={cfg} onChange={onChange} />
        ) : (
          <ObjectCard key={s.id} cfg={cfg} onChange={onChange} section={s} />
        ),
      )}
    </div>
  );
}
