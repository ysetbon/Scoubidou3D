// Upstream the lab is a Next app: app/layout.tsx renders <html>, app/page.tsx
// renders <ContinuationLab />, and a Cloudflare Worker serves the result. None
// of that server is load-bearing — the component is "use client" and the engine
// runs in the visitor's browser through Pyodide — so on a static host the whole
// wrapper collapses to mounting the component on a div.
import { createRoot } from 'react-dom/client';
import { ContinuationLab } from './weave-studio';
import './lab.css';

const root = document.getElementById('lab');
if (!root) throw new Error('#lab is missing from mxn/index.html');

createRoot(root).render(<ContinuationLab />);
