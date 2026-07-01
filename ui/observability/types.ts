// ── API types (mirror src/observability) ────────────────────────────────────
export type Risk = "READ" | "WRITE" | "WRITE_IDEMPOTENT" | "DESTRUCTIVE" | "DANGEROUS";
export interface ToolEvent {
  id: string;
  ts: number;
  tool: string;
  title: string;
  risk: Risk;
  device?: string;
  transport?: string;
  durationMs: number;
  isError: boolean;
  error?: string;
  input: string;
  output: string;
  outputBytes: number;
  hasStructured: boolean;
  truncated: boolean;
}
export interface Bucket {
  t: number;
  ok: number;
  error: number;
}
export interface Stats {
  total: number;
  errors: number;
  errorRate: number;
  callsPerMin: number;
  outputBytes: number;
  latency: { avg: number; p50: number; p95: number; p99: number; max: number };
  byTool: {
    tool: string;
    count: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
  }[];
  byRisk: Record<Risk, number>;
  byDevice: { device: string; count: number }[];
  byStatus: { ok: number; error: number };
  series: Bucket[];
  recentErrors: { id: string; ts: number; tool: string; error: string }[];
  distinctTools: number;
  distinctDevices: number;
  windowMs: number;
}
export interface Meta {
  tools: string[];
  devices: string[];
  risks: Risk[];
  total: number;
  liveClients: number;
  transport: string;
}
export interface DeviceStatus {
  reachable: boolean | null;
  checkedAt: number | null;
  latencyMs: number | null;
  identity?: string;
  version?: string;
  error?: string;
  boardName?: string;
  architecture?: string;
  cpuCount?: number;
  cpuLoad?: number;
  freeMemory?: number;
  totalMemory?: number;
  memUsedPct?: number;
  freeHdd?: number;
  totalHdd?: number;
  hddUsedPct?: number;
  uptime?: string;
}
export interface MetricSample {
  ts: number;
  cpuLoad: number | null;
  memUsedPct: number | null;
  hddUsedPct: number | null;
  latencyMs: number | null;
}
export interface DevicePoolStatus {
  device: string;
  /** True when there is a live pooled SSH connection for this device. */
  pooled: boolean;
  inflight: number;
  idle: boolean;
  dead: boolean;
}
export interface SSHPoolPayload {
  enabled: boolean;
  config: { keepAlive: boolean; keepAliveInterval: number; idleTimeout: number };
  aggregate: {
    totalConnections: number;
    totalInflight: number;
    totalIdle: number;
    totalBusy: number;
  };
  devices: Array<{ device: string; inflight: number; idle: boolean; dead: boolean }>;
}
export interface DeviceInfo {
  name: string;
  host: string;
  port: number;
  /** Set when the device is reached over Layer-2 MAC-Telnet instead of SSH. */
  mac?: string;
  transport?: string;
  /** Display address: the MAC for a mac-telnet device, else `host:port`. */
  address?: string;
  username: string;
  authMode: string;
  isDefault: boolean;
  description?: string;
  /** Name of another configured device used as an SSH jump host (bastion). */
  jumpVia?: string;
  /** Inline SSH bastion (host/port only; no secrets) when not a named device. */
  jumpHost?: { host: string; port: number };
  status: DeviceStatus;
  history?: MetricSample[];
  activity: { calls: number; errors: number; lastSeen: number; avgMs: number };
  /** SSH connection pool status; null for MAC-Telnet devices or when pool is off. */
  pool: DevicePoolStatus | null;
}
export interface DevicesPayload {
  server: string;
  defaultDevice: string;
  devices: DeviceInfo[];
}
export interface TopoNode {
  id: string;
  kind: "device" | "neighbor";
  label: string;
  configured: boolean;
  onboardable: boolean;
  identity?: string;
  ip?: string;
  mac?: string;
  platform?: string;
  board?: string;
  version?: string;
  reachable?: boolean | null;
  cpuLoad?: number;
  memUsedPct?: number;
  uptime?: string;
  suggestedConfig?: { name: string; host?: string; mac?: string; port: number; username: string };
}
export interface TopoEdge {
  from: string;
  to: string;
  interface?: string;
}
export interface TopologyPayload {
  server: string;
  defaultDevice: string;
  generatedAt: number;
  nodes: TopoNode[];
  edges: TopoEdge[];
  stats: { devices: number; neighbors: number; onboardable: number };
}
export interface PacketSummary {
  ts: number;
  len: number;
  ethType: string;
  src?: string;
  dst?: string;
  protocol?: string;
  info: string;
}
export interface CaptureStats {
  running: boolean;
  port: number;
  startedAt: number | null;
  packets: number;
  bytes: number;
  protocols: Record<string, number>;
  topTalkers: { addr: string; count: number }[];
  pcapFrames: number;
}
export interface CapturePayload {
  packets: PacketSummary[];
  stats: CaptureStats;
}
export type Filter = {
  tool: string;
  risk: string;
  device: string;
  status: string;
  q: string;
};
export type LiveMode = "ws" | "sse" | "off";
