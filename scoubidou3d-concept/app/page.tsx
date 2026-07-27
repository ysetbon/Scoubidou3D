"use client";

import { useMemo, useState } from "react";

const palettes = [
  { name: "Citrus", a: "#ff5c35", b: "#ffd447", bg: "#f7f0df" },
  { name: "Lagoon", a: "#087e8b", b: "#62c7ba", bg: "#fff6df" },
  { name: "Berry", a: "#b33f62", b: "#f49ab0", bg: "#f8e9d8" },
  { name: "Night", a: "#26215c", b: "#6e65cf", bg: "#f0e8cf" },
];

const projects = [
  { title: "Square Knot Key Fob", category: "Beginner", level: "First project", time: "25 min", strands: "2 strands", tone: "coral", shape: "keyfob" },
  { title: "Checkerboard Coaster", category: "Geometric", level: "Easy", time: "45 min", strands: "6 strands", tone: "yellow", shape: "grid" },
  { title: "Helix Lanyard", category: "Sculptural", level: "Intermediate", time: "1.5 hr", strands: "4 strands", tone: "teal", shape: "helix" },
];

function Mark({ small = false }: { small?: boolean }) {
  return <svg className={small ? "mark small" : "mark"} viewBox="0 0 72 72" aria-hidden="true"><path d="M9 16h54v16H9z" className="ma"/><path d="M28 8h16v56H28z" className="mb"/><path d="M28 16h16v16H28z" className="mt"/></svg>;
}

function Arrow() {
  return <svg className="arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5"/></svg>;
}

function ProjectArt({ shape }: { shape: string }) {
  if (shape === "grid") return <svg viewBox="0 0 320 220" aria-hidden="true"><g className="gridBack"><rect x="58" y="40" width="36" height="142" rx="15"/><rect x="113" y="40" width="36" height="142" rx="15"/><rect x="168" y="40" width="36" height="142" rx="15"/><rect x="223" y="40" width="36" height="142" rx="15"/></g><g className="gridFront"><rect x="50" y="55" width="218" height="34" rx="14"/><rect x="50" y="111" width="218" height="34" rx="14"/><rect x="50" y="167" width="218" height="34" rx="14"/></g></svg>;
  if (shape === "helix") return <svg viewBox="0 0 320 220" aria-hidden="true"><path className="helixA" d="M90 20c130 42 130 158 0 192"/><path className="helixB" d="M230 20C100 62 100 178 230 212"/><path className="rungs" d="M111 45h98M88 91h144M88 139h144M111 186h98"/></svg>;
  return <svg viewBox="0 0 320 220" aria-hidden="true"><path className="fobA" d="M160 30c-55 0-64 62-25 88 20 13 27 30 25 76"/><path className="fobB" d="M160 30c55 0 64 62 25 88-20 13-27 30-25 76"/><path className="knot" d="M132 85l56 56M188 85l-56 56"/><circle className="ring" cx="160" cy="30" r="20"/></svg>;
}

function Weave({ mini = false }: { mini?: boolean }) {
  return <div className={mini ? "weave mini" : "weave"}><i className="rh h1"/><i className="rh h2"/><i className="rh h3"/><i className="rv v1"/><i className="rv v2"/><i className="rv v3"/><b className="cross c1"/><b className="cross c2"/><b className="cross c3"/><b className="cross c4"/></div>;
}

export default function Home() {
  const [filter, setFilter] = useState("All");
  const [palette, setPalette] = useState(0);
  const [top, setTop] = useState(false);
  const visible = useMemo(() => filter === "All" ? projects : projects.filter(p => p.category === filter), [filter]);
  const colors = palettes[palette];

  return <main>
    <div className="notice"><span>Free, open-source, and made for curious hands.</span><a href="#learn">Start with the basics <Arrow/></a></div>
    <header>
      <a className="brand" href="#"><Mark small/><span>Scoubidou<strong>3D</strong></span></a>
      <nav><a href="#projects">Explore projects</a><a href="#learn">Learn</a><a href="#why">Why 3D?</a><a href="https://github.com/ysetbon/Scoubidou3D">GitHub</a></nav>
      <a className="btn dark" href="https://ysetbon.github.io/Scoubidou3D/app/">Open the studio <Arrow/></a>
    </header>

    <section className="hero">
      <div className="heroCopy">
        <p className="kicker">Digital weaving, with real depth</p>
        <h1>See every strand.<br/><em>Shape every crossing.</em></h1>
        <p className="lead">A playful 3D studio for designing woven laces, knots, and patterns. Build from above, then tilt the camera and watch your weave come alive.</p>
        <div className="actions"><a className="btn coral" href="https://ysetbon.github.io/Scoubidou3D/app/">Start weaving <Arrow/></a><a className="under" href="#how">See how it works ↓</a></div>
        <div className="trust"><span>◎ No install</span><span>◎ Works in your browser</span><span>◎ Your files stay local</span></div>
      </div>
      <div className="heroStage"><span className="pill p1">orbit to explore</span><span className="pill p2">true over / under</span><Weave/><div className="swatches"><i/><i/><i/><small>your palette</small></div></div>
    </section>

    <section className="paths"><a href="#projects"><b>01</b><span><small>I need inspiration</small>Browse projects</span><Arrow/></a><a href="#learn"><b>02</b><span><small>I’m new here</small>Learn the basics</span><Arrow/></a><a href="https://ysetbon.github.io/Scoubidou3D/app/"><b>03</b><span><small>I know what I’m making</small>Open a blank canvas</span><Arrow/></a></section>

    <section className="section projects" id="projects">
      <div className="heading"><div><p className="kicker">Find your next weave</p><h2>Start with a project,<br/>not an empty canvas.</h2></div><p>Borrow the best idea from modern crochet and macramé shops: show makers exactly what they can build, how long it takes, and whether it matches their skill level.</p></div>
      <div className="filters">{["All","Beginner","Geometric","Sculptural"].map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{x}</button>)}</div>
      <div className="projectGrid">{visible.map(p => <article key={p.title}><div className={`projectArt ${p.tone}`}><ProjectArt shape={p.shape}/><span>{p.level}</span><button aria-label={`Save ${p.title}`}>♡</button></div><div className="projectName"><div><small>{p.category}</small><h3>{p.title}</h3></div><b>↗</b></div><div className="meta"><span>◷ {p.time}</span><span>⌁ {p.strands}</span><span>Guide included</span></div></article>)}</div>
    </section>

    <section className="section how" id="how">
      <div className="howIntro"><p className="kicker">From flat idea to woven object</p><h2>Your pattern finally<br/><em>makes sense in space.</em></h2><p>The original site explains the geometry in detail. This version leads with the outcome, then reveals the technical depth when a maker wants it.</p><a className="btn light" href="https://ysetbon.github.io/Scoubidou3D/app/">Try the studio <Arrow/></a></div>
      <div className="steps"><article><b>1</b><div className="step draw"><i/><i/></div><h3>Draw your strands</h3><p>Pull from an endpoint to shape the path, width, and curve of each lace.</p></article><article><b>2</b><div className="step crossStep"><i/><i/></div><h3>Choose the crossing</h3><p>Click two strands and decide which one travels over—and which dips under.</p></article><article><b>3</b><div className="step orbit"><i/>360°</div><h3>Orbit, refine, save</h3><p>Tilt the camera, tune thickness, and save a scene you can return to.</p></article></div>
    </section>

    <section className="section lab" id="why"><div className="labPanel">
      <div className="labCopy"><p className="kicker">The interactive proof</p><h2>Flat patterns hide the most important part.</h2><p>Switch the view and recolor this mini weave. In the real studio, every layer becomes height and each crossing becomes a smooth physical lift or dip.</p><label>View</label><div className="segments"><button className={!top ? "active" : ""} onClick={() => setTop(false)}>Perspective</button><button className={top ? "active" : ""} onClick={() => setTop(true)}>Top</button></div><label>Color story</label><div className="paletteBtns">{palettes.map((p,i) => <button aria-label={`Use ${p.name} palette`} className={palette===i ? "active" : ""} onClick={() => setPalette(i)} key={p.name} style={{"--a":p.a,"--b":p.b} as React.CSSProperties}><i/>{p.name}</button>)}</div></div>
      <div className={`miniStage ${top ? "top" : ""}`} style={{"--wa":colors.a,"--wb":colors.b,"--wbg":colors.bg} as React.CSSProperties}><Weave mini/><span className="axis">X&nbsp;&nbsp;&nbsp; Y&nbsp;&nbsp;&nbsp; Z</span></div>
    </div></section>

    <section className="section learn" id="learn"><div className="heading"><div><p className="kicker">A calmer way to learn</p><h2>One knot at a time.</h2></div><p>Make the learning library visual, progressive, and friendly to left-handed makers—with short lessons that open directly in the 3D studio.</p></div><div className="lessons"><article><span>01 · 5 min</span><div><Mark/></div><h3>Meet the studio</h3><p>Camera, canvas, and the three controls you need to begin.</p><a href="https://ysetbon.github.io/Scoubidou3D/app/">Start lesson <Arrow/></a></article><article><span>02 · 8 min</span><div className="lessonCross"><i/><i/></div><h3>Your first crossing</h3><p>Learn over, under, flip, and why the weave reads differently in 3D.</p><a href="https://ysetbon.github.io/Scoubidou3D/app/">Start lesson <Arrow/></a></article><article><span>03 · 12 min</span><div className="rings"><i/><i/><i/></div><h3>Build a woven round</h3><p>Use levels to stack a continuous form without strands colliding.</p><a href="https://ysetbon.github.io/Scoubidou3D/app/">Start lesson <Arrow/></a></article></div></section>

    <section className="values"><div><Mark/><h2>Made for play.<br/>Built with precision.</h2></div><article><b>✦</b><h3>Real thickness</h3><p>Solid ribbons with width, depth, rounded edges, and true layer height.</p></article><article><b>⌁</b><h3>Faithful curves</h3><p>Import OpenStrand JSON and see familiar shapes translated into 3D.</p></article><article><b>◉</b><h3>Private by default</h3><p>The editor runs locally in your browser. Your ideas stay on your device.</p></article></section>

    <section className="closing"><p className="kicker">Ready when you are</p><h2>What will you weave?</h2><p>Start with a sample, import an OpenStrand file, or make something nobody has seen before.</p><div><a className="btn dark" href="https://ysetbon.github.io/Scoubidou3D/app/">Open Scoubidou3D <Arrow/></a><a className="btn outline" href="https://github.com/ysetbon/Scoubidou3D">View on GitHub</a></div></section>
    <footer><a className="brand" href="#"><Mark small/><span>Scoubidou<strong>3D</strong></span></a><p>A tactile home for digital weaving.</p><nav><a href="#projects">Projects</a><a href="#learn">Learn</a><a href="https://github.com/ysetbon/Scoubidou3D">Source</a></nav><small>Concept redesign · 2026</small></footer>
  </main>;
}
