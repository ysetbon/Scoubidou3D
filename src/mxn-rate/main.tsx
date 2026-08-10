import { createRoot } from "react-dom/client";
import { Categoriser } from "./rate";
// Preflight only, not the lab stylesheet: the categoriser has its own look.
import "../mxn-lab/preflight.css";
import "./rate.css";

const host = document.getElementById("rate");
if (!host) throw new Error("#rate is missing from the document");
createRoot(host).render(<Categoriser />);
