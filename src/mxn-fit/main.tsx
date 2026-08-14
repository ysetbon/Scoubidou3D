import { createRoot } from "react-dom/client";
import { Fitter } from "./fitter";
// Its own stylesheet, which pulls in preflight: the fitter shares the lab's
// palette and none of its layout (src/mxn-ks/main.tsx does the same).
import "./fit.css";

const host = document.getElementById("fitter");
if (!host) throw new Error("#fitter is missing from mxn/fit/index.html");

createRoot(host).render(<Fitter />);
