/**
 * Unit tests for the pure device-timezone datestamp helpers. No device I/O.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildStamp, gregorianToJalali, isTehran, parseClock } from "../../src/core/datestamp";

describe("gregorianToJalali", () => {
  test("matches the documented jalaali-js anchor", () => {
    expect(gregorianToJalali(2016, 4, 10)).toEqual({ jy: 1395, jm: 1, jd: 22 });
  });

  test("Nowruz 1403 falls on 2024-03-20", () => {
    expect(gregorianToJalali(2024, 3, 20)).toEqual({ jy: 1403, jm: 1, jd: 1 });
  });

  test("converts a mid-year date", () => {
    expect(gregorianToJalali(2024, 6, 23)).toEqual({ jy: 1403, jm: 4, jd: 3 });
  });
});

describe("isTehran", () => {
  test("recognises Iran/Tehran timezone names, rejects others", () => {
    expect(isTehran("Asia/Tehran")).toBe(true);
    expect(isTehran("Iran")).toBe(true);
    expect(isTehran("Europe/Berlin")).toBe(false);
    expect(isTehran(undefined)).toBe(false);
  });
});

describe("parseClock", () => {
  test("parses ISO date, time and timezone from /system clock print", () => {
    const out = [
      "                  time: 14:30:25",
      "                  date: 2024-06-23",
      "            gmt-offset: +03:30",
      "        time-zone-name: Asia/Tehran",
    ].join("\n");
    expect(parseClock(out)).toEqual({ ymd: "2024-06-23", hm: "14:30", tz: "Asia/Tehran" });
  });

  test("normalises the legacy mmm/dd/yyyy date format", () => {
    const out = "time: 09:05:00\ndate: jun/23/2024\ntime-zone-name: UTC";
    expect(parseClock(out)).toMatchObject({ ymd: "2024-06-23", hm: "09:05", tz: "UTC" });
  });
});

describe("buildStamp", () => {
  test("Tehran timezone renders a Jalali date", () => {
    expect(buildStamp("2024-06-23", "14:30", "Asia/Tehran")).toBe("1403-04-03_1430");
  });

  test("other timezones render a Gregorian date", () => {
    expect(buildStamp("2024-06-23", "14:30", "Europe/Berlin")).toBe("2024-06-23_1430");
  });

  test("defaults the time to 0000 when absent and stays filename-safe", () => {
    const stamp = buildStamp("2024-06-23", undefined, undefined);
    expect(stamp).toBe("2024-06-23_0000");
    expect(stamp).toMatch(/^[\w-]+$/);
  });

  test("returns empty string when the date can't be parsed", () => {
    expect(buildStamp(undefined, "14:30", "Asia/Tehran")).toBe("");
    expect(buildStamp("not-a-date", "14:30")).toBe("");
  });
});
