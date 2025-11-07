import React, { useMemo } from "react";
import { ChartContainer, ChartTooltip } from "@/src/components/ui/chart";
import { Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { type ChartProps } from "@/src/features/widgets/chart-library/chart-props";

/**
 * ScatterPlot component for displaying raw, non-aggregated data points
 * @param data - Array of data points with metrics and optional dimensions
 * @param config - Chart configuration for theming
 * @param accessibilityLayer - Enable accessibility features
 */
export const ScatterPlot: React.FC<ChartProps> = ({
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
  // Transform data for scatter plot - always use sequential x-axis
  const scatterData = useMemo(() => {
    return data.map((point, index) => {
      const metricValue =
        typeof point.metric === "number" ? point.metric : undefined;

      return {
        x: index + 1, // Always sequential
        y: metricValue,
        sessionId: point.sessionId, // Session ID from query results
        timestamp: point.time_dimension,
        index: index + 1,
      };
    });
  }, [data]);

  // Filter out points with undefined y values
  const validData = scatterData.filter((point) => point.y !== undefined);

  return (
    <ChartContainer config={config}>
      <ScatterChart
        accessibilityLayer={accessibilityLayer}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
      >
        <XAxis
          type="number"
          dataKey="x"
          name="Sequence"
          stroke="hsl(var(--chart-grid))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Value"
          stroke="hsl(var(--chart-grid))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <ZAxis range={[60, 60]} />
        <Scatter
          data={validData}
          fill="hsl(var(--chart-1))"
          fillOpacity={0.6}
        />
        <ChartTooltip
          contentStyle={{ backgroundColor: "hsl(var(--background))" }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;

            const data = payload[0]?.payload;
            if (!data) return null;

            return (
              <div className="rounded-lg border bg-background p-2 shadow-sm">
                <div className="grid gap-2">
                  <div className="flex flex-col">
                    <span className="text-[0.70rem] uppercase text-muted-foreground">
                      Sequence
                    </span>
                    <span className="font-bold">#{data.index}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[0.70rem] uppercase text-muted-foreground">
                      Value
                    </span>
                    <span className="font-bold text-foreground">
                      {typeof data.y === "number" ? data.y.toFixed(4) : "N/A"}
                    </span>
                  </div>
                  {data.sessionId && (
                    <div className="flex flex-col">
                      <span className="text-[0.70rem] uppercase text-muted-foreground">
                        Session ID
                      </span>
                      <span className="font-mono text-xs">
                        {data.sessionId}
                      </span>
                    </div>
                  )}
                  {data.timestamp && (
                    <div className="flex flex-col">
                      <span className="text-[0.70rem] uppercase text-muted-foreground">
                        Timestamp
                      </span>
                      <span className="text-xs">
                        {new Date(data.timestamp).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        />
      </ScatterChart>
    </ChartContainer>
  );
};

export default ScatterPlot;
