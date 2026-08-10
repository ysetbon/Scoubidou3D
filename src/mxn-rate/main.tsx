import { createRoot } from "react-dom/client";
import { Categoriser } from "./rate";
// Preflight only, not the lab stylesheet: the categoriser has its own look.
import "../mxn-lab/preflight.css";
import "./rate.css";

const host = document.getElementById("rate");
if (!host) throw new Error("#rate is missing from the document");
// Two pages, one component. /mxn/rate/ grades rings that close; /mxn/semi/
// grades the ones that did not, where one band was held at a value known to
// work. They differ in which rows they pull and what the score means, not in
// how a ring is drawn, so a data attribute is the whole difference.
const kind = host.dataset.kind === "semi" ? "semi" : "complete";
createRoot(host).render(<Categoriser kind={kind} />);
