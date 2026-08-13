import { createRoot } from "react-dom/client";
import { KAtlas } from "./atlas";
// Preflight only, not the lab stylesheet: the atlas is a reading of the shelf
// rather than a drawing, and shares the lab's palette but none of its layout.
import "../mxn-lab/preflight.css";
import "./atlas.css";

const host = document.getElementById("atlas");
if (!host) throw new Error("#atlas is missing from mxn/ks/index.html");

createRoot(host).render(<KAtlas />);
