import React, { useMemo } from "react";
import { ChartContainer, ChartTooltip } from "@/src/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { type ChartProps } from "@/src/features/widgets/chart-library/chart-props";
import {
  getUniqueDimensions,
  groupDataByTimeDimension,
} from "@/src/features/widgets/chart-library/utils";

/**
 * VerticalBarChartTimeSeries component
 * @param data - Data to be displayed. Expects an array of objects with time_dimension, dimension, and metric properties.
 * @param config - Configuration object for the chart. Can include theme settings for light and dark modes.
 * @param accessibilityLayer - Boolean to enable or disable the accessibility layer. Default is true.
 */
export const VerticalBarChartTimeSeries: React.FC<ChartProps> = ({
  data,
  config = {
    metric: {
      theme: {
        light: "hsl(var(--chart-1))",
        dark: "hsl(var(--chart-1))",
      },
    },
  },
  accessibilityLayer = true,
}) => {
  // Check if this is raw/unaggregated data (dimension field is a timestamp or doesn't exist)
  const isRawData = useMemo(() => {
    if (data.length === 0) return false;
    const firstItem = data[0];
    // Raw data has dimension as a formatted timestamp string or no meaningful dimension
    return (
      !firstItem.dimension ||
      firstItem.dimension?.includes("/") ||
      firstItem.dimension?.includes(":")
    );
  }, [data]);

  const chartData = useMemo(() => {
    if (isRawData) {
      // For raw data: don't group, just sort by timestamp ascending (oldest to newest)
      return [...data].sort((a, b) => {
        const timeA = a.time_dimension
          ? new Date(a.time_dimension).getTime()
          : 0;
        const timeB = b.time_dimension
          ? new Date(b.time_dimension).getTime()
          : 0;
        return timeA - timeB;
      });
    } else {
      // For aggregated data: group by time and dimension
      return groupDataByTimeDimension(data);
    }
  }, [data, isRawData]);

  const dimensions = useMemo(() => {
    if (isRawData) {
      // For raw data, the metric field is the data key (e.g., "none_rawValue")
      return ["metric"];
    } else {
      return getUniqueDimensions(data);
    }
  }, [data, isRawData]);

  return (
    <ChartContainer config={config}>
      <BarChart accessibilityLayer={accessibilityLayer} data={chartData}>
        <XAxis
          dataKey="time_dimension"
          stroke="hsl(var(--chart-grid))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="number"
          stroke="hsl(var(--chart-grid))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        {dimensions.map((dimension, index) => (
          <Bar
            key={dimension}
            dataKey={dimension}
            stroke={`hsl(var(--chart-${(index % 4) + 1}))`}
            fill={`hsl(var(--chart-${(index % 4) + 1}))`}
            // Stack bars if there are multiple dimensions
            stackId={dimensions.length > 1 ? "stack" : undefined}
          />
        ))}
        <ChartTooltip
          contentStyle={{ backgroundColor: "hsl(var(--background))" }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;

            // Get the first payload item
            const data = payload[0];
            if (!data) return null;

            return (
              <div className="rounded-lg border bg-background p-2 shadow-sm">
                <div className="grid gap-2">
                  <div className="flex flex-col">
                    <span className="text-[0.70rem] uppercase text-muted-foreground">
                      Value
                    </span>
                    <span className="font-bold text-foreground">
                      {typeof data.value === "number"
                        ? data.value.toFixed(4)
                        : data.value}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[0.70rem] uppercase text-muted-foreground">
                      Session ID
                    </span>
                    <span className="font-mono text-xs">
                      {data.payload?.sessionId || "No Session attached"}
                    </span>
                  </div>
                  {data.payload?.time_dimension && (
                    <div className="flex flex-col">
                      <span className="text-[0.70rem] uppercase text-muted-foreground">
                        Timestamp
                      </span>
                      <span className="text-xs">
                        {data.payload.time_dimension}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        />
      </BarChart>
    </ChartContainer>
  );
};

export default VerticalBarChartTimeSeries;
