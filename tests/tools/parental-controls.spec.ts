/**
 * Unit tests for the Parental Controls policy builder.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildPolicyCommands } from "../../src/tools/parental-controls";

describe("buildPolicyCommands", () => {
  test("builds a disabled drop rule plus two schedulers tagged by name", () => {
    const groups = buildPolicyCommands({
      name: "kids",
      list: "kids-devices",
      blockStart: "22:00",
      blockEnd: "07:00",
    });
    const sched = groups.find((g) => g.label.includes("cut-off"));
    const joined = sched?.commands.join("\n") ?? "";
    expect(joined).toContain("action=drop");
    expect(joined).toContain("disabled=yes");
    expect(joined).toContain("start-time=22:00");
    expect(joined).toContain("start-time=07:00");
    expect(joined).toContain("comment=parental-kids");
    // the on-event toggles the rule by its tag
    expect(joined).toContain("filter enable");
    expect(joined).toContain("filter disable");
  });

  test("adds device addresses and DNS sinkholes when given", () => {
    const groups = buildPolicyCommands({
      name: "kids",
      list: "kids-devices",
      addresses: ["192.168.1.50", "192.168.1.51"],
      blockStart: "22:00",
      blockEnd: "07:00",
      blockDomains: ["tiktok.com"],
    });
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Target devices");
    expect(labels).toContain("Content blocking (DNS sinkhole)");
    const sink = groups.find((g) => g.label.includes("DNS"));
    expect(sink?.commands[0]).toContain("name=tiktok.com");
    expect(sink?.commands[0]).toContain("address=0.0.0.0");
  });
});
