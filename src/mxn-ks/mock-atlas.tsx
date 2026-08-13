// The k atlas, offline.
//
// The real page against the committed dump, with the live shelf switched off
// before it can be reached — the same arrangement mocks/widgets.html makes,
// where the components are real and only the thing that would need a network is
// stood in for. Nothing here is a drawing of the page; it IS the page.
//
//     npm run dev
//     open http://localhost:5173/Scoubidou3D/mocks/ks-atlas.html
//
// The dump is public/mxn/ks-atlas.json, so this and /mxn/ks/?data=mock read one
// file. Refresh it from a real Worker with `npm run dump:ks -- --url <worker>`.

import { createRoot } from "react-dom/client";
import { KAtlas } from "./atlas";
import "../mxn-lab/preflight.css";
import "./atlas.css";

const host = document.getElementById("mock");
if (!host) throw new Error("#mock is missing from mocks/ks-atlas.html");

createRoot(host).render(<KAtlas forceFixture />);
