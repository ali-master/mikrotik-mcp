/**
 * Vendors the country-flag SVGs the dashboard serves, from the **circle-flags**
 * pack (https://github.com/HatScripts/circle-flags), into `assets/flags/`.
 *
 * The dashboard resolves a device's country from its public IP and shows the
 * matching flag; serving a locally-vendored SVG (rather than a third-party CDN)
 * keeps it working offline and leaks no browsing to the flag host. Run this once
 * to (re)download the set:
 *
 *   bun run scripts/download-flags.ts
 *
 * Downloads every ISO 3166-1 alpha-2 country flag (circle-flags names each SVG by
 * lowercase code, e.g. `de.svg`). Unknown/missing codes are skipped, not fatal.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_ROOT } from "../src/paths";

const BASE = "https://hatscripts.github.io/circle-flags/flags";
// Vendored into BOTH the server (dashboard serves them same-origin) and the
// Raycast extension (bundles them as local assets — no remote fetch at runtime).
const OUT_DIRS = [
  join(PROJECT_ROOT, "assets", "flags"),
  join(PROJECT_ROOT, "raycast", "assets", "flags"),
];

// ISO 3166-1 alpha-2 codes (the flags a geolocated device IP can map to).
const CODES =
  "ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw".split(
    " ",
  );

const CONCURRENCY = 16;

async function download(code: string): Promise<"ok" | "missing" | "error"> {
  try {
    const res = await fetch(`${BASE}/${code}.svg`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return "missing";
    if (!res.ok) return "error";
    const svg = await res.text();
    await Promise.all(OUT_DIRS.map((d) => writeFile(join(d, `${code}.svg`), svg)));
    return "ok";
  } catch {
    return "error";
  }
}

await Promise.all(OUT_DIRS.map((d) => mkdir(d, { recursive: true })));

let ok = 0;
let missing = 0;
let errored = 0;
for (let i = 0; i < CODES.length; i += CONCURRENCY) {
  const batch = CODES.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(download));
  for (const r of results) {
    if (r === "ok") ok++;
    else if (r === "missing") missing++;
    else errored++;
  }
}

process.stdout.write(
  `Flags: ${ok} downloaded, ${missing} missing, ${errored} errored → ${OUT_DIRS.join(", ")}\n`,
);
if (errored > 0) process.exitCode = 1;
