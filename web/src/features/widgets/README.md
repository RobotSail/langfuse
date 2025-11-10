# Widgets Feature

This directory contains the widget system for Langfuse dashboards, allowing users to create customizable data visualizations and analytics.

## Architecture

### Core Components

- **`components/WidgetForm.tsx`** - Main widget creation/editing form with metric, dimension, and chart type selection
- **`components/DashboardWidget.tsx`** - Widget display component with data fetching and rendering
- **`components/SelectWidgetDialog.tsx`** - Dialog for adding existing widgets to dashboards
- **`chart-library/`** - Chart implementations (Scatter Plot, Line Chart, Bar Charts, Pie Chart, etc.)
- **`utils/`** - Helper functions for widget configuration and data formatting

### Data Flow

1. User configures widget in `WidgetForm` (view, metrics, dimensions, filters, chart type)
2. Configuration saved to database via tRPC mutation
3. `DashboardWidget` fetches data using the configuration
4. Data processed and passed to appropriate chart component
5. Chart renders visualization

## Raw vs Aggregated Data

Widgets support two modes for displaying data:

### Aggregated Data (Default)

Aggregated data groups and summarizes data points using functions like count, sum, average, min, max, etc.

**Use Cases:**
- Time-series trends (e.g., traces per day)
- Categorical breakdowns (e.g., average latency by model)
- Summary statistics (e.g., total cost)

**Available Chart Types:**
- Line Chart (time-series)
- Vertical/Horizontal Bar Charts (time-series and total-value)
- Pie Chart
- Big Number
- Histogram
- Pivot Table

**Example Configuration:**
```typescript
{
  view: "traces",
  metrics: [{ measure: "latency", agg: "avg" }],
  dimensions: [{ field: "model" }],
  chartType: "HORIZONTAL_BAR"
}
```

### Raw/Unaggregated Data

Raw data displays individual data points without aggregation (aggregation type: `none`).

**Use Cases:**
- Scatter plots showing individual score values
- Detailed inspection of specific data points
- Distribution analysis of raw values

**Available Measures:**
- `rawValue` - Numeric score values (from Scores Numeric view)
- `rawStringValue` - Categorical score values (from Scores Categorical view)

**Available Chart Types:**
- **Scatter Plot** (recommended) - Best for visualizing individual points
- **Vertical Bar Chart** (total-value only) - Shows individual values as bars
- **Big Number** - Displays a single raw value

**Important Limitations:**
- ⚠️ **Filtering is strongly recommended** - Raw data can return large volumes of individual data points, which may impact performance
- Time-series charts are NOT available for raw data
- Line charts require time-bucketed aggregation

**Example Configuration:**
```typescript
{
  view: "scores_numeric",
  metrics: [{ measure: "rawValue", agg: "none" }],
  filters: [{ column: "name", operator: "=", value: "helpfulness" }],
  chartType: "SCATTER_PLOT"
}
```

## Chart Type Capabilities Matrix

| Chart Type | Group | Supports Breakdown | Supports Raw Data | Best For |
|------------|-------|-------------------|-------------------|----------|
| Big Number | total-value | No | Yes | Single KPI display |
| Line Chart | time-series | Yes | No | Time-series trends |
| Vertical Bar (Time Series) | time-series | Yes | No | Time-series comparisons |
| Vertical Bar (Total Value) | total-value | Yes | Yes | Categorical comparisons |
| Horizontal Bar | total-value | Yes | No | Ranked categories |
| Pie Chart | total-value | No | No | Part-to-whole relationships |
| Scatter Plot | total-value | No | Yes | Individual data points, correlations |
| Histogram | total-value | No | No | Value distribution |
| Pivot Table | total-value | Yes | No | Multi-dimensional analysis |

## Creating Non-Aggregated Widgets

Follow these steps to create a widget with raw/unaggregated data:

### 1. Select View
Choose a view that supports raw data:
- **Scores Numeric** - For numeric score values
- **Scores Categorical** - For categorical score values

### 2. Select Metric
Choose the raw value metric:
- **Raw Value** (for numeric scores)
- **Raw String Value** (for categorical scores)

The aggregation is automatically set to "none" when you select a raw measure.

### 3. Add Filters (Strongly Recommended)
Due to the high volume of data in Langfuse, filtering is essential:

**Recommended Filter:**
- Column: `Score Name`
- Operator: `=` (equals)
- Value: Name of the specific score metric (e.g., `helpfulness`, `accuracy`, `relevance`)

**Additional Filters:**
- Time range (to limit data volume)
- User ID, trace ID, or other dimensions

### 4. Select Chart Type
Available chart types for raw data:
- **Scatter Plot** (recommended) - Visualizes individual data points over time
- **Vertical Bar Chart** - Shows individual values as bars
- **Big Number** - Displays a single raw value

### 5. Configure Display Options
- Widget name and description
- Date range
- Additional filters as needed

## Chart Type Filtering Logic

The form automatically filters available chart types based on the selected aggregation:

```typescript
function getCompatibleChartTypes(
  chartTypes: ChartType[],
  isRawData: boolean,
): ChartType[] {
  return chartTypes.filter((chart) => {
    if (isRawData) {
      return chart.supportsRawData;
    }
    return true;
  });
}
```

When a user selects a raw measure (`rawValue` or `rawStringValue`), the form:
1. Automatically sets aggregation to "none"
2. Filters chart types to only show those with `supportsRawData: true`
3. Auto-switches chart type to Scatter Plot if current chart doesn't support raw data

## Best Practices

### For Raw Data Widgets
1. **Always filter by Score Name** - Prevents overwhelming data volumes
2. **Use Scatter Plot** - Best visualization for raw data points
3. **Set appropriate date ranges** - Limit data to relevant time periods
4. **Consider performance** - Raw data queries can be resource-intensive

### For Aggregated Data Widgets
1. **Choose appropriate aggregation** - Match aggregation to your metric (avg for latency, sum for cost, etc.)
2. **Use breakdowns effectively** - Add dimensions to show comparisons
3. **Select chart type based on data structure**:
   - Time-series → Line or Bar (Time Series)
   - Categories → Horizontal Bar or Pie
   - Single value → Big Number
   - Distribution → Histogram
   - Multi-dimensional → Pivot Table

### General Widget Guidelines
1. **Name widgets descriptively** - Makes dashboards easier to understand
2. **Add descriptions** - Explain what the widget shows and why it's useful
3. **Use consistent time ranges** - Easier to compare widgets on same dashboard
4. **Test with filters** - Verify widget shows expected data

## Development Notes

### Adding New Chart Types

1. Create chart component in `chart-library/`
2. Add chart type to `DashboardWidgetChartType` enum in schema
3. Update `chartTypes` array in `WidgetForm.tsx` with:
   - `group`: "time-series" or "total-value"
   - `supportsBreakdown`: whether chart can show multiple series
   - `supportsRawData`: whether chart can display unaggregated data
4. Implement chart rendering in `Chart.tsx`
5. Add tests

### Modifying Chart Type Support

To change whether a chart type supports raw data, update the `supportsRawData` flag in `WidgetForm.tsx`:

```typescript
{
  group: "total-value",
  name: "My Chart",
  value: "MY_CHART",
  icon: MyIcon,
  supportsBreakdown: true,
  supportsRawData: false, // true if chart can handle raw data
}
```

## Related Documentation

- **Query System**: `/web/src/features/query/` - View definitions and data model
- **Dashboard System**: `/web/src/features/dashboards/` - Dashboard management
- **tRPC Routers**: `/web/src/server/api/routers/dashboardWidgets.ts` - API endpoints
- **Database Schema**: `/packages/shared/prisma/schema.prisma` - Widget data model
