import { createRoot } from "react-dom/client";
import { ComputeFarm } from "./farm";
// Preflight only, not the lab stylesheet: the farm is a console rather than a
// drawing, and shares nothing with the lab's look but the engine underneath.
import "../mxn-lab/preflight.css";
import "./farm.css";

const host = document.getElementById("farm");
if (!host) throw new Error("#farm is missing from mxn/gpu/index.html");

createRoot(host).render(<ComputeFarm />);
