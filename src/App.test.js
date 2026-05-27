import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("maplibre-gl", () => {
    class Map {
        addControl = jest.fn();
        addLayer = jest.fn();
        addSource = jest.fn();
        fitBounds = jest.fn();
        getCanvas = jest.fn(() => ({
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            style: {},
        }));
        getLayer = jest.fn(() => false);
        getSource = jest.fn(() => false);
        isStyleLoaded = jest.fn(() => true);
        off = jest.fn();
        on = jest.fn();
        remove = jest.fn();
        removeLayer = jest.fn();
        removeSource = jest.fn();
        setPaintProperty = jest.fn();
        setStyle = jest.fn();
    }

    class LngLatBounds {
        empty = true;
        extend() {
            this.empty = false;
            return this;
        }
        isEmpty() {
            return this.empty;
        }
    }

    class Popup {
        addTo() {
            return this;
        }
        remove() {
            return this;
        }
        setHTML() {
            return this;
        }
        setLngLat() {
            return this;
        }
    }

    return {
        __esModule: true,
        default: {
            AttributionControl: jest.fn(),
            LngLatBounds,
            Map,
            NavigationControl: jest.fn(),
            Popup,
            setWorkerCount: jest.fn(),
        },
    };
});

jest.mock("recharts", () => ({
    Bar: ({ children }) => <div>{children}</div>,
    BarChart: ({ children }) => <div>{children}</div>,
    CartesianGrid: () => null,
    Cell: () => null,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
}));

const schools = [
    {
        id: "school-1",
        data: {
            title: "Abbotts College Centurion",
            province: "Gauteng",
            area: "Centurion",
            telephone: "012 003 1389",
            emailAddress: "info@example.com",
            website: "example.com",
            yearOfAffiliation: "2023",
            _updatedDate: { $date: "2025-06-18T00:00:00.000Z" },
        },
    },
];

const provinces = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: {
                shapeName: "Gauteng",
            },
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [27.8, -26.5],
                        [28.7, -26.5],
                        [28.7, -25.6],
                        [27.8, -25.6],
                        [27.8, -26.5],
                    ],
                ],
            },
        },
    ],
};

beforeEach(() => {
    global.fetch = jest.fn((url) =>
        Promise.resolve({
            ok: true,
            json: () =>
                Promise.resolve(
                    url.toString().includes("schools.json")
                        ? schools
                        : provinces
                ),
        })
    );
});

afterEach(() => {
    jest.restoreAllMocks();
});

test("renders the IEB schools dashboard from local data", async () => {
    render(<App />);

    expect(screen.getByText(/loading school data/i)).toBeInTheDocument();

    expect(
        await screen.findByRole("heading", {
            name: /ieb schools in south africa/i,
        })
    ).toBeInTheDocument();
    expect(screen.getByText(/abbotts college centurion/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /gauteng/i }).length).toBeGreaterThan(
        0
    );
});
