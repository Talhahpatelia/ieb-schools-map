import React from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const CHOROPLETH_COLORS = [
    "#d9eee8",
    "#8ed0c0",
    "#23a58f",
    "#f5b33f",
    "#f06445",
];

const numberFormatter = new Intl.NumberFormat("en-ZA");

function pluralize(count, word) {
    return `${numberFormatter.format(count)} ${word}${count === 1 ? "" : "s"}`;
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

export default function ProvinceChart({
    data,
    selectedProvince,
    theme,
    onSelect,
}) {
    const textColor = theme === "dark" ? "#dfe9e5" : "#40514b";
    const gridColor = theme === "dark" ? "#283936" : "#dce6e1";

    return (
        <div className="chart-box">
            <ResponsiveContainer width="100%" height={330}>
                <BarChart
                    data={data}
                    layout="vertical"
                    margin={{ top: 4, right: 22, bottom: 4, left: 88 }}
                    barCategoryGap={8}
                >
                    <CartesianGrid
                        stroke={gridColor}
                        strokeDasharray="3 3"
                        horizontal={false}
                    />
                    <XAxis
                        type="number"
                        tick={{ fill: textColor, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        type="category"
                        dataKey="province"
                        width={116}
                        tick={{ fill: textColor, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: "rgba(245, 179, 63, 0.12)" }}
                        content={<ChartTooltip />}
                    />
                    <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        onClick={(item) => onSelect(item.province)}
                    >
                        {data.map((entry) => (
                            <Cell
                                key={entry.province}
                                fill={
                                    selectedProvince === entry.province
                                        ? "#f5b33f"
                                        : colorForCount(
                                              entry.count,
                                              data[0]?.count || 1
                                          )
                                }
                                cursor="pointer"
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function ChartTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;
    const item = payload[0].payload;

    return (
        <div className="chart-tooltip">
            <strong>{item.province}</strong>
            <span>{pluralize(item.count, "school")}</span>
        </div>
    );
}
