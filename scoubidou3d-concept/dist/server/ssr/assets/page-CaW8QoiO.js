import { a as require_react, o as __toESM, t as require_jsx_runtime } from "../index.js";
//#region app/page.tsx
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var import_jsx_runtime = require_jsx_runtime();
var palettes = [
	{
		name: "Citrus",
		a: "#ff5c35",
		b: "#ffd447",
		bg: "#f7f0df"
	},
	{
		name: "Lagoon",
		a: "#087e8b",
		b: "#62c7ba",
		bg: "#fff6df"
	},
	{
		name: "Berry",
		a: "#b33f62",
		b: "#f49ab0",
		bg: "#f8e9d8"
	},
	{
		name: "Night",
		a: "#26215c",
		b: "#6e65cf",
		bg: "#f0e8cf"
	}
];
var projects = [
	{
		title: "Square Knot Key Fob",
		category: "Beginner",
		level: "First project",
		time: "25 min",
		strands: "2 strands",
		tone: "coral",
		shape: "keyfob"
	},
	{
		title: "Checkerboard Coaster",
		category: "Geometric",
		level: "Easy",
		time: "45 min",
		strands: "6 strands",
		tone: "yellow",
		shape: "grid"
	},
	{
		title: "Helix Lanyard",
		category: "Sculptural",
		level: "Intermediate",
		time: "1.5 hr",
		strands: "4 strands",
		tone: "teal",
		shape: "helix"
	}
];
function Mark({ small = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		className: small ? "mark small" : "mark",
		viewBox: "0 0 72 72",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				d: "M9 16h54v16H9z",
				className: "ma"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				d: "M28 8h16v56H28z",
				className: "mb"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				d: "M28 16h16v16H28z",
				className: "mt"
			})
		]
	});
}
function Arrow() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		className: "arrow",
		viewBox: "0 0 20 20",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 10h11M11 5l5 5-5 5" })
	});
}
function ProjectArt({ shape }) {
	if (shape === "grid") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: "0 0 320 220",
		"aria-hidden": "true",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", {
			className: "gridBack",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "58",
					y: "40",
					width: "36",
					height: "142",
					rx: "15"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "113",
					y: "40",
					width: "36",
					height: "142",
					rx: "15"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "168",
					y: "40",
					width: "36",
					height: "142",
					rx: "15"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "223",
					y: "40",
					width: "36",
					height: "142",
					rx: "15"
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", {
			className: "gridFront",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "50",
					y: "55",
					width: "218",
					height: "34",
					rx: "14"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "50",
					y: "111",
					width: "218",
					height: "34",
					rx: "14"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
					x: "50",
					y: "167",
					width: "218",
					height: "34",
					rx: "14"
				})
			]
		})]
	});
	if (shape === "helix") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: "0 0 320 220",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				className: "helixA",
				d: "M90 20c130 42 130 158 0 192"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				className: "helixB",
				d: "M230 20C100 62 100 178 230 212"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				className: "rungs",
				d: "M111 45h98M88 91h144M88 139h144M111 186h98"
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: "0 0 320 220",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				className: "fobA",
				d: "M160 30c-55 0-64 62-25 88 20 13 27 30 25 76"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				className: "fobB",
				d: "M160 30c55 0 64 62 25 88-20 13-27 30-25 76"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
				className: "knot",
				d: "M132 85l56 56M188 85l-56 56"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				className: "ring",
				cx: "160",
				cy: "30",
				r: "20"
			})
		]
	});
}
function Weave({ mini = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: mini ? "weave mini" : "weave",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "rh h1" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "rh h2" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "rh h3" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "rv v1" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "rv v2" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "rv v3" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { className: "cross c1" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { className: "cross c2" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { className: "cross c3" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { className: "cross c4" })
		]
	});
}
function Home() {
	const [filter, setFilter] = (0, import_react.useState)("All");
	const [palette, setPalette] = (0, import_react.useState)(0);
	const [top, setTop] = (0, import_react.useState)(false);
	const visible = (0, import_react.useMemo)(() => filter === "All" ? projects : projects.filter((p) => p.category === filter), [filter]);
	const colors = palettes[palette];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "notice",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Free, open-source, and made for curious hands." }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
				href: "#learn",
				children: ["Start with the basics ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
				className: "brand",
				href: "#",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, { small: true }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["Scoubidou", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "3D" })] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "#projects",
					children: "Explore projects"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "#learn",
					children: "Learn"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "#why",
					children: "Why 3D?"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "https://github.com/ysetbon/Scoubidou3D",
					children: "GitHub"
				})
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
				className: "btn dark",
				href: "https://ysetbon.github.io/Scoubidou3D/app/",
				children: ["Open the studio ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
			})
		] }),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "hero",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "heroCopy",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "kicker",
						children: "Digital weaving, with real depth"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", { children: [
						"See every strand.",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "Shape every crossing." })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "lead",
						children: "A playful 3D studio for designing woven laces, knots, and patterns. Build from above, then tilt the camera and watch your weave come alive."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "actions",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							className: "btn coral",
							href: "https://ysetbon.github.io/Scoubidou3D/app/",
							children: ["Start weaving ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
							className: "under",
							href: "#how",
							children: "See how it works ↓"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "trust",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "◎ No install" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "◎ Works in your browser" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "◎ Your files stay local" })
						]
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "heroStage",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "pill p1",
						children: "orbit to explore"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "pill p2",
						children: "true over / under"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Weave, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "swatches",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "your palette" })
						]
					})
				]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "paths",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
					href: "#projects",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "01" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "I need inspiration" }), "Browse projects"] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
					href: "#learn",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "02" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "I’m new here" }), "Learn the basics"] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
					href: "https://ysetbon.github.io/Scoubidou3D/app/",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "03" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "I know what I’m making" }), "Open a blank canvas"] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})
					]
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "section projects",
			id: "projects",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "heading",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "kicker",
						children: "Find your next weave"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
						"Start with a project,",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
						"not an empty canvas."
					] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Borrow the best idea from modern crochet and macramé shops: show makers exactly what they can build, how long it takes, and whether it matches their skill level." })]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "filters",
					children: [
						"All",
						"Beginner",
						"Geometric",
						"Sculptural"
					].map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: filter === x ? "active" : "",
						onClick: () => setFilter(x),
						children: x
					}, x))
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "projectGrid",
					children: visible.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: `projectArt ${p.tone}`,
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectArt, { shape: p.shape }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: p.level }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									"aria-label": `Save ${p.title}`,
									children: "♡"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "projectName",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: p.category }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: p.title })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "↗" })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "meta",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["◷ ", p.time] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["⌁ ", p.strands] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Guide included" })
							]
						})
					] }, p.title))
				})
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "section how",
			id: "how",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "howIntro",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "kicker",
						children: "From flat idea to woven object"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
						"Your pattern finally",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "makes sense in space." })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "The original site explains the geometry in detail. This version leads with the outcome, then reveals the technical depth when a maker wants it." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
						className: "btn light",
						href: "https://ysetbon.github.io/Scoubidou3D/app/",
						children: ["Try the studio ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "steps",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "1" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "step draw",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Draw your strands" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Pull from an endpoint to shape the path, width, and curve of each lace." })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "2" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "step crossStep",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Choose the crossing" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Click two strands and decide which one travels over—and which dips under." })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "3" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "step orbit",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), "360°"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Orbit, refine, save" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Tilt the camera, tune thickness, and save a scene you can return to." })
					] })
				]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
			className: "section lab",
			id: "why",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "labPanel",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "labCopy",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "kicker",
							children: "The interactive proof"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Flat patterns hide the most important part." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Switch the view and recolor this mini weave. In the real studio, every layer becomes height and each crossing becomes a smooth physical lift or dip." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "View" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "segments",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: !top ? "active" : "",
								onClick: () => setTop(false),
								children: "Perspective"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: top ? "active" : "",
								onClick: () => setTop(true),
								children: "Top"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "Color story" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "paletteBtns",
							children: palettes.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								"aria-label": `Use ${p.name} palette`,
								className: palette === i ? "active" : "",
								onClick: () => setPalette(i),
								style: {
									"--a": p.a,
									"--b": p.b
								},
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), p.name]
							}, p.name))
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: `miniStage ${top ? "top" : ""}`,
					style: {
						"--wa": colors.a,
						"--wb": colors.b,
						"--wbg": colors.bg
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Weave, { mini: true }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "axis",
						children: "X\xA0\xA0\xA0 Y\xA0\xA0\xA0 Z"
					})]
				})]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "section learn",
			id: "learn",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "heading",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "kicker",
					children: "A calmer way to learn"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "One knot at a time." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Make the learning library visual, progressive, and friendly to left-handed makers—with short lessons that open directly in the 3D studio." })]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "lessons",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "01 · 5 min" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, {}) }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Meet the studio" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Camera, canvas, and the three controls you need to begin." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: "https://ysetbon.github.io/Scoubidou3D/app/",
							children: ["Start lesson ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
						})
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "02 · 8 min" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "lessonCross",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Your first crossing" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Learn over, under, flip, and why the weave reads differently in 3D." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: "https://ysetbon.github.io/Scoubidou3D/app/",
							children: ["Start lesson ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
						})
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "03 · 12 min" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "rings",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Build a woven round" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Use levels to stack a continuous form without strands colliding." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: "https://ysetbon.github.io/Scoubidou3D/app/",
							children: ["Start lesson ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
						})
					] })
				]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "values",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
					"Made for play.",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
					"Built with precision."
				] })] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "✦" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Real thickness" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Solid ribbons with width, depth, rounded edges, and true layer height." })
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "⌁" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Faithful curves" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Import OpenStrand JSON and see familiar shapes translated into 3D." })
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "◉" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Private by default" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "The editor runs locally in your browser. Your ideas stay on your device." })
				] })
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "closing",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "kicker",
					children: "Ready when you are"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "What will you weave?" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Start with a sample, import an OpenStrand file, or make something nobody has seen before." }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
					className: "btn dark",
					href: "https://ysetbon.github.io/Scoubidou3D/app/",
					children: ["Open Scoubidou3D ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Arrow, {})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					className: "btn outline",
					href: "https://github.com/ysetbon/Scoubidou3D",
					children: "View on GitHub"
				})] })
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
				className: "brand",
				href: "#",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, { small: true }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["Scoubidou", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "3D" })] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "A tactile home for digital weaving." }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "#projects",
					children: "Projects"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "#learn",
					children: "Learn"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: "https://github.com/ysetbon/Scoubidou3D",
					children: "Source"
				})
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "Concept redesign · 2026" })
		] })
	] });
}
//#endregion
export { Home as default };
