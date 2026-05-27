import fs from "node:fs/promises";
import path from "node:path";

const GOOGLE_PLACES_SEARCH_URL =
    "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_LEGACY_SEARCH_URL =
    "https://maps.googleapis.com/maps/api/place/textsearch/json";

const DEFAULT_INPUT = "public/schools.json";
const DEFAULT_OUTPUT = "public/schools-geocoded.json";
const DEFAULT_DELAY_MS = 250;
const DEFAULT_MAX_RESULTS = 1;
const DEFAULT_CACHE_DAYS = 30;
const DEFAULT_API_VERSION = "auto";

const SOUTH_AFRICA_RECTANGLE = {
    low: {
        latitude: -35.4,
        longitude: 16.2,
    },
    high: {
        latitude: -21.8,
        longitude: 33.3,
    },
};

function readArg(name, fallback = "") {
    const prefix = `--${name}=`;
    const value = process.argv.find((arg) => arg.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value = "") {
    return value
        .toString()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, " ")
        .replace(/[-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function dataFor(entry) {
    return entry?.data || entry || {};
}

function buildQuery(entry) {
    const data = dataFor(entry);
    return [
        data.title,
        data.area,
        data.province,
        data.country || "South Africa",
    ]
        .filter(Boolean)
        .join(", ");
}

function choosePlace(entry, places = []) {
    if (!places.length) return null;

    const data = dataFor(entry);
    const title = normalizeText(data.title);
    const area = normalizeText(data.area);
    const province = normalizeText(data.province);

    const scored = places.map((place) => {
        const name = normalizeText(place.displayName?.text);
        const address = normalizeText(place.formattedAddress);
        const haystack = `${name} ${address}`;
        let score = 0;

        if (name && (title.includes(name) || name.includes(title))) score += 5;
        for (const token of title.split(" ").filter((part) => part.length > 3)) {
            if (haystack.includes(token)) score += 1;
        }
        if (area && haystack.includes(area)) score += 3;
        if (province && haystack.includes(province)) score += 2;
        if (haystack.includes("south africa")) score += 3;

        return { place, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0];
}

function normalizeLegacyPlaces(results = []) {
    return results.map((place) => ({
        id: place.place_id || "",
        displayName: {
            text: place.name || "",
        },
        formattedAddress: place.formatted_address || "",
        googleMapsUri: place.place_id
            ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
            : "",
        location: {
            latitude: place.geometry?.location?.lat ?? null,
            longitude: place.geometry?.location?.lng ?? null,
        },
        types: place.types || [],
        source: "google_places_legacy_text_search",
    }));
}

async function searchPlaceNew({ apiKey, query, maxResults, retryCount = 0 }) {
    const response = await fetch(GOOGLE_PLACES_SEARCH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.types",
        },
        body: JSON.stringify({
            textQuery: query,
            regionCode: "ZA",
            languageCode: "en",
            maxResultCount: maxResults,
            locationRestriction: {
                rectangle: SOUTH_AFRICA_RECTANGLE,
            },
        }),
    });

    if (response.status === 429 && retryCount < 4) {
        const backoffMs = 1000 * 2 ** retryCount;
        await sleep(backoffMs);
        return searchPlaceNew({
            apiKey,
            query,
            maxResults,
            retryCount: retryCount + 1,
        });
    }

    if (!response.ok) {
        const body = await response.text();
        const error = new Error(
            `Places API failed (${response.status}) for "${query}": ${body}`
        );
        error.status = response.status;
        error.body = body;
        throw error;
    }

    const payload = await response.json();
    return {
        places: (payload.places || []).map((place) => ({
            ...place,
            source: "google_places_text_search",
        })),
    };
}

async function searchPlaceLegacy({ apiKey, query, maxResults, retryCount = 0 }) {
    const params = new URLSearchParams({
        query,
        region: "za",
        key: apiKey,
    });

    const response = await fetch(
        `${GOOGLE_PLACES_LEGACY_SEARCH_URL}?${params.toString()}`
    );

    if (response.status === 429 && retryCount < 4) {
        const backoffMs = 1000 * 2 ** retryCount;
        await sleep(backoffMs);
        return searchPlaceLegacy({
            apiKey,
            query,
            maxResults,
            retryCount: retryCount + 1,
        });
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `Places API failed (${response.status}) for "${query}": ${body}`
        );
    }

    const payload = await response.json();

    if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
        throw new Error(
            `Places API failed (${payload.status}) for "${query}": ${payload.error_message || "No error message"}`
        );
    }

    return {
        places: normalizeLegacyPlaces(payload.results || []).slice(
            0,
            maxResults
        ),
    };
}

async function searchPlace({ apiKey, query, maxResults, apiVersion }) {
    if (apiVersion === "legacy") {
        return searchPlaceLegacy({ apiKey, query, maxResults });
    }

    if (apiVersion === "new") {
        return searchPlaceNew({ apiKey, query, maxResults });
    }

    try {
        return await searchPlaceNew({ apiKey, query, maxResults });
    } catch (error) {
        if (
            error.status === 403 &&
            error.body?.includes("API_KEY_SERVICE_BLOCKED")
        ) {
            return searchPlaceLegacy({ apiKey, query, maxResults });
        }
        throw error;
    }
}

function enrichEntry(entry, match, query, cacheDays) {
    const place = match?.place;
    const location = place?.location;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + cacheDays * 24 * 60 * 60 * 1000);

    const enrichment = {
        source: place?.source || "google_places_text_search",
        query,
        placeId: place?.id || "",
        matchedName: place?.displayName?.text || "",
        formattedAddress: place?.formattedAddress || "",
        googleMapsUri: place?.googleMapsUri || "",
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        matchScore: match?.score ?? 0,
        needsReview: (match?.score ?? 0) < 7,
        geocodedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
    };

    if (entry?.data) {
        return {
            ...entry,
            data: {
                ...entry.data,
                location: enrichment,
            },
        };
    }

    return {
        ...entry,
        location: enrichment,
    };
}

async function main() {
    const apiKey =
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.GOOGLE_PLACES_API_KEY ||
        process.env.PLACES_API_KEY;

    if (!apiKey) {
        throw new Error(
            "Missing Places API key. Set GOOGLE_MAPS_API_KEY, GOOGLE_PLACES_API_KEY, or PLACES_API_KEY."
        );
    }

    const inputPath = readArg("input", DEFAULT_INPUT);
    const outputPath = readArg("output", DEFAULT_OUTPUT);
    const delayMs = Number(readArg("delay-ms", DEFAULT_DELAY_MS));
    const maxResults = Number(readArg("max-results", DEFAULT_MAX_RESULTS));
    const limit = Number(readArg("limit", 0));
    const cacheDays = Number(readArg("cache-days", DEFAULT_CACHE_DAYS));
    const apiVersion = readArg("api-version", DEFAULT_API_VERSION);
    const resume = hasFlag("resume");

    const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
    const existingById = new Map();

    if (resume) {
        try {
            const existing = JSON.parse(await fs.readFile(outputPath, "utf8"));
            for (const entry of existing) {
                const data = dataFor(entry);
                const id = entry?.id || data._id;
                if (id && data.location?.latitude && data.location?.longitude) {
                    existingById.set(id, entry);
                }
            }
        } catch {
            // No existing output to resume from.
        }
    }

    const output = [];
    const candidates = limit > 0 ? input.slice(0, limit) : input;

    for (let index = 0; index < candidates.length; index += 1) {
        const entry = candidates[index];
        const data = dataFor(entry);
        const id = entry?.id || data._id;
        const existing = existingById.get(id);

        if (existing) {
            output.push(existing);
            console.log(
                `[${index + 1}/${candidates.length}] skipped ${data.title}`
            );
            continue;
        }

        const query = buildQuery(entry);
        console.log(`[${index + 1}/${candidates.length}] ${query}`);

        const result = await searchPlace({
            apiKey,
            query,
            maxResults,
            apiVersion,
        });
        const match = choosePlace(entry, result.places || []);

        output.push(enrichEntry(entry, match, query, cacheDays));

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

        if (delayMs > 0) await sleep(delayMs);
    }

    if (limit > 0 && input.length > limit) {
        output.push(...input.slice(limit));
    }

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`Saved ${output.length} schools to ${outputPath}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
