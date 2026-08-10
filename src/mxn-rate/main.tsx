import { createRoot } from "react-dom/client";
import { Categoriser } from "./rate";
import "../mxn-lab/lab.css";
import "./rate.css";

const host = document.getElementById("rate");
if (!host) throw new Error("#rate is missing from the document");
createRoot(host).render(<Categoriser />);
