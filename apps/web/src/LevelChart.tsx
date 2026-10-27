import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { ChartSeries } from "@level-logger/shared";
import { toPlotData } from "./gaps";

interface Props {
  series: ChartSeries;
  /** Called with epoch seconds when the viewer drags a span on the chart to zoom into it. */
  onZoom: (from: number, to: number) => void;
  /** The span shown, so an empty stretch at either end still takes up its place on the axis. */
  range: { from: number; to: number };
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The chart: average level as a line, with the min-to-max range shaded behind it. */
export function LevelChart({ series, onZoom, range }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const zoom = useRef(onZoom);
  zoom.current = onZoom;

  useEffect(() => {
    const el = host.current!;
    const line = cssVar("--line");
    const text = cssVar("--muted");
    const grid = cssVar("--grid");
    const fill = cssVar("--band");
    const chart = new uPlot(
      {
        width: el.clientWidth,
        height: 360,
        scales: { x: { time: true, range: () => [range.from, range.to] } },
        cursor: { drag: { x: true, y: false, setScale: false } },
        legend: { live: true },
        series: [
          {},
          { label: "Average (in)", stroke: line, width: 2, points: { show: false } },
          { label: "Min (in)", stroke: "transparent", points: { show: false } },
          { label: "Max (in)", stroke: "transparent", points: { show: false } },
        ],
        bands: [{ series: [3, 2], fill }],
        axes: [
          { stroke: text, grid: { stroke: grid }, ticks: { stroke: grid } },
          { stroke: text, grid: { stroke: grid }, ticks: { stroke: grid }, label: "inches", labelSize: 20 },
        ],
        hooks: {
          setSelect: [
            (u) => {
              if (u.select.width < 6) return;
              const from = u.posToVal(u.select.left, "x");
              const to = u.posToVal(u.select.left + u.select.width, "x");
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
              zoom.current(Math.floor(from), Math.ceil(to));
            },
          ],
        },
      },
      toPlotData(series),
      el,
    );
    plot.current = chart;
    const resize = new ResizeObserver(() => chart.setSize({ width: el.clientWidth, height: 360 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      chart.destroy();
      plot.current = null;
    };
    // The chart is rebuilt for each new series and range; that is cheap next to the fetch.
  }, [series, range.from, range.to]);

  return <div ref={host} className="chart" role="img" aria-label="Water level over time" />;
}
