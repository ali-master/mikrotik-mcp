import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, postJson, withToken } from "./api";
import { bytes, clock, num } from "./format";
import type { CapturePayload } from "./types";

// ── Packet Capture Studio ────────────────────────────────────────────────────
const PROTO_COLOR: Record<string, string> = {
  TCP: "#e4e4e7",
  UDP: "#d4d4d8",
  ICMP: "#a1a1aa",
  ICMPv6: "#a1a1aa",
  ARP: "#e4e4e7",
  IPv6: "#a1a1aa",
};
const protoColor = (p: string | undefined): string => (p && PROTO_COLOR[p]) || "#71717a";

/** Live packet capture: protocol mix, top talkers, a scrolling packet list, pcap export. */
export function PacketCapture(): ReactNode {
  const [data, setData] = useState<CapturePayload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = (): void =>
      void api<CapturePayload>("/api/capture/packets?limit=150")
        .then(setData)
        .catch(() => {});
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, []);

  const stats = data?.stats;
  const packets = data?.packets ?? [];
  const stop = async (): Promise<void> => {
    setBusy(true);
    await postJson("/api/capture/stop", {}).catch(() => {});
    setBusy(false);
  };

  if (!stats || (!stats.running && stats.packets === 0)) {
    return (
      <div className="cap-idle muted">
        No capture running. Start one with the <code>start_packet_capture</code> tool — point the
        device's TZSP stream at this host — and decoded packets stream in here live.
      </div>
    );
  }

  const maxProto = Math.max(1, ...Object.values(stats.protocols));
  return (
    <div className="cap">
      <div className="cap-bar">
        <span className={`cap-dot${stats.running ? " is-on" : ""}`} />
        <b>{stats.running ? "capturing" : "stopped"}</b>
        <span className="muted">UDP {stats.port}</span>
        <span className="muted">
          {num(stats.packets)} pkts · {bytes(stats.bytes)}
        </span>
        <span style={{ flex: 1 }} />
        <a className="btn" href={withToken("/api/capture/pcap")} download="capture.pcap">
          ⤓ pcap
        </a>
        <button
          className="btn btn-danger"
          onClick={() => void stop()}
          disabled={busy || !stats.running}
        >
          ■ Stop
        </button>
      </div>
      <div className="cap-cols">
        <div className="cap-side">
          <div className="cap-h">Protocols</div>
          {Object.entries(stats.protocols).map(([p, n]) => (
            <div className="cap-pbar" key={p}>
              <span className="cap-plabel" style={{ color: protoColor(p) }}>
                {p}
              </span>
              <span className="cap-ptrack">
                <i style={{ width: `${(n / maxProto) * 100}%`, background: protoColor(p) }} />
              </span>
              <span className="cap-pn">{n}</span>
            </div>
          ))}
          <div className="cap-h" style={{ marginTop: 12 }}>
            Top talkers
          </div>
          {stats.topTalkers.length === 0 && <div className="muted">—</div>}
          {stats.topTalkers.map((t) => (
            <div className="cap-talker" key={t.addr}>
              <span>{t.addr}</span>
              <b>{t.count}</b>
            </div>
          ))}
        </div>
        <div className="cap-list">
          {packets.length === 0 ? (
            <div className="muted" style={{ padding: 10 }}>
              waiting for packets…
            </div>
          ) : (
            packets.map((p, i) => (
              <div className="cap-row" key={i}>
                <span className="cap-tt">{clock(p.ts)}</span>
                <span className="cap-proto" style={{ color: protoColor(p.protocol) }}>
                  {p.protocol ?? p.ethType}
                </span>
                <span className="cap-len">{p.len}</span>
                <span className="cap-info">{p.info}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
