import { createRoot } from "react-dom/client";
import { KBoard } from "./board";
// Preflight only, not the lab stylesheet: the board is a reading of the shelf
// laid out as a plane, and shares the lab's palette but none of its layout.
import "../mxn-lab/preflight.css";
import "./board.css";

const host = document.getElementById("board");
if (!host) throw new Error("#board is missing from mxn/ks/<k>/index.html");

/**
 * Which k this page is.
 *
 * The host's `data-k` first, because that is what the generated shell states
 * and it survives being served from anywhere. The path is the fallback and is
 * the honest second source: /mxn/ks/-1/ IS the k, so a shell whose attribute
 * was lost in an edit still opens the board it is named after rather than
 * silently opening k = 0.
 */
function kOfPage(): number | null {
  const stated = Number(host!.dataset.k);
  if (Number.isInteger(stated)) return stated;
  const segment = window.location.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  const parsed = Number(segment);
  return Number.isInteger(parsed) ? parsed : null;
}

const k = kOfPage();
if (k === null) {
  // No guess. A board drawn at the wrong k is a page full of confident,
  // wrong tiles, and every one of them links somewhere wrong as well.
  host.textContent = "This page does not say which k it is about. "
    + "Open one of the boards from /mxn/ks/ instead.";
} else {
  createRoot(host).render(<KBoard k={k} />);
}
