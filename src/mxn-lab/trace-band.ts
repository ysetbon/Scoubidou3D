// Which band a trace belongs to, spelled one way.
//
// The two sides of the worker boundary name a band differently: the page asks
// for "h" or "v", and bridge.trace_level answers with the direction_type it
// searched, "horizontal" or "vertical". That is fine until something is keyed
// on the name -- a reply filed under its own spelling and looked up under the
// other is a trace that arrived and is never found, which reads in the UI as a
// drawer that spins forever.
//
// The test below mirrors bridge.trace_level's own: anything starting with v is
// vertical, everything else horizontal.
export type Band = "h" | "v";

export const bandKey = (band: string): Band =>
  String(band).toLowerCase().startsWith("v") ? "v" : "h";

/** Cache key for one level's trace of one band, from either spelling. */
export const traceKey = (level: number, band: string) => `${level}:${bandKey(band)}`;
