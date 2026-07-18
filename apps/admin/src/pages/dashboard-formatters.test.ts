import { describe, expect, it } from "vitest";
import {
  formatLast24Requests,
  formatLast24Traffic,
  formatPackageRequests,
  formatPackageTraffic
} from "./dashboard-formatters";

describe("dashboard EdgeOne formatters", () => {
  it.each([
    [0, "0.00 MB"],
    [1_000_000, "1.00 MB"],
    [999_999_999, "1,000.00 MB"],
    [1_000_000_000, "1.00 GB"]
  ])("formats %d bytes with the expected adaptive unit", (value, expected) => {
    expect(formatLast24Traffic(value).text).toBe(expected);
  });

  it.each([
    [0, "0 次"],
    [999, "999 次"],
    [1_000, "1.00 K"],
    [999_999, "1,000.00 K"],
    [1_000_000, "1.00 M"]
  ])("formats %d requests with the expected adaptive unit", (value, expected) => {
    expect(formatLast24Requests(value).text).toBe(expected);
  });

  it("applies the adaptive units to package traffic and requests", () => {
    expect(formatPackageTraffic(500_000_000).text).toBe("500.00 MB");
    expect(formatPackageTraffic(20_000_000_000).text).toBe("20.00 GB");
    expect(formatPackageRequests(500).text).toBe("500 次");
    expect(formatPackageRequests(125_000).text).toBe("125.00 K");
    expect(formatPackageRequests(40_000_000).text).toBe("40.00 M");
  });
});
