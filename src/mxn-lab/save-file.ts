// Hand a file to the reader.
//
// Eight lines, and the fourth page in this suite wanted them — the lab's saved
// rings, the categoriser's CSV, the trace panel's recording, and now the k
// atlas's search envelope. Same move exact-draw.ts records for the renderer:
// lifted when a second caller appeared rather than copied a third time.
//
// The deferred revoke is the whole subtlety, and the reason this is worth
// sharing rather than retyping.

/**
 * Save `text` as `name`.
 *
 * The object URL is revoked on a timer rather than immediately: revoking in the
 * same tick can beat the download on some browsers, and the object lives only
 * until then either way. The anchor is never appended to the document — a
 * detached one clicks fine and leaves nothing behind.
 */
export function saveFile(name: string, text: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The same, for the JSON case, pretty-printed so the file can be read. */
export function saveJson(name: string, value: unknown) {
  saveFile(name, `${JSON.stringify(value, null, 1)}\n`, "application/json;charset=utf-8");
}

/** `2026-08-13`, the suffix every export in this repo dates itself with. */
export const today = () => new Date().toISOString().slice(0, 10);
