import { describe, expect, it } from "vitest";
import { toPlotData } from "./gaps";

describe("toPlotData", () => {
  it("leaves contiguous buckets alone", () => {
    const d = toPlotData({ bucketSeconds: 60, t: [0, 60, 120], avg: [1, 2, 3], min: [1, 2, 3], max: [1, 2, 3] });
    expect(d[0]).toEqual([0, 60, 120]);
    expect(d[1]).toEqual([1, 2, 3]);
  });

  it("breaks the line across a gap", () => {
    const d = toPlotData({ bucketSeconds: 60, t: [0, 60, 600], avg: [1, 2, 3], min: [1, 2, 3], max: [1, 2, 3] });
    expect(d[0]).toEqual([0, 60, 120, 600]);
    expect(d[1]).toEqual([1, 2, null, 3]);
  });
});
