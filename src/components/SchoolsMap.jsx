import React, {
    lazy,
    memo,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
    FaEnvelope,
    FaExternalLinkAlt,
    FaGithub,
    FaGlobe,
    FaLinkedin,
    FaLocationArrow,
    FaMapMarkerAlt,
    FaMoon,
    FaPhoneAlt,
    FaSearch,
    FaSun,
    FaTimes,
} from "react-icons/fa";
import "./SchoolsMap.css";

const ProvinceChart = lazy(() => import("./ProvinceChart"));

const SCHOOLS_URL = "/schools.json";
const PROVINCES_URL = "/sa-provinces.geojson";
const GOTCHA_LOGO_URL = "/gotcha-logo.svg";

const MAP_STYLES = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark",
};

const SOUTH_AFRICA_BOUNDS = [
    [16.25, -35.4],
    [33.25, -21.9],
];

const PROVINCE_ORDER = [
    "Eastern Cape",
    "Free State",
    "Gauteng",
    "KwaZulu-Natal",
    "Limpopo",
    "Mpumalanga",
    "North West",
    "Northern Cape",
    "Western Cape",
];

const PROVINCE_ALIASES = {
    "eastern cape": "Eastern Cape",
    "free state": "Free State",
    gauteng: "Gauteng",
    "kwazulu natal": "KwaZulu-Natal",
    "kwa zulu natal": "KwaZulu-Natal",
    "kwa-zulu natal": "KwaZulu-Natal",
    kzn: "KwaZulu-Natal",
    limpopo: "Limpopo",
    mpumalanga: "Mpumalanga",
    "north west": "North West",
    "northern cape": "Northern Cape",
    "nothern cape": "Northern Cape",
    "western cape": "Western Cape",
};

const CHOROPLETH_COLORS = [
    "#d9eee8",
    "#8ed0c0",
    "#23a58f",
    "#f5b33f",
    "#f06445",
];

const LIST_BATCH_SIZE = 72;
const numberFormatter = new Intl.NumberFormat("en-ZA");

function normalizeProvince(value = "") {
    const key = value
        .toString()
        .trim()
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();

    return PROVINCE_ALIASES[key] || value.toString().trim();
}

function normalizeWebsite(value = "") {
    const website = value.toString().trim();
    if (!website) return "";
    return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function parseSchool(entry, index) {
    const data = entry?.data || entry || {};
    const title = (data.title || "Untitled school").toString().trim();
    const province = normalizeProvince(data.province || "");
    const area = (data.area || "").toString().trim();
    const telephone = (data.telephone || "").toString().trim();
    const email = (data.emailAddress || "").toString().trim();
    const website = normalizeWebsite(data.website || "");
    const year =
        (data.yearOfAffiliation || "").toString().match(/\d{4}/)?.[0] || "";
    const updatedAt = data._updatedDate?.$date || data._updatedDate || "";

    return {
        id: entry?.id || data._id || `${title}-${province}-${index}`,
        title,
        province,
        area,
        telephone,
        email,
        website,
        year,
        updatedAt,
        searchText: [title, province, area, telephone, email, website, year]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
    };
}

function pluralize(count, word) {
    return `${numberFormatter.format(count)} ${word}${count === 1 ? "" : "s"}`;
}

function compareSchools(a, b, sortMode) {
    if (sortMode === "province") {
        return (
            a.province.localeCompare(b.province) ||
            a.area.localeCompare(b.area) ||
            a.title.localeCompare(b.title)
        );
    }

    if (sortMode === "year") {
        return (
            Number(b.year || 0) - Number(a.year || 0) ||
            a.title.localeCompare(b.title)
        );
    }

    return a.title.localeCompare(b.title);
}

function colorForCount(count, maxCount) {
    if (!count) return "#c7d7d4";
    const ratio = Math.sqrt(count / Math.max(maxCount, 1));
    const index = Math.min(
        CHOROPLETH_COLORS.length - 1,
        Math.floor(ratio * CHOROPLETH_COLORS.length)
    );
    return CHOROPLETH_COLORS[index];
}

function createProvinceGeoJson(rawGeoJson, provinceCountByName, maxCount) {
    return {
        type: "FeatureCollection",
        features: (rawGeoJson?.features || []).map((feature, index) => {
            const province = normalizeProvince(feature.properties?.shapeName || "");
            const schoolCount = provinceCountByName.get(province) || 0;

            return {
                ...feature,
                id: index + 1,
                properties: {
                    ...feature.properties,
                    province,
                    schoolCount,
                    fillColor: colorForCount(schoolCount, maxCount),
                },
            };
        }),
    };
}

function getFeatureBounds(feature) {
    const bounds = {
        minLng: Infinity,
        minLat: Infinity,
        maxLng: -Infinity,
        maxLat: -Infinity,
    };

    function walk(coords) {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === "number" && typeof coords[1] === "number") {
            bounds.minLng = Math.min(bounds.minLng, coords[0]);
            bounds.minLat = Math.min(bounds.minLat, coords[1]);
            bounds.maxLng = Math.max(bounds.maxLng, coords[0]);
            bounds.maxLat = Math.max(bounds.maxLat, coords[1]);
            return;
        }
        coords.forEach(walk);
    }

    walk(feature?.geometry?.coordinates);

    if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) {
        return null;
    }

    return [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
    ];
}

function getInitialTheme() {
    const savedTheme = window.localStorage?.getItem("ieb-schools-theme");
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;

    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
        ? "dark"
        : "light";
}

function getMapLayerColors(theme) {
    return {
        line: theme === "dark" ? "#f6f0df" : "#15211d",
        selectedLine: theme === "dark" ? "#f5b33f" : "#103f38",
        labelHalo: theme === "dark" ? "#111515" : "#ffffff",
        labelText: theme === "dark" ? "#fff7e5" : "#1b2a25",
        bubbleText: theme === "dark" ? "#0f1614" : "#0f1614",
    };
}

function buildPopupHtml(province, count) {
    return `
        <div class="map-popup">
            <strong>${province}</strong>
            <span>${pluralize(count, "school")}</span>
        </div>
    `;
}

export default function SchoolsMap() {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const popupRef = useRef(null);
    const selectedProvinceRef = useRef("");
    const hoveredProvinceRef = useRef("");
    const featureByProvinceRef = useRef(new Map());

    const [schools, setSchools] = useState([]);
    const [rawProvinceGeoJson, setRawProvinceGeoJson] = useState(null);
    const [selectedProvince, setSelectedProvince] = useState("");
    const [hoveredProvince, setHoveredProvince] = useState("");
    const [query, setQuery] = useState("");
    const [sortMode, setSortMode] = useState("name");
    const [visibleLimit, setVisibleLimit] = useState(LIST_BATCH_SIZE);
    const [theme, setTheme] = useState(getInitialTheme);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const addMapLayersRef = useRef(() => {});
    const themeRef = useRef(theme);

    useEffect(() => {
        selectedProvinceRef.current = selectedProvince;
    }, [selectedProvince]);

    useEffect(() => {
        themeRef.current = theme;
    }, [theme]);

    useEffect(() => {
        window.localStorage?.setItem("ieb-schools-theme", theme);
    }, [theme]);

    useEffect(() => {
        let alive = true;

        async function loadData() {
            setLoading(true);
            setError("");

            try {
                const [schoolsResponse, provincesResponse] = await Promise.all([
                    fetch(SCHOOLS_URL, { cache: "no-store" }),
                    fetch(PROVINCES_URL, { cache: "force-cache" }),
                ]);

                if (!schoolsResponse.ok) {
                    throw new Error(
                        `Could not load schools.json (HTTP ${schoolsResponse.status})`
                    );
                }

                if (!provincesResponse.ok) {
                    throw new Error(
                        `Could not load sa-provinces.geojson (HTTP ${provincesResponse.status})`
                    );
                }

                const [schoolsJson, provincesJson] = await Promise.all([
                    schoolsResponse.json(),
                    provincesResponse.json(),
                ]);

                if (!alive) return;

                setSchools(
                    (schoolsJson || []).map((entry, index) =>
                        parseSchool(entry, index)
                    )
                );
                setRawProvinceGeoJson(provincesJson);
            } catch (err) {
                if (alive) {
                    setError(err?.message || "Could not load the school data.");
                }
            } finally {
                if (alive) setLoading(false);
            }
        }

        loadData();

        return () => {
            alive = false;
        };
    }, []);

    const provinceStats = useMemo(() => {
        const counts = new Map(PROVINCE_ORDER.map((province) => [province, 0]));

        for (const school of schools) {
            if (!school.province) continue;
            counts.set(school.province, (counts.get(school.province) || 0) + 1);
        }

        return [...counts.entries()]
            .map(([province, count]) => ({ province, count }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return (
                    PROVINCE_ORDER.indexOf(a.province) -
                    PROVINCE_ORDER.indexOf(b.province)
                );
            });
    }, [schools]);

    const provinceCountByName = useMemo(
        () =>
            new Map(
                provinceStats.map(({ province, count }) => [province, count])
            ),
        [provinceStats]
    );

    const maxProvinceCount = Math.max(
        1,
        ...provinceStats.map(({ count }) => count)
    );

    const provinceGeoJson = useMemo(
        () =>
            createProvinceGeoJson(
                rawProvinceGeoJson,
                provinceCountByName,
                maxProvinceCount
            ),
        [maxProvinceCount, provinceCountByName, rawProvinceGeoJson]
    );

    useEffect(() => {
        const map = new Map();
        for (const feature of provinceGeoJson.features) {
            map.set(feature.properties.province, feature);
        }
        featureByProvinceRef.current = map;
    }, [provinceGeoJson]);

    const visibleSchools = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();

        return schools.filter((school) => {
            const provinceMatches =
                !selectedProvince || school.province === selectedProvince;
            const queryMatches =
                !normalizedQuery || school.searchText.includes(normalizedQuery);
            return provinceMatches && queryMatches;
        });
    }, [query, schools, selectedProvince]);

    const sortedSchools = useMemo(() => {
        return [...visibleSchools].sort((a, b) =>
            compareSchools(a, b, sortMode)
        );
    }, [sortMode, visibleSchools]);

    const renderedSchools = useMemo(
        () => sortedSchools.slice(0, visibleLimit),
        [sortedSchools, visibleLimit]
    );

    const topProvince = provinceStats[0];
    const activeProvinceName =
        selectedProvince || hoveredProvince || topProvince?.province || "";
    const activeProvince = provinceStats.find(
        (item) => item.province === activeProvinceName
    );

    useEffect(() => {
        setVisibleLimit(LIST_BATCH_SIZE);
    }, [query, selectedProvince, sortMode]);

    const fitProvince = useCallback((province, options = {}) => {
        const map = mapRef.current;
        if (!map) return;

        if (!province) {
            map.fitBounds(SOUTH_AFRICA_BOUNDS, {
                padding: { top: 52, right: 52, bottom: 52, left: 52 },
                duration: options.instant ? 0 : 750,
            });
            return;
        }

        const feature = featureByProvinceRef.current.get(province);
        const bounds = getFeatureBounds(feature);
        if (!bounds) return;

        map.fitBounds(bounds, {
            padding: { top: 72, right: 72, bottom: 72, left: 72 },
            maxZoom: 7.4,
            duration: options.instant ? 0 : 750,
        });
    }, []);

    const setMapPaintForSelection = useCallback((province) => {
        const map = mapRef.current;
        if (!map?.getLayer("province-fill")) return;

        const colors = getMapLayerColors(theme);
        map.setPaintProperty("province-fill", "fill-opacity", [
            "case",
            ["all", ["!=", province, ""], ["!=", ["get", "province"], province]],
            0.25,
            0.7,
        ]);
        map.setPaintProperty("province-line", "line-color", [
            "case",
            ["==", ["get", "province"], province],
            colors.selectedLine,
            colors.line,
        ]);
        map.setPaintProperty("province-line", "line-width", [
            "case",
            ["==", ["get", "province"], province],
            3,
            1.2,
        ]);
    }, [theme]);

    const addMapLayers = useCallback(() => {
        const map = mapRef.current;
        if (!map || !provinceGeoJson.features.length) return;

        const colors = getMapLayerColors(theme);

        if (map.getLayer("province-labels")) map.removeLayer("province-labels");
        if (map.getLayer("province-bubbles")) map.removeLayer("province-bubbles");
        if (map.getLayer("province-line")) map.removeLayer("province-line");
        if (map.getLayer("province-fill")) map.removeLayer("province-fill");
        if (map.getSource("provinces")) map.removeSource("provinces");

        map.addSource("provinces", {
            type: "geojson",
            data: provinceGeoJson,
            promoteId: "province",
        });

        map.addLayer({
            id: "province-fill",
            type: "fill",
            source: "provinces",
            paint: {
                "fill-color": ["get", "fillColor"],
                "fill-opacity": 0.7,
            },
        });

        map.addLayer({
            id: "province-line",
            type: "line",
            source: "provinces",
            paint: {
                "line-color": colors.line,
                "line-width": 1.2,
            },
        });

        map.addLayer({
            id: "province-bubbles",
            type: "circle",
            source: "provinces",
            paint: {
                "circle-color": "#f5b33f",
                "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["sqrt", ["get", "schoolCount"]],
                    0,
                    8,
                    Math.sqrt(maxProvinceCount),
                    28,
                ],
                "circle-opacity": 0.9,
                "circle-stroke-color": colors.line,
                "circle-stroke-width": 1.5,
            },
        });

        map.addLayer({
            id: "province-labels",
            type: "symbol",
            source: "provinces",
            layout: {
                "text-field": [
                    "format",
                    ["get", "province"],
                    { "font-scale": 0.92 },
                    "\n",
                    {},
                    ["concat", ["to-string", ["get", "schoolCount"]], " schools"],
                    { "font-scale": 0.72 },
                ],
                "text-font": ["Noto Sans Regular"],
                "text-size": 13,
                "text-anchor": "center",
                "text-allow-overlap": false,
                "text-padding": 4,
            },
            paint: {
                "text-color": colors.labelText,
                "text-halo-color": colors.labelHalo,
                "text-halo-width": 1.6,
            },
        });

        setMapPaintForSelection(selectedProvinceRef.current);
    }, [maxProvinceCount, provinceGeoJson, setMapPaintForSelection, theme]);

    useEffect(() => {
        addMapLayersRef.current = addMapLayers;
    }, [addMapLayers]);

    useEffect(() => {
        if (loading || error || !mapContainerRef.current || mapRef.current) return;

        let cancelled = false;

        async function loadMap() {
            const module = await import("maplibre-gl");
            if (cancelled || mapRef.current || !mapContainerRef.current) return;

            const maplibregl = module.default || module;
            maplibregl.setWorkerCount?.(2);

            const map = new maplibregl.Map({
                container: mapContainerRef.current,
                style: MAP_STYLES[themeRef.current],
                bounds: SOUTH_AFRICA_BOUNDS,
                fitBoundsOptions: {
                    padding: { top: 52, right: 52, bottom: 52, left: 52 },
                },
                minZoom: 3.6,
                maxZoom: 10.5,
                pitch: 0,
                cooperativeGestures: true,
                attributionControl: false,
            });

            mapRef.current = map;
            popupRef.current = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 16,
            });

            map.addControl(
                new maplibregl.NavigationControl({ visualizePitch: true }),
                "top-right"
            );
            map.addControl(
                new maplibregl.AttributionControl({ compact: true }),
                "bottom-right"
            );

            const handleLoad = () => {
                addMapLayersRef.current();
                fitProvince("", { instant: true });
            };

            const handleStyleLoad = () => {
                addMapLayersRef.current();
            };

            const handleClick = (event) => {
                if (!map.getLayer("province-fill")) return;
                const feature = map.queryRenderedFeatures(event.point, {
                    layers: ["province-fill"],
                })?.[0];
                const province = feature?.properties?.province;
                if (!province) return;
                setSelectedProvince((current) =>
                    current === province ? "" : province
                );
            };

            const handleMouseMove = (event) => {
                if (!map.getLayer("province-fill")) return;
                const feature = map.queryRenderedFeatures(event.point, {
                    layers: ["province-fill"],
                })?.[0];
                const province = feature?.properties?.province;
                const count = Number(feature?.properties?.schoolCount || 0);

                if (!province) {
                    handleMouseLeave();
                    return;
                }

                map.getCanvas().style.cursor = "pointer";

                if (hoveredProvinceRef.current !== province) {
                    hoveredProvinceRef.current = province;
                    setHoveredProvince(province);
                }

                popupRef.current
                    ?.setLngLat(event.lngLat)
                    .setHTML(buildPopupHtml(province, count))
                    .addTo(map);
            };

            const handleMouseLeave = () => {
                map.getCanvas().style.cursor = "";
                hoveredProvinceRef.current = "";
                setHoveredProvince("");
                popupRef.current?.remove();
            };

            const canvas = map.getCanvas();
            map.on("load", handleLoad);
            map.on("style.load", handleStyleLoad);
            map.on("click", handleClick);
            map.on("mousemove", handleMouseMove);
            canvas.addEventListener("mouseleave", handleMouseLeave);

            map._gotchaCleanup = () => {
                map.off("load", handleLoad);
                map.off("style.load", handleStyleLoad);
                map.off("click", handleClick);
                map.off("mousemove", handleMouseMove);
                canvas.removeEventListener("mouseleave", handleMouseLeave);
            };
        }

        loadMap();

        return () => {
            cancelled = true;
            const map = mapRef.current;
            map?._gotchaCleanup?.();
            popupRef.current?.remove();
            map?.remove();
            mapRef.current = null;
        };
    }, [error, fitProvince, loading]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (map.isStyleLoaded()) {
            addMapLayers();
        }
    }, [addMapLayers, provinceGeoJson]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        map.setStyle(MAP_STYLES[theme], { diff: false });
    }, [theme]);

    useEffect(() => {
        setMapPaintForSelection(selectedProvince);
        fitProvince(selectedProvince);
    }, [fitProvince, selectedProvince, setMapPaintForSelection]);

    function toggleProvince(province) {
        setSelectedProvince((current) => (current === province ? "" : province));
    }

    function clearFilters() {
        setSelectedProvince("");
        setQuery("");
    }

    if (loading) {
        return (
            <main className="school-app" data-theme={theme}>
                <div className="state-screen" role="status">
                    <div className="loading-mark" />
                    <p>Loading school data</p>
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="school-app" data-theme={theme}>
                <div className="state-screen state-screen--error" role="alert">
                    <strong>Data could not be loaded</strong>
                    <p>{error}</p>
                </div>
            </main>
        );
    }

    return (
        <main className="school-app" data-theme={theme}>
            <header className="site-header">
                <div className="header-main">
                    <a
                        className="brand-lockup"
                        href="https://gotchaexam.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GotchaEducation"
                    >
                        <img src={GOTCHA_LOGO_URL} alt="" />
                    </a>

                    <div className="site-title">
                        <p className="eyebrow">Independent Examinations Board</p>
                        <h1>IEB Schools in South Africa</h1>
                        <p className="product-attribution">
                            A GotchaEducation tool
                        </p>
                    </div>
                </div>

                <div className="header-actions">
                    <button
                        className="theme-toggle"
                        type="button"
                        onClick={() =>
                            setTheme((current) =>
                                current === "dark" ? "light" : "dark"
                            )
                        }
                    >
                        {theme === "dark" ? (
                            <FaSun aria-hidden="true" />
                        ) : (
                            <FaMoon aria-hidden="true" />
                        )}
                        {theme === "dark" ? "Light" : "Dark"}
                    </button>

                    <nav className="site-links" aria-label="Profile links">
                        <a
                            href="https://www.linkedin.com/in/talhah-patelia-77250a196/"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="LinkedIn"
                        >
                            <FaLinkedin aria-hidden="true" />
                        </a>
                        <a
                            href="https://github.com/talhahpatelia"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="GitHub"
                        >
                            <FaGithub aria-hidden="true" />
                        </a>
                        <a
                            href="https://talhahpatelia.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Website"
                        >
                            <FaGlobe aria-hidden="true" />
                        </a>
                    </nav>
                </div>
            </header>

            <div className="workspace-grid">
                <section className="map-panel" aria-labelledby="map-heading">
                    <div className="panel-heading">
                        <div>
                            <p className="eyebrow">Interactive map</p>
                            <h2 id="map-heading">Schools by province</h2>
                        </div>

                        <div className="panel-actions">
                            {selectedProvince && (
                                <button
                                    className="ghost-button"
                                    type="button"
                                    onClick={() => setSelectedProvince("")}
                                >
                                    <FaTimes aria-hidden="true" />
                                    Clear province
                                </button>
                            )}
                            <button
                                className="ghost-button"
                                type="button"
                                onClick={() => fitProvince("")}
                            >
                                <FaLocationArrow aria-hidden="true" />
                                Reset map
                            </button>
                        </div>
                    </div>

                    <div className="map-shell">
                        <div
                            className="map-canvas"
                            ref={mapContainerRef}
                            aria-label="Interactive MapLibre map of IEB schools by province"
                        />
                        <div className="map-overlay">
                            <span>Focus</span>
                            <strong>
                                {activeProvince?.province || "All provinces"}
                            </strong>
                            <em>
                                {activeProvince
                                    ? pluralize(activeProvince.count, "school")
                                    : pluralize(schools.length, "school")}
                            </em>
                        </div>
                        <div className="legend" aria-hidden="true">
                            <span>Fewer</span>
                            <span className="legend-ramp" />
                            <span>More</span>
                        </div>
                    </div>

                    <div className="province-filter-list">
                        {provinceStats.map(({ province, count }) => (
                            <button
                                key={province}
                                className={
                                    selectedProvince === province
                                        ? "province-pill is-active"
                                        : "province-pill"
                                }
                                type="button"
                                onClick={() => toggleProvince(province)}
                            >
                                <span>{province}</span>
                                <strong>{numberFormatter.format(count)}</strong>
                            </button>
                        ))}
                    </div>
                </section>

                <DirectoryPanel
                    clearFilters={clearFilters}
                    query={query}
                    renderedSchools={renderedSchools}
                    selectedProvince={selectedProvince}
                    setQuery={setQuery}
                    setSortMode={setSortMode}
                    setVisibleLimit={setVisibleLimit}
                    sortMode={sortMode}
                    sortedSchools={sortedSchools}
                    visibleSchools={visibleSchools}
                />
            </div>

            <aside className="insights-panel" aria-labelledby="insights-heading">
                <div className="panel-heading">
                    <div>
                        <p className="eyebrow">Dashboard</p>
                        <h2 id="insights-heading">Provincial spread</h2>
                    </div>
                </div>

                <Suspense
                    fallback={
                        <div className="chart-skeleton">Loading chart</div>
                    }
                >
                    <ProvinceChart
                        data={provinceStats}
                        selectedProvince={selectedProvince}
                        theme={theme}
                        onSelect={toggleProvince}
                    />
                </Suspense>
            </aside>
        </main>
    );
}

function DirectoryPanel({
    clearFilters,
    query,
    renderedSchools,
    selectedProvince,
    setQuery,
    setSortMode,
    setVisibleLimit,
    sortMode,
    sortedSchools,
    visibleSchools,
}) {
    return (
        <section className="directory-panel" aria-labelledby="directory-heading">
            <div className="panel-heading">
                <div>
                    <p className="eyebrow">Directory</p>
                    <h2 id="directory-heading">Schools</h2>
                </div>
                {(selectedProvince || query) && (
                    <button
                        className="ghost-button"
                        type="button"
                        onClick={clearFilters}
                    >
                        <FaTimes aria-hidden="true" />
                        Clear filters
                    </button>
                )}
            </div>

            <div className="toolbar">
                <label className="search-field">
                    <FaSearch aria-hidden="true" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search school, area, province"
                        aria-label="Search schools"
                    />
                </label>

                <label className="sort-field">
                    <span>Sort</span>
                    <select
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value)}
                        aria-label="Sort schools"
                    >
                        <option value="name">Name</option>
                        <option value="province">Province</option>
                        <option value="year">Affiliation year</option>
                    </select>
                </label>
            </div>

            <div className="result-bar">
                <span>{pluralize(visibleSchools.length, "result")}</span>
                <span>{selectedProvince || "All provinces"}</span>
            </div>

            <div className="school-list" role="list">
                {renderedSchools.length ? (
                    renderedSchools.map((school) => (
                        <SchoolCard key={school.id} school={school} />
                    ))
                ) : (
                    <div className="empty-state">
                        <strong>No schools match this view</strong>
                        <p>Adjust the search or province filter.</p>
                    </div>
                )}
            </div>

            {renderedSchools.length < sortedSchools.length && (
                <button
                    className="load-more-button"
                    type="button"
                    onClick={() =>
                        setVisibleLimit((current) =>
                            Math.min(
                                current + LIST_BATCH_SIZE,
                                sortedSchools.length
                            )
                        )
                    }
                >
                    Load{" "}
                    {numberFormatter.format(
                        Math.min(
                            LIST_BATCH_SIZE,
                            sortedSchools.length - renderedSchools.length
                        )
                    )}{" "}
                    more
                </button>
            )}
        </section>
    );
}

const SchoolCard = memo(function SchoolCard({ school }) {
    return (
        <article className="school-card" role="listitem">
            <div className="school-card__header">
                <div>
                    <h3>{school.title}</h3>
                    <p>
                        <FaMapMarkerAlt aria-hidden="true" />
                        {[school.area, school.province]
                            .filter(Boolean)
                            .join(", ")}
                    </p>
                </div>

                {school.year && (
                    <span className="year-badge">Since {school.year}</span>
                )}
            </div>

            <div className="contact-grid">
                {school.telephone && (
                    <a href={`tel:${school.telephone.replace(/\s+/g, "")}`}>
                        <FaPhoneAlt aria-hidden="true" />
                        {school.telephone}
                    </a>
                )}
                {school.email && (
                    <a href={`mailto:${school.email}`}>
                        <FaEnvelope aria-hidden="true" />
                        {school.email}
                    </a>
                )}
                {school.website && (
                    <a
                        href={school.website}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <FaExternalLinkAlt aria-hidden="true" />
                        Website
                    </a>
                )}
            </div>
        </article>
    );
});
