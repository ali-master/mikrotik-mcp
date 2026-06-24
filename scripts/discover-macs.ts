#!/usr/bin/env bun
/**
 * List MikroTik devices discovered on the local network and their MAC addresses.
 *
 * Listens for MikroTik Neighbor Discovery Protocol (MNDP) announcements on
 * UDP 5678 — the same passive discovery WinBox/`/ip neighbor` uses — and prints
 * each device's MAC, identity, IPv4, interface, board and RouterOS version. The
 * MAC is what you then put in a device config to reach a router over MAC-Telnet
 * (Layer-2, no IP needed).
 *
 * Crucially, it sends the MNDP request to **every interface's directed
 * broadcast** (e.g. 10.10.10.255), not just the limited broadcast
 * 255.255.255.255 — which on macOS only egresses the default-route NIC. A
 * MikroTik on a separate wired segment is reachable only via the directed
 * broadcast, which is exactly how WinBox finds it. Wire format (parse + request
 * packet) and interface enumeration come from `@tikoci/centrs`. Runs under Bun.
 *
 *   bun run discover                 # spray + listen ~6s, print a table
 *   bun run discover --timeout 12    # listen longer
 *   bun run discover --json          # machine-readable JSON to stdout
 */
import { createSocket } from "node:dgram";
import { MNDP_PORT, mndpRefreshPacket, parseMndpPacket } from "@tikoci/centrs";
import { listBroadcastInterfaces } from "@tikoci/centrs/protocols";

type Neighbor = ReturnType<typeof parseMndpPacket>;

interface Args {
  timeoutMs: number;
  port: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { timeoutMs: 6_000, port: MNDP_PORT, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--timeout") args.timeoutMs = Math.max(1, Number(argv[++i] ?? "") || 6) * 1000;
    else if (a === "--port") args.port = Number(argv[++i] ?? "") || MNDP_PORT;
    else if (a === "--help" || a === "-h") {
      process.stderr.write(
        "Usage: bun run discover [--timeout <seconds>] [--port <n>] [--json]\n" +
          "  Lists MikroTik devices discovered via MNDP (UDP 5678) and their MAC addresses.\n",
      );
      process.exit(0);
    }
  }
  return args;
}

/** Right-pad to `width`, never truncating; used for the aligned text table. */
function pad(value: string | undefined, width: number): string {
  const s = value && value.length > 0 ? value : "—";
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Bind UDP 5678 and actively spray an MNDP request to the limited broadcast AND
 * every interface's directed broadcast, collecting replies until `timeoutMs`.
 */
function discoverMndp(args: Args): Promise<{ neighbors: Neighbor[]; external: number }> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true, reusePort: true });
    const found = new Map<string, Neighbor>();
    let bound = false;
    let external = 0; // datagrams that are NOT our own broadcast request echo

    socket.on("error", (err) => {
      if (!bound) reject(err);
    });
    socket.on("message", (msg) => {
      const bytes = new Uint8Array(msg);
      // Our refresh is the 9-byte all-zero request; broadcasting it loops it back
      // to our own socket. Don't count those — only real, external traffic matters.
      const isOwnEcho = bytes.length === 9 && bytes.every((b) => b === 0);
      if (!isOwnEcho) external += 1;
      try {
        const n = parseMndpPacket(bytes);
        if (n.macAddress) found.set(n.macAddress.toLowerCase(), n);
      } catch {
        /* malformed datagram on the shared port — ignore */
      }
    });

    socket.bind(args.port, "0.0.0.0", () => {
      bound = true;
      try {
        socket.setBroadcast(true);
      } catch {
        /* some environments forbid broadcast; passive listen still runs */
      }

      const ifaces = listBroadcastInterfaces();
      // Limited broadcast (default-route NIC) + each interface's directed
      // broadcast (reaches a device on a non-default segment, like WinBox does).
      const targets = [...new Set(["255.255.255.255", ...ifaces.map((i) => i.broadcast)])];
      const ifaceLine = ifaces.length
        ? `Interfaces: ${ifaces.map((i) => `${i.name}→${i.broadcast}`).join(", ")}`
        : "WARNING: no non-internal IPv4 interfaces found.";
      process.stderr.write(`Spraying MNDP requests to: ${targets.join(", ")}\n${ifaceLine}\n`);

      const spray = (): void => {
        const pkt = mndpRefreshPacket();
        for (const target of targets) socket.send(pkt, args.port, target, () => {});
      };
      spray();
      const sprayTimer = setInterval(spray, 2_000);

      setTimeout(() => {
        clearInterval(sprayTimer);
        socket.close(() => resolve({ neighbors: [...found.values()], external }));
      }, args.timeoutMs);
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `Listening for MNDP announcements for ${args.timeoutMs / 1000}s on UDP ${args.port}…\n`,
  );

  let neighbors: Neighbor[];
  let external: number;
  try {
    ({ neighbors, external } = await discoverMndp(args));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Discovery failed: ${msg}\n`);
    if (/EADDRINUSE/i.test(msg)) {
      process.stderr.write("  → UDP 5678 is in use (often WinBox). Close it or pass --port.\n");
    }
    process.exit(1);
  }

  neighbors.sort((a, b) => (a.macAddress ?? "").localeCompare(b.macAddress ?? ""));
  process.stderr.write(`Received ${external} external UDP datagram(s) on ${args.port}.\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(neighbors, null, 2)}\n`);
    return;
  }

  if (neighbors.length === 0) {
    if (external === 0) {
      // Nothing but our own echo reached the socket → the request went out fine but
      // replies are being intercepted or dropped before us (not a routing issue).
      process.stderr.write(
        "\nNo UDP traffic reached this process at all (received 0). The MNDP replies\n" +
          "are being intercepted or dropped before us — almost always one of:\n" +
          "  • WinBox (or another MikroTik tool) is OPEN and holding UDP 5678; macOS\n" +
          "    hands the shared-port datagrams to it, not us. → QUIT WinBox and re-run.\n" +
          "  • The macOS firewall is blocking inbound UDP to `bun`. → System Settings →\n" +
          "    Network → Firewall: turn it off briefly, or allow incoming for bun, and re-run.\n",
      );
    } else {
      process.stderr.write(
        "\nUDP traffic arrived but no MikroTik MNDP announcement was decoded.\n" +
          "  • Ensure discovery is enabled on the device (/ip neighbor discovery-settings,\n" +
          "    discover-interface-list must include the interface facing this host).\n" +
          "  • Try a longer window: bun run discover --timeout 35\n",
      );
    }
    return;
  }

  const header =
    `${pad("MAC", 19)}  ${pad("IDENTITY", 20)}  ${pad("IPv4", 16)}  ` +
    `${pad("IFACE", 10)}  ${pad("BOARD", 16)}  VERSION`;
  process.stdout.write(`${header}\n${"-".repeat(header.length)}\n`);
  for (const n of neighbors) {
    process.stdout.write(
      `${pad(n.macAddress, 19)}  ${pad(n.identity, 20)}  ${pad(n.ipv4, 16)}  ` +
        `${pad(n.interfaceName, 10)}  ${pad(n.board, 16)}  ${n.version ?? "—"}\n`,
    );
  }
  process.stderr.write(`\n${neighbors.length} device(s) discovered.\n`);
}

await main();
