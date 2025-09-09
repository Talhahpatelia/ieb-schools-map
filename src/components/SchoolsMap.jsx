// src/components/SchoolsMapSvg.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

const SCHOOLS_URL = "/schools.json";
const COUNTRIES_SVG_URL = "/countries.svg"; // put your world SVG here (public/countries.svg)

const PROVINCE_ALIASES = {
    "western cape": "Western Cape",
    "northern cape": "Northern Cape",
    "eastern cape": "Eastern Cape",
    "free state": "Free State",
    "kwazulu natal": "KwaZulu-Natal",
    kzn: "KwaZulu-Natal",
    "north west": "North West",
    gauteng: "Gauteng",
    limpopo: "Limpopo",
    mpumalanga: "Mpumalanga",
};

/** Find province shapes inside the SA group, grouped by canonical province name */
function extractProvinceParts(saNode) {
    if (!saNode) return new Map(); // name -> [nodes]

    const canonical = (s) => {
        const key = (s || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
        return PROVINCE_ALIASES[key] || s; // return original if not matched
    };

    // Common attribute sources in various SVG packs:
    //   id, data-name, name, title text, aria-label
    const nameFromNode = (n) => {
        const byAttr =
            n.getAttribute("data-name") ||
            n.getAttribute("name") ||
            n.getAttribute("aria-label") ||
            n.getAttribute("id") ||
            "";
        // Try to read a <title>…</title> child if present
        const t = n.querySelector?.(":scope > title")?.textContent || "";
        const raw = t || byAttr;

        // Try to pull a province-like name out of the raw string
        const m = raw
            .toLowerCase()
            .match(
                /(western cape|northern cape|eastern cape|free state|kwazulu[-\s]*natal|kzn|north west|gauteng|limpopo|mpumalanga)/
            );
        if (!m) return null;

        const prov = m[1].replace(/-/g, " ");
        return canonical(prov);
    };

    const map = new Map(); // prov -> [clonedNodes]

    const candidates =
        saNode.querySelectorAll?.("path, polygon, polyline, g") || [];
    candidates.forEach((n) => {
        const prov = nameFromNode(n);
        if (!prov) return;
        const arr = map.get(prov) || [];
        arr.push(n.cloneNode(true));
        map.set(prov, arr);
    });

    return map;
}

const normalizeProvince = (s = "") =>
    s
        .toString()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\bKZN\b/i, "KwaZulu-Natal")
        .replace(/\bKwaZulu[-\s]*Natal\b/i, "KwaZulu-Natal");

export default function SchoolsMapSvg() {
    const [schools, setSchools] = useState([]);
    const [filtered, setFiltered] = useState([]);
    const [tooltip, setTooltip] = useState(null);
    const [err, setErr] = useState(null);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");

    // South Africa path data extracted from countries.svg
    const [saNode, setSaNode] = useState(null); // a <path> or <g> DOM node
    const svgRef = useRef(null);

    useEffect(() => {
        let alive = true;

        async function loadCountriesSvg() {
            // fetch as text, parse into a live SVG DOM, find *all* ZA nodes, clone them
            const res = await fetch(COUNTRIES_SVG_URL, { cache: "no-store" });
            if (!res.ok)
                throw new Error(
                    `Failed to load countries.svg (HTTP ${res.status})`
                );
            const text = await res.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "image/svg+xml");
            const svg = doc.querySelector("svg");
            if (!svg) throw new Error("countries.svg has no <svg>");

            // 1) If there’s a single <g> that is clearly the whole SA, prefer that.
            const wholeGroupSelectors = [
                "g#ZA",
                "g#ZAF",
                'g[id="South Africa"]',
                'g[data-name="South Africa"]',
                'g[aria-label="South Africa"]',
                'g[id*="south"][id*="africa" i]',
            ];
            for (const sel of wholeGroupSelectors) {
                const g = svg.querySelector(sel);
                if (g) return g.cloneNode(true);
            }

            // 2) Otherwise gather ALL nodes that look like SA parts.
            const partSelectors = [
                "#ZA",
                "#ZAF",
                "path#ZA",
                "path#ZAF",
                'path[id="South Africa"]',
                'path[data-name="South Africa"]',
                'path[aria-label="South Africa"]',
                'path[title="South Africa"]',
                'path[id*="south"][id*="africa" i]',
                'g[id*="south"][id*="africa" i] path',
            ];

            // Collect by selectors
            const matches = new Set();
            for (const sel of partSelectors) {
                svg.querySelectorAll(sel)?.forEach((n) => matches.add(n));
            }

            // 3) Also look for <title>South Africa</title> and take the parent group/path.
            svg.querySelectorAll("title")?.forEach((t) => {
                if (t.textContent?.toLowerCase().includes("south africa")) {
                    const p = t.parentElement;
                    if (p) matches.add(p);
                }
            });

            if (matches.size === 0) {
                // last resort: any path whose id contains ZA (common in some packs)
                svg.querySelectorAll('path[id*="ZA"], path[id*="za"]').forEach(
                    (n) => matches.add(n)
                );
            }

            if (matches.size === 0) {
                throw new Error(
                    "Could not find South Africa shape in countries.svg"
                );
            }

            // 4) Wrap all found pieces into a single <g>, cloned, so your bbox/transform works.
            const ns = "http://www.w3.org/2000/svg";
            const wrap = doc.createElementNS(ns, "g");
            matches.forEach((n) => wrap.appendChild(n.cloneNode(true)));

            // Optional: if the original SVG uses strokes that scale oddly, normalize:
            wrap.querySelectorAll("path").forEach((p) => {
                p.setAttribute("vector-effect", "non-scaling-stroke");
            });

            return wrap;
        }

        async function loadSchools() {
            const raw = await d3.json(SCHOOLS_URL);
            const parsed = (raw || []).map((d) => {
                const x = d.data || d;
                return {
                    id:
                        d.id ||
                        x._id ||
                        `${Math.random().toString(36).slice(2)}${Date.now()}`,
                    title: (x.title || "").trim(),
                    province: normalizeProvince(x.province || ""),
                    area: (x.area || "").trim(),
                    website: (x.website || "").trim(),
                    email: (x.emailAddress || "").trim(),
                    telephone: (x.telephone || "").trim(),
                };
            });
            return parsed;
        }

        (async () => {
            try {
                setLoading(true);
                const [sa, sch] = await Promise.all([
                    loadCountriesSvg(),
                    loadSchools(),
                ]);
                if (!alive) return;
                setSaNode(sa);
                setSchools(sch);
                setFiltered(sch);
            } catch (e) {
                if (alive) setErr(e?.message || String(e));
            } finally {
                if (alive) setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    // search
    useEffect(() => {
        const q = query.trim().toLowerCase();
        if (!q) return setFiltered(schools);
        setFiltered(
            schools.filter(
                (s) =>
                    s.title.toLowerCase().includes(q) ||
                    (s.area || "").toLowerCase().includes(q) ||
                    (s.province || "").toLowerCase().includes(q)
            )
        );
    }, [query, schools]);

    // Once we have a SA node, compute its bbox, center & scale to our viewBox
    const view = { width: 800, height: 650, padding: 12 };
    const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });

    useEffect(() => {
        if (!saNode || !svgRef.current) return;
        // Put it in a temp <svg> to get a bbox
        const tempSvg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        );
        tempSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const g = document.createElementNS(tempSvg.namespaceURI, "g");
        g.appendChild(saNode.cloneNode(true));
        tempSvg.appendChild(g);
        document.body.appendChild(tempSvg); // needs to be in DOM for getBBox in some browsers

        try {
            const bbox = g.getBBox();
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + bbox.height / 2;

            const sx = (view.width - view.padding * 2) / bbox.width;
            const sy = (view.height - view.padding * 2) / bbox.height;
            const scale = Math.min(sx, sy);

            // translate so that bbox center goes to our view center
            const tx = view.width / 2 - scale * cx;
            const ty = view.height / 2 - scale * cy;

            setTransform({ scale, tx, ty });
        } catch (e) {
            console.warn("BBox failed; using default scale");
            setTransform({ scale: 1, tx: 0, ty: 0 });
        } finally {
            document.body.removeChild(tempSvg);
        }
    }, [saNode]);
    const countsByProv = useMemo(() => {
        const m = new Map();
        for (const s of schools) {
            const p = (s.province || "").trim();
            if (!p) continue;
            const k = PROVINCE_ALIASES[p.toLowerCase()] || p;
            m.set(k, (m.get(k) || 0) + 1);
        }
        return m;
    }, [schools]);

    const provincesMap = useMemo(() => extractProvinceParts(saNode), [saNode]);

    const maxCount = Math.max(1, ...[...countsByProv.values()]);
    // Light→dark based on count. You can tweak the range to taste.
    const fillScale = d3
        .scaleLinear()
        .domain([0, maxCount])
        .range(["#91a9ff", "#4a6ff5"]);

    if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
    if (err) return <div style={{ padding: 16, color: "#fca5a5" }}>{err}</div>;
    if (!saNode)
        return (
            <div style={{ padding: 16, color: "#fca5a5" }}>
                South Africa shape not found in countries.svg
            </div>
        );

    return (
        <div
            style={{
                padding: 16,
                background: "#0b1020",
                minHeight: "100vh",
                color: "#e9eefb",
            }}
        >
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
                IEB High Schools — South Africa
            </h1>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 340px",
                    gap: 16,
                }}
            >
                {/* MAP (country outline only) */}
                <div
                    style={{
                        background: "#172145",
                        borderRadius: 16,
                        padding: 12,
                        border: "1px solid #2b3a72",
                    }}
                >
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${view.width} ${view.height}`}
                        style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                        }}
                    >
                        <g
                            transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}
                        >
                            {/* If provinces are detected, draw province parts; else fallback to whole shape */}
                            {provincesMap.size > 0
                                ? [...provincesMap.entries()].map(
                                      ([prov, nodes], idx) => {
                                          const count =
                                              countsByProv.get(prov) || 0;
                                          const groupEl = (
                                              <g
                                                  key={prov}
                                                  onMouseMove={(e) =>
                                                      setTooltip({
                                                          x: e.clientX + 10,
                                                          y: e.clientY - 10,
                                                          name: prov,
                                                          count,
                                                          list: schools
                                                              .filter(
                                                                  (s) =>
                                                                      (PROVINCE_ALIASES[
                                                                          (
                                                                              s.province ||
                                                                              ""
                                                                          ).toLowerCase()
                                                                      ] ||
                                                                          s.province) ===
                                                                      prov
                                                              )
                                                              .slice(0, 12),
                                                          more: Math.max(
                                                              0,
                                                              schools.filter(
                                                                  (s) =>
                                                                      (PROVINCE_ALIASES[
                                                                          (
                                                                              s.province ||
                                                                              ""
                                                                          ).toLowerCase()
                                                                      ] ||
                                                                          s.province) ===
                                                                      prov
                                                              ).length - 12
                                                          ),
                                                      })
                                                  }
                                                  onMouseLeave={() =>
                                                      setTooltip(null)
                                                  }
                                                  style={{ cursor: "pointer" }}
                                              >
                                                  {/* all pieces that compose this province */}
                                                  {nodes.map((n, i) =>
                                                      React.cloneElement(
                                                          svgElementFromNode(n),
                                                          {
                                                              key: i,
                                                              fill: fillScale(
                                                                  count
                                                              ),
                                                              stroke: "#ffffff",
                                                              strokeWidth: 2,
                                                              vectorEffect:
                                                                  "non-scaling-stroke",
                                                          }
                                                      )
                                                  )}
                                              </g>
                                          );

                                          return groupEl;
                                      }
                                  )
                                : // Fallback: whole country as one shape
                                  React.cloneElement(
                                      svgElementFromNode(saNode),
                                      {
                                          fill: "#6e95ff",
                                          stroke: "#ffffff",
                                          strokeWidth: 2,
                                          vectorEffect: "non-scaling-stroke",
                                          onMouseMove: (e) =>
                                              setTooltip({
                                                  x: e.clientX + 10,
                                                  y: e.clientY - 10,
                                                  name: "South Africa",
                                                  count: schools.length,
                                                  list: schools.slice(0, 12),
                                                  more: Math.max(
                                                      0,
                                                      schools.length - 12
                                                  ),
                                              }),
                                          onMouseLeave: () => setTooltip(null),
                                      }
                                  )}
                        </g>
                    </svg>

                    {tooltip && (
                        <div
                            style={{
                                position: "fixed",
                                left: tooltip.x,
                                top: tooltip.y,
                                pointerEvents: "none",
                                background: "#0a122a",
                                color: "#e9eefb",
                                border: "1px solid #22305f",
                                borderRadius: 10,
                                padding: "10px 12px",
                                fontSize: 14,
                                maxWidth: 420,
                                boxShadow: "0 10px 30px rgba(0,0,0,.35)",
                            }}
                        >
                            <div style={{ fontWeight: 800, marginBottom: 8 }}>
                                {tooltip.name} — {tooltip.count} school
                                {tooltip.count === 1 ? "" : "s"}
                            </div>
                            {tooltip.list.length ? (
                                <ul style={{ margin: 0, paddingLeft: 20 }}>
                                    {tooltip.list.map((s) => (
                                        <li
                                            key={s.id}
                                            style={{ marginBottom: 6 }}
                                        >
                                            {s.title}{" "}
                                            {s.website && (
                                                <>
                                                    —{" "}
                                                    <a
                                                        href={s.website}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{
                                                            color: "#8fb6ff",
                                                        }}
                                                    >
                                                        website
                                                    </a>
                                                </>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div style={{ color: "#97a0b8" }}>
                                    No entries.
                                </div>
                            )}
                            {tooltip.more > 0 && (
                                <div style={{ color: "#97a0b8", marginTop: 6 }}>
                                    …and {tooltip.more} more
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* LIST + SEARCH */}
                <div
                    style={{
                        background: "#172145",
                        borderRadius: 16,
                        padding: 12,
                        border: "1px solid #2b3a72",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            marginBottom: 8,
                        }}
                    >
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                            Schools{" "}
                            <span style={{ color: "#97a0b8" }}>
                                ({filtered.length})
                            </span>
                        </div>
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search name, area, province…"
                            style={{
                                marginLeft: "auto",
                                padding: "6px 10px",
                                borderRadius: 10,
                                border: "1px solid #24305c",
                                background: "#0d142b",
                                color: "#e9eefb",
                                outline: "none",
                                fontSize: 12,
                                width: 220,
                            }}
                        />
                    </div>

                    <div style={{ maxHeight: 560, overflow: "auto" }}>
                        {[...filtered]
                            .sort((a, b) =>
                                (a.title || "").localeCompare(b.title || "")
                            )
                            .map((s) => (
                                <div
                                    key={s.id}
                                    style={{
                                        padding: "8px 10px",
                                        borderRadius: 10,
                                    }}
                                >
                                    <div
                                        style={{
                                            fontWeight: 600,
                                            fontSize: 13,
                                        }}
                                    >
                                        {s.title}
                                    </div>
                                    <div
                                        style={{
                                            color: "#97a0b8",
                                            fontSize: 12,
                                        }}
                                    >
                                        {s.area ? `${s.area} · ` : ""}
                                        {s.province}
                                    </div>
                                    {(s.telephone || s.email) && (
                                        <div
                                            style={{
                                                color: "#97a0b8",
                                                fontSize: 12,
                                            }}
                                        >
                                            {s.telephone
                                                ? `☎ ${s.telephone} `
                                                : ""}
                                            {s.email ? `· ✉ ${s.email}` : ""}
                                        </div>
                                    )}
                                    {s.website && (
                                        <a
                                            href={s.website}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                                color: "#8fb6ff",
                                                fontSize: 12,
                                            }}
                                        >
                                            Visit website
                                        </a>
                                    )}
                                </div>
                            ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Convert a DOM SVG node to a React element (keeps nested structure) */
function svgElementFromNode(node) {
    if (!node) return null;
    const name = node.tagName.toLowerCase();
    const props = {};
    for (const attr of node.getAttributeNames()) {
        props[attr === "class" ? "className" : attr] = node.getAttribute(attr);
    }
    const children = [];
    node.childNodes.forEach((ch) => {
        if (ch.nodeType === 1) children.push(svgElementFromNode(ch));
    });
    return React.createElement(name, props, children.length ? children : null);
}
