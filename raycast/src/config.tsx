/**
 * Config command — mirrors the dashboard's Config Studio, built natively from the
 * Raycast kit: edit the effective config as JSON (Form.TextArea), Validate
 * (`/api/config/validate`, Zod), Preview Diff (`/api/config/preview`), and Apply
 * with a timed safe-apply — the server auto-reverts unless you Keep it in time.
 * Plus version History (diff / restore / checkpoint / delete) and a Field Guide
 * generated from the JSON schema. Apply / Keep / Restore / Delete are destructive.
 */
import { useEffect, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  Keyboard,
  List,
  Toast,
  openExtensionPreferences,
  showToast,
  useNavigation,
} from "@raycast/api";
import { postJson } from "./lib/api";
import { DiffDetail, diffMarkdown } from "./lib/diff";
import { confirmDestructive, showFailureToast } from "./lib/confirm";
import { bytes } from "./lib/format";
import { useApi } from "./lib/hooks";
import type {
  CfgVersion,
  ConfigIssue,
  DeviceStatus,
  DiffSummary,
} from "./lib/types";

interface SaveResp {
  ok?: boolean;
  errors?: ConfigIssue[];
  pendingId?: string;
  rollbackMs?: number;
  devicesChanged?: boolean;
  summary?: DiffSummary;
  unified?: string;
}

const ROLLBACK_OPTS: [string, number][] = [
  ["30s", 30_000],
  ["60s", 60_000],
  ["2m", 120_000],
  ["no auto-revert", 0],
];

function parseJson(text: string): { obj?: unknown; error?: string } {
  try {
    return { obj: JSON.parse(text) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function IssuesView({ issues }: { issues: ConfigIssue[] }) {
  return (
    <List navigationTitle="Validation Issues">
      {issues.map((iss, i) => (
        <List.Item
          key={`${iss.path}-${i}`}
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
          title={iss.path || "(root)"}
          subtitle={iss.message}
        />
      ))}
      <List.EmptyView
        icon={{ source: Icon.Checkmark, tintColor: Color.Green }}
        title="No issues"
      />
    </List>
  );
}

function PendingView({ resp, onDone }: { resp: SaveResp; onDone: () => void }) {
  const { pop } = useNavigation();
  const rollbackMs = resp.rollbackMs ?? 0;
  const [left, setLeft] = useState(Math.round(rollbackMs / 1000));
  const [reverted, setReverted] = useState(false);

  useEffect(() => {
    if (rollbackMs <= 0) return;
    const id = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(id);
          setReverted(true);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [rollbackMs]);

  async function keep() {
    const ok = await confirmDestructive({
      title: "Keep this config permanently?",
      message: "Commits the applied change and writes it to the config file.",
      actionTitle: "Keep",
      icon: Icon.SaveDocument,
    });
    if (!ok) return;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Keeping…",
    });
    try {
      const res = await postJson<{ kept?: boolean; error?: string }>(
        "/api/config/keep",
        { pendingId: resp.pendingId },
      );
      if (res.error) throw new Error(res.error);
      toast.style = Toast.Style.Success;
      toast.title = "Config kept";
      onDone();
      pop();
    } catch (e) {
      void toast.hide();
      await showFailureToast(e, { title: "Could not keep config" });
    }
  }

  async function revert() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Reverting…",
    });
    try {
      await postJson("/api/config/rollback", { pendingId: resp.pendingId });
      toast.style = Toast.Style.Success;
      toast.title = "Reverted";
      onDone();
      pop();
    } catch (e) {
      void toast.hide();
      await showFailureToast(e, { title: "Could not revert" });
    }
  }

  const status = reverted
    ? "**Auto-reverted** — the keep window elapsed, so the server rolled back."
    : rollbackMs > 0
      ? `**Pending** — keep within **${left}s** or it auto-reverts.`
      : "**Pending** — no auto-revert; Keep to commit or Revert to discard.";

  const md = [
    `# Applied (pending)`,
    ``,
    status,
    resp.devicesChanged
      ? `\n> ⚠ Device connection settings changed — reconnect the MCP client.`
      : "",
    `\n${diffMarkdown(resp.unified ?? "", resp.summary)}`,
  ].join("\n");

  return (
    <Detail
      markdown={md}
      navigationTitle={reverted ? "Auto-reverted" : `Pending · ${left}s`}
      actions={
        <ActionPanel>
          {!reverted ? (
            <Action
              title="Keep Changes"
              icon={Icon.SaveDocument}
              onAction={keep}
            />
          ) : null}
          {!reverted ? (
            <Action
              title="Revert Now"
              icon={Icon.ArrowCounterClockwise}
              style={Action.Style.Destructive}
              onAction={revert}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

function CheckpointForm({ onDone }: { onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Save Checkpoint"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Checkpoint"
            onSubmit={async (v: { label: string }) => {
              const toast = await showToast({
                style: Toast.Style.Animated,
                title: "Saving checkpoint…",
              });
              try {
                const res = await postJson<{ ok?: boolean; error?: string }>(
                  "/api/config/history/checkpoint",
                  {
                    label: v.label || undefined,
                  },
                );
                if (res.error) throw new Error(res.error);
                toast.style = Toast.Style.Success;
                toast.title = "Checkpoint saved";
                onDone();
                pop();
              } catch (e) {
                void toast.hide();
                await showFailureToast(e, {
                  title: "Could not save checkpoint",
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="label"
        title="Label"
        placeholder="before-firewall-change"
      />
    </Form>
  );
}

function HistoryDiff({ id, label }: { id: string; label: string }) {
  const { data, isLoading } = useApi<{
    summary: { added: number; removed: number };
    unified: string;
  }>(`/api/config/history/diff?id=${encodeURIComponent(id)}`);
  return (
    <DiffDetail
      isLoading={isLoading}
      unified={data?.unified ?? ""}
      summary={data?.summary}
      title={`${label} → current`}
      navigationTitle="Version Diff"
    />
  );
}

function HistoryView({ onReload }: { onReload: () => void }) {
  const { data, isLoading, revalidate } = useApi<{
    versions: CfgVersion[];
    bytes: number;
    retention: number;
  }>("/api/config/history");
  const versions = data?.versions ?? [];

  async function restore(v: CfgVersion) {
    const ok = await confirmDestructive({
      title: `Restore version ${v.label ?? v.id.slice(0, 8)}?`,
      message:
        "Swaps the live config to this version (a 'before restore' snapshot is taken first).",
      actionTitle: "Restore",
      icon: Icon.ArrowCounterClockwise,
    });
    if (!ok) return;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Restoring…",
    });
    try {
      const res = await postJson<{ ok?: boolean; error?: string }>(
        "/api/config/history/restore",
        { id: v.id },
      );
      if (res.error) throw new Error(res.error);
      toast.style = Toast.Style.Success;
      toast.title = "Restored";
      revalidate();
      onReload();
    } catch (e) {
      void toast.hide();
      await showFailureToast(e, { title: "Could not restore" });
    }
  }

  async function del(v: CfgVersion) {
    const ok = await confirmDestructive({
      title: `Delete checkpoint ${v.label ?? v.id.slice(0, 8)}?`,
      actionTitle: "Delete",
    });
    if (!ok) return;
    try {
      await postJson("/api/config/history/delete", { id: v.id });
      revalidate();
    } catch (e) {
      await showFailureToast(e, { title: "Could not delete checkpoint" });
    }
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Config History"
      actions={
        <ActionPanel>
          <Action.Push
            title="Save Checkpoint"
            icon={Icon.Pin}
            target={<CheckpointForm onDone={revalidate} />}
          />
        </ActionPanel>
      }
    >
      {versions.map((v, i) => (
        <List.Item
          key={v.id}
          icon={{
            source: v.kind === "checkpoint" ? Icon.Pin : Icon.Dot,
            tintColor:
              v.kind === "checkpoint" ? Color.Blue : Color.SecondaryText,
          }}
          title={v.label ?? (i === 0 ? "latest" : v.kind)}
          subtitle={new Date(v.ts).toLocaleString()}
          accessories={[
            {
              text:
                v.drift.added || v.drift.removed
                  ? `+${v.drift.added}/−${v.drift.removed}`
                  : "identical",
            },
            { text: bytes(v.bytes) },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Diff Against Current"
                icon={Icon.Text}
                target={
                  <HistoryDiff id={v.id} label={v.label ?? v.id.slice(0, 8)} />
                }
              />
              <Action
                title="Restore"
                icon={Icon.ArrowCounterClockwise}
                style={Action.Style.Destructive}
                onAction={() => restore(v)}
              />
              {v.kind === "checkpoint" ? (
                <Action
                  title="Delete Checkpoint"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => del(v)}
                />
              ) : null}
              <Action.Push
                title="Save Checkpoint"
                icon={Icon.Pin}
                target={<CheckpointForm onDone={revalidate} />}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

interface GuideField {
  path: string;
  type: string;
  def?: unknown;
  desc?: string;
  enumv?: string[];
  required: boolean;
}

function flattenSchema(
  schema: Record<string, unknown> | undefined,
  prefix = "",
): GuideField[] {
  const out: GuideField[] = [];
  const props =
    (schema?.properties as Record<string, Record<string, unknown>>) ?? {};
  const required = (schema?.required as string[]) ?? [];
  for (const [key, val] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const rawType = val.type;
    const type = Array.isArray(rawType)
      ? rawType.join("|")
      : ((rawType as string) ?? (val.enum ? "enum" : "any"));
    out.push({
      path,
      type,
      def: val.default,
      desc: val.description as string | undefined,
      enumv: val.enum as string[] | undefined,
      required: required.includes(key),
    });
    if (val.type === "object" && val.properties)
      out.push(...flattenSchema(val, path));
  }
  return out;
}

function FieldGuideView() {
  const { data, isLoading } =
    useApi<Record<string, unknown>>("/api/config-schema");
  const fields = flattenSchema(data);
  return (
    <List
      isLoading={isLoading}
      navigationTitle="Field Guide"
      searchBarPlaceholder="Search config fields…"
      isShowingDetail
    >
      {fields.map((f) => (
        <List.Item
          key={f.path}
          title={f.path}
          subtitle={f.type}
          keywords={[f.desc ?? ""]}
          accessories={
            f.required
              ? [{ tag: { value: "required", color: Color.Orange } }]
              : undefined
          }
          detail={
            <List.Item.Detail
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label title="Path" text={f.path} />
                  <List.Item.Detail.Metadata.Label title="Type" text={f.type} />
                  {f.def !== undefined ? (
                    <List.Item.Detail.Metadata.Label
                      title="Default"
                      text={JSON.stringify(f.def)}
                    />
                  ) : null}
                  {f.enumv ? (
                    <List.Item.Detail.Metadata.TagList title="Values">
                      {f.enumv.map((e) => (
                        <List.Item.Detail.Metadata.TagList.Item
                          key={e}
                          text={e}
                        />
                      ))}
                    </List.Item.Detail.Metadata.TagList>
                  ) : null}
                  {f.desc ? (
                    <List.Item.Detail.Metadata.Label
                      title="Description"
                      text={f.desc}
                    />
                  ) : null}
                </List.Item.Detail.Metadata>
              }
            />
          }
        />
      ))}
    </List>
  );
}

interface TestResult {
  reachable?: boolean;
  latencyMs?: number;
  identity?: string;
  error?: string;
}

/** Per-device connection test — mirrors the dashboard's `● name: 12ms · identity` chips. */
function TestDevicesView({ devices }: { devices: Record<string, unknown> }) {
  const names = Object.keys(devices);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const done = Object.keys(results).length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      type TestResp = {
        ok?: boolean;
        status?: DeviceStatus;
        errors?: ConfigIssue[];
      };
      for (const name of names) {
        const r = await postJson<TestResp>("/api/config/test-device", {
          name,
          config: devices[name],
        }).catch((): TestResp => ({ ok: false }));
        if (cancelled) return;
        const res: TestResult =
          r.ok && r.status?.reachable === true
            ? {
                reachable: true,
                latencyMs: r.status.latencyMs ?? 0,
                identity: r.status.identity,
              }
            : {
                reachable: false,
                error:
                  r.status?.error ?? r.errors?.[0]?.message ?? "unreachable",
              };
        setResults((prev) => ({ ...prev, [name]: res }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <List
      isLoading={done < names.length}
      navigationTitle={`Test Devices · ${done}/${names.length}`}
    >
      {names.map((name) => {
        const r = results[name];
        return (
          <List.Item
            key={name}
            icon={
              r
                ? {
                    source: r.reachable ? Icon.CheckCircle : Icon.XMarkCircle,
                    tintColor: r.reachable ? Color.Green : Color.Red,
                  }
                : { source: Icon.Dot, tintColor: Color.SecondaryText }
            }
            title={name}
            subtitle={
              r
                ? r.reachable
                  ? `${Math.round(r.latencyMs ?? 0)}ms · ${r.identity ?? "ok"}`
                  : (r.error ?? "unreachable")
                : "testing…"
            }
            accessories={
              r
                ? [
                    {
                      tag: {
                        value: r.reachable ? "reachable" : "unreachable",
                        color: r.reachable ? Color.Green : Color.Red,
                      },
                    },
                  ]
                : undefined
            }
          />
        );
      })}
      <List.EmptyView icon={Icon.Plug} title="No devices in config" />
    </List>
  );
}

type ValidationState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "jsonerror"; jsonErr: string }
  | { state: "issues"; issues: ConfigIssue[] }
  | { state: "valid" };

function Editor({
  initial,
  reload,
}: {
  initial: Record<string, unknown>;
  reload: () => void;
}) {
  const { push } = useNavigation();
  // Mounted only once the config has loaded, so `text` is initialized SYNCHRONOUSLY
  // from the real data — the field shows it on first render. (A Raycast Form field
  // identifies by `id`, so setting its value after mount does not repaint it; that
  // is why the editor showed empty when it was fetched asynchronously in-place.)
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [rollbackMs, setRollbackMs] = useState(60_000);
  const [validation, setValidation] = useState<ValidationState>({
    state: "idle",
  });

  // Live validation: parse locally on each edit, then ask the server (Zod truth),
  // debounced — mirrors the dashboard's status pill + inline error list.
  useEffect(() => {
    const p = parseJson(text);
    if (p.error) {
      setValidation({ state: "jsonerror", jsonErr: p.error });
      return;
    }
    setValidation({ state: "checking" });
    const id = setTimeout(async () => {
      try {
        const res = await postJson<{ ok?: boolean; errors?: ConfigIssue[] }>(
          "/api/config/validate",
          p.obj,
        );
        const issues = res.errors ?? [];
        setValidation(
          issues.length ? { state: "issues", issues } : { state: "valid" },
        );
      } catch {
        setValidation({ state: "idle" });
      }
    }, 500);
    return () => clearTimeout(id);
  }, [text]);

  async function validate(raw: string) {
    const p = parseJson(raw);
    if (p.error) {
      await showFailureToast(new Error(p.error), { title: "Invalid JSON" });
      return;
    }
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Validating…",
    });
    try {
      const res = await postJson<{ ok?: boolean; errors?: ConfigIssue[] }>(
        "/api/config/validate",
        p.obj,
      );
      if (res.errors && res.errors.length) {
        void toast.hide();
        push(<IssuesView issues={res.errors} />);
      } else {
        toast.style = Toast.Style.Success;
        toast.title = "Valid ✓";
      }
    } catch (e) {
      void toast.hide();
      await showFailureToast(e, { title: "Validation failed" });
    }
  }

  async function preview(raw: string) {
    const p = parseJson(raw);
    if (p.error) {
      await showFailureToast(new Error(p.error), { title: "Invalid JSON" });
      return;
    }
    const res = await postJson<{ summary: DiffSummary; unified: string }>(
      "/api/config/preview",
      p.obj,
    );
    push(
      <DiffDetail
        unified={res.unified ?? ""}
        summary={res.summary}
        title="Preview"
        navigationTitle="Config Preview"
      />,
    );
  }

  async function apply(raw: string) {
    const p = parseJson(raw);
    if (p.error) {
      await showFailureToast(new Error(p.error), { title: "Invalid JSON" });
      return;
    }
    const ok = await confirmDestructive({
      title: "Apply this config live?",
      message:
        rollbackMs > 0
          ? `Applies now; auto-reverts in ${rollbackMs / 1000}s unless you Keep it.`
          : "Applies now with no auto-revert.",
      actionTitle: "Apply",
      icon: Icon.Bolt,
    });
    if (!ok) return;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Applying…",
    });
    try {
      const res = await postJson<SaveResp>("/api/config", {
        config: p.obj,
        rollbackMs,
      });
      if (res.ok === false) {
        void toast.hide();
        push(<IssuesView issues={res.errors ?? []} />);
        return;
      }
      void toast.hide();
      push(<PendingView resp={res} onDone={reload} />);
    } catch (e) {
      void toast.hide();
      await showFailureToast(e, { title: "Apply failed" });
    }
  }

  function testDevices() {
    const p = parseJson(text ?? "");
    if (p.error) {
      void showFailureToast(new Error(p.error), { title: "Invalid JSON" });
      return;
    }
    const devices = (p.obj as { devices?: Record<string, unknown> })?.devices;
    if (!devices || Object.keys(devices).length === 0) {
      void showToast({
        style: Toast.Style.Failure,
        title: "No devices in config",
      });
      return;
    }
    push(<TestDevicesView devices={devices} />);
  }

  // Status pill + inline field error, driven by live validation.
  const vs = validation.state;
  const statusText =
    vs === "jsonerror"
      ? "✗ Invalid JSON"
      : vs === "checking"
        ? "… Validating"
        : vs === "issues"
          ? `⚠ ${validation.issues.length} schema issue(s)`
          : vs === "valid"
            ? "✓ Valid"
            : "";
  const fieldError =
    vs === "jsonerror"
      ? validation.jsonErr
      : vs === "issues"
        ? `${validation.issues[0].path || "(root)"} — ${validation.issues[0].message}`
        : undefined;

  return (
    <Form
      navigationTitle={statusText ? `Config · ${statusText}` : "Config"}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.SubmitForm
              title="Apply Changes"
              icon={Icon.Bolt}
              onSubmit={(v: { config: string }) => apply(v.config)}
            />
            <Action
              title="Preview Diff"
              icon={Icon.Text}
              onAction={() => preview(text ?? "")}
            />
            <Action
              title="Test Devices"
              icon={Icon.Plug}
              onAction={testDevices}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title={vs === "issues" ? "View All Issues" : "Validate Now"}
              icon={Icon.Checkmark}
              onAction={() => validate(text ?? "")}
            />
            <Action.Push
              title="Version History"
              icon={Icon.Clock}
              target={<HistoryView onReload={reload} />}
            />
            <Action.Push
              title="Field Guide"
              icon={Icon.Book}
              target={<FieldGuideView />}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Reload from Server"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={reload}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.Description
        text={`${statusText ? `${statusText}  ·  ` : ""}Edit the effective config as JSON. Preview → Apply (safe-apply auto-reverts). Test Devices probes each configured device.`}
      />
      <Form.TextArea
        id="config"
        title="Config JSON"
        defaultValue={JSON.stringify(initial, null, 2)}
        onChange={setText}
        error={fieldError}
      />
      <Form.Dropdown
        id="rollback"
        title="Auto-revert"
        value={String(rollbackMs)}
        onChange={(v) => setRollbackMs(Number(v))}
      >
        {ROLLBACK_OPTS.map(([label, v]) => (
          <Form.Dropdown.Item key={label} title={label} value={String(v)} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

export default function Command() {
  const cfg = useApi<Record<string, unknown>>("/api/config");
  // Remount the editor with a fresh key each time new server config arrives, so
  // "Reload from Server" / post-apply revalidation re-seed the field.
  const [gen, setGen] = useState(0);
  const lastData = useRef<unknown>(undefined);
  useEffect(() => {
    if (cfg.data && cfg.data !== lastData.current) {
      lastData.current = cfg.data;
      setGen((g) => g + 1);
    }
  }, [cfg.data]);

  if (!cfg.data) {
    return (
      <Form
        isLoading={cfg.isLoading}
        navigationTitle="Config"
        actions={
          <ActionPanel>
            <Action
              title="Reload"
              icon={Icon.ArrowClockwise}
              onAction={cfg.revalidate}
            />
            <Action
              title="Open Preferences"
              icon={Icon.Gear}
              onAction={openExtensionPreferences}
            />
          </ActionPanel>
        }
      >
        <Form.Description
          text={
            cfg.isLoading
              ? "Loading configuration…"
              : "Could not load config. Check the Dashboard URL / token in extension preferences."
          }
        />
      </Form>
    );
  }

  return (
    <Editor
      key={gen}
      initial={cfg.data}
      reload={() => {
        lastData.current = undefined;
        cfg.revalidate();
      }}
    />
  );
}
