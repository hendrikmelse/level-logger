import type { ChartSeries } from "@level-logger/shared";

export type PlotData = [number[], (number | null)[], (number | null)[], (number | null)[]];

/**
 * Arranges a series for uPlot ([time, avg, min, max]) and breaks the line wherever data is missing,
 * by inserting an empty point after the last bucket before a gap. Without that the chart would
 * draw a straight line across an outage.
 */
export function toPlotData(s: ChartSeries): PlotData {
  const out: PlotData = [[], [], [], []];
  const push = (t: number, avg: number | null, min: number | null, max: number | null) => {
    out[0].push(t);
    out[1].push(avg);
    out[2].push(min);
    out[3].push(max);
  };
  s.t.forEach((t, i) => {
    const prev = s.t[i - 1];
    if (prev !== undefined && t - prev > s.bucketSeconds * 2.5) push(prev + s.bucketSeconds, null, null, null);
    push(t, s.avg[i]!, s.min[i]!, s.max[i]!);
  });
  return out;
}
