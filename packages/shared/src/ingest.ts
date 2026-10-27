import { z } from "zod";

// The device may be an Arduino today and something bigger later, so the ingest endpoint accepts a
// few shapes. Whatever the shape, the server decides the timestamps: the newest sample is stamped
// with the time the request arrived and the rest are placed before it.

const adc = z.number().int().min(0).max(65535);

/** Most samples one request may carry: three hours at one a second. */
export const MAX_SAMPLES_PER_REQUEST = 10_800;

/** Evenly spaced samples, oldest first. The spacing defaults to one second. */
const evenlySpaced = z.object({
  samples: z.array(adc).min(1).max(MAX_SAMPLES_PER_REQUEST),
  interval_ms: z.number().int().min(1).max(3_600_000).default(1000),
});

/** Samples at explicit ages: ago_ms is how long before the request the sample was taken. */
const withAges = z.object({
  readings: z
    .array(z.object({ adc, ago_ms: z.number().int().min(0).max(30 * 86_400_000) }))
    .min(1)
    .max(MAX_SAMPLES_PER_REQUEST),
});

/** One sample, taken just now. */
const single = z.object({ adc });

export const ingestBodySchema = z.union([evenlySpaced, withAges, single]);
export type IngestBody = z.infer<typeof ingestBodySchema>;

export interface TimedSample {
  /** Milliseconds before the request arrived. */
  agoMs: number;
  adc: number;
}

/** Turns any accepted body into samples positioned relative to the arrival time. */
export function samplesFromBody(body: IngestBody): TimedSample[] {
  if ("samples" in body) {
    const n = body.samples.length;
    return body.samples.map((value, i) => ({ adc: value, agoMs: (n - 1 - i) * body.interval_ms }));
  }
  if ("readings" in body) return body.readings.map((r) => ({ adc: r.adc, agoMs: r.ago_ms }));
  return [{ adc: body.adc, agoMs: 0 }];
}
