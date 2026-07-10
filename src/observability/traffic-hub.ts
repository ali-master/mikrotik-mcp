/**
 * Server-side traffic broadcaster for the Clients page.
 *
 * Instead of every dashboard client polling `/api/clients/traffic-bulk` on its
 * own 1-second timer, ONE poller per device samples `sampleAllTraffic` and pushes
 * each result to all subscribers (over WebSocket, or SSE as a fallback). That is
 * both lighter on the router and — for the `/ip accounting` path — a correctness
 * fix: `snapshot take` resets the live counters, so two independent pollers would
 * steal each other's deltas and report half-rates. With a single poller there is
 * exactly one taker per interval.
 *
 * A device's poller starts when its first subscriber arrives and stops when the
 * last leaves, so an idle dashboard touches no router.
 */
import { createContext } from "../core/context";
import { sampleAllTraffic } from "../tools/connected-devices";
import type { BulkTrafficPayload } from "../tools/connected-devices";

type Listener = (sample: BulkTrafficPayload) => void;

interface Hub {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval>;
  /** The most recent sample, replayed to a newcomer so it isn't blank for ~1s. */
  last?: BulkTrafficPayload;
}

const POLL_MS = 1000;

/** One hub per device name (`""` = the default device). */
const hubs = new Map<string, Hub>();

/**
 * Subscribe to a device's live traffic samples. Returns an unsubscribe function;
 * when the last subscriber for a device unsubscribes, its poller is stopped.
 */
export function subscribeTraffic(device: string, fn: Listener): () => void {
  let hub = hubs.get(device);
  if (!hub) {
    const broadcast = (sample: BulkTrafficPayload): void => {
      const h = hubs.get(device);
      if (!h) return;
      h.last = sample;
      for (const l of h.listeners) l(sample);
    };
    const poll = async (): Promise<void> => {
      try {
        broadcast(await sampleAllTraffic(createContext(undefined, device || undefined)));
      } catch (e) {
        // A connection failure throws; surface it as an empty sample so the
        // client shows the notice rather than freezing on stale numbers.
        broadcast({
          ts: Date.now(),
          source: "none",
          note: e instanceof Error ? e.message : String(e),
          hosts: {},
          limits: {},
        });
      }
    };
    hub = { listeners: new Set(), timer: setInterval(() => void poll(), POLL_MS) };
    hubs.set(device, hub);
    void poll(); // seed immediately rather than waiting a full interval
  }

  hub.listeners.add(fn);
  if (hub.last) fn(hub.last);

  return () => {
    const h = hubs.get(device);
    if (!h) return;
    h.listeners.delete(fn);
    if (h.listeners.size === 0) {
      clearInterval(h.timer);
      hubs.delete(device);
    }
  };
}

/** Total live traffic subscribers across all devices (for diagnostics). */
export function trafficSubscriberCount(): number {
  let n = 0;
  for (const h of hubs.values()) n += h.listeners.size;
  return n;
}
