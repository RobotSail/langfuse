import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import {
  orderBy,
  singleFilter,
  optionalPaginationZod,
  paginationZod,
} from "@langfuse/shared";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import {
  DashboardWidgetChartType,
  DashboardWidgetViews,
} from "@langfuse/shared/src/db";
import {
  DashboardService,
  DimensionSchema,
  MetricSchema,
  ChartConfigSchema,
  queryClickhouse,
  convertDateToClickhouseDateTime,
} from "@langfuse/shared/src/server";
import { views } from "@/src/features/query";
import { TRPCError } from "@trpc/server";
import { LangfuseConflictError } from "@langfuse/shared";

// Helper function to extract score-related filters and build WHERE conditions
function buildScoreFilterConditions(
  filters: z.infer<typeof singleFilter>[],
  view: DashboardWidgetViews,
): { whereClause: string; params: Record<string, any> } {
  const scoreFilters: string[] = [];
  const params: Record<string, any> = {};

  // Identify score-related column names based on view
  // These are viewName values, not uiTableName values
  const scoreNameColumns = ["name", "scoreName"];
  const scoreValueColumns = ["value"];
  const scoreStringValueColumns = ["stringValue"];

  filters.forEach((filter, index) => {
    // Handle score name filters
    if (scoreNameColumns.includes(filter.column)) {
      if (filter.type === "string" && filter.operator === "=") {
        scoreFilters.push(`name = {scoreName${index}: String}`);
        params[`scoreName${index}`] = filter.value;
      } else if (filter.type === "string" && filter.operator === "contains") {
        scoreFilters.push(`position(name, {scoreName${index}: String}) > 0`);
        params[`scoreName${index}`] = filter.value;
      } else if (
        filter.type === "string" &&
        filter.operator === "starts with"
      ) {
        scoreFilters.push(`startsWith(name, {scoreName${index}: String})`);
        params[`scoreName${index}`] = filter.value;
      } else if (
        filter.type === "stringOptions" &&
        filter.operator === "any of"
      ) {
        scoreFilters.push(`name IN ({scoreNames${index}: Array(String)})`);
        params[`scoreNames${index}`] = filter.value;
      }
    }

    // Handle numeric score value filters (for numeric scores)
    if (
      scoreValueColumns.includes(filter.column) &&
      view === DashboardWidgetViews.SCORES_NUMERIC
    ) {
      if (filter.type === "number") {
        switch (filter.operator) {
          case "=":
            scoreFilters.push(`value = {scoreValue${index}: Float64}`);
            params[`scoreValue${index}`] = filter.value;
            break;
          case ">":
            scoreFilters.push(`value > {scoreValue${index}: Float64}`);
            params[`scoreValue${index}`] = filter.value;
            break;
          case "<":
            scoreFilters.push(`value < {scoreValue${index}: Float64}`);
            params[`scoreValue${index}`] = filter.value;
            break;
          case ">=":
            scoreFilters.push(`value >= {scoreValue${index}: Float64}`);
            params[`scoreValue${index}`] = filter.value;
            break;
          case "<=":
            scoreFilters.push(`value <= {scoreValue${index}: Float64}`);
            params[`scoreValue${index}`] = filter.value;
            break;
        }
      }
    }

    // Handle categorical score value filters
    if (
      scoreStringValueColumns.includes(filter.column) &&
      view === DashboardWidgetViews.SCORES_CATEGORICAL
    ) {
      if (filter.type === "string" && filter.operator === "=") {
        scoreFilters.push(`string_value = {scoreStringValue${index}: String}`);
        params[`scoreStringValue${index}`] = filter.value;
      } else if (
        filter.type === "stringOptions" &&
        filter.operator === "any of"
      ) {
        scoreFilters.push(
          `string_value IN ({scoreStringValues${index}: Array(String)})`,
        );
        params[`scoreStringValues${index}`] = filter.value;
      }
    }
  });

  const whereClause =
    scoreFilters.length > 0 ? ` AND ${scoreFilters.join(" AND ")}` : "";
  return { whereClause, params };
}

const CreateDashboardWidgetInput = z.object({
  projectId: z.string(),
  name: z.string().min(1, "Widget name is required"),
  description: z.string(),
  view: views,
  dimensions: z.array(DimensionSchema),
  metrics: z.array(MetricSchema),
  filters: z.array(singleFilter),
  chartType: z.enum(DashboardWidgetChartType),
  chartConfig: ChartConfigSchema,
});

// Define update widget input schema (without projectId)
const UpdateDashboardWidgetInput = z.object({
  projectId: z.string(),
  widgetId: z.string(),
  name: z.string().min(1, "Widget name is required"),
  description: z.string(),
  view: views,
  dimensions: z.array(DimensionSchema),
  metrics: z.array(MetricSchema),
  filters: z.array(singleFilter),
  chartType: z.enum(DashboardWidgetChartType),
  chartConfig: ChartConfigSchema,
});

// Define the widget list input schema
const ListDashboardWidgetsInput = z.object({
  projectId: z.string(),
  ...optionalPaginationZod,
  orderBy: orderBy,
});

// Get widget by ID input schema
const GetDashboardWidgetInput = z.object({
  projectId: z.string(),
  widgetId: z.string(),
});

const viewMapping: Record<string, DashboardWidgetViews> = {
  traces: DashboardWidgetViews.TRACES,
  observations: DashboardWidgetViews.OBSERVATIONS,
  "scores-numeric": DashboardWidgetViews.SCORES_NUMERIC,
  "scores-categorical": DashboardWidgetViews.SCORES_CATEGORICAL,
};

// Reverse mapping for client-side use
const reverseViewMapping: Record<DashboardWidgetViews, string> = {
  [DashboardWidgetViews.TRACES]: "traces",
  [DashboardWidgetViews.OBSERVATIONS]: "observations",
  [DashboardWidgetViews.SCORES_NUMERIC]: "scores-numeric",
  [DashboardWidgetViews.SCORES_CATEGORICAL]: "scores-categorical",
};

export const dashboardWidgetRouter = createTRPCRouter({
  create: protectedProjectProcedure
    .input(CreateDashboardWidgetInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:CUD",
      });

      // Create the widget using the DashboardService
      const widget = await DashboardService.createWidget(
        input.projectId,
        { ...input, view: viewMapping[input.view] },
        ctx.session.user?.id,
      );

      return {
        success: true,
        widget,
      };
    }),

  all: protectedProjectProcedure
    .input(ListDashboardWidgetsInput)
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:read",
      });

      const result = await DashboardService.listWidgets({
        projectId: input.projectId,
        limit: input.limit,
        page: input.page,
        orderBy: input.orderBy,
      });

      return result;
    }),

  get: protectedProjectProcedure
    .input(GetDashboardWidgetInput)
    .query(async ({ ctx, input }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:read",
      });

      const widget = await DashboardService.getWidget(
        input.widgetId,
        input.projectId,
      );

      if (!widget) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Widget not found",
        });
      }

      return {
        ...widget,
        view: reverseViewMapping[widget.view],
        owner: widget.owner,
      };
    }),

  update: protectedProjectProcedure
    .input(UpdateDashboardWidgetInput)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:CUD",
      });

      // Update the widget using the DashboardService
      const widget = await DashboardService.updateWidget(
        input.projectId,
        input.widgetId,
        {
          name: input.name,
          description: input.description,
          view: viewMapping[input.view],
          dimensions: input.dimensions,
          metrics: input.metrics,
          filters: input.filters,
          chartType: input.chartType,
          chartConfig: input.chartConfig,
        },
        ctx.session.user?.id,
      );

      return {
        success: true,
        widget,
      };
    }),

  copyToProject: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        widgetId: z.string(),
        dashboardId: z.string(),
        placementId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:CUD",
      });

      const newWidgetId = await DashboardService.copyWidgetToProject({
        sourceWidgetId: input.widgetId,
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        placementId: input.placementId,
        userId: ctx.session.user?.id,
      });

      return { widgetId: newWidgetId };
    }),

  // Define delete widget input schema
  delete: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        widgetId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:CUD",
      });

      try {
        // Delete the widget using the DashboardService
        await DashboardService.deleteWidget(input.widgetId, input.projectId);

        return {
          success: true,
        };
      } catch (error) {
        // If the widget is still referenced in dashboards, throw a CONFLICT error
        if (error instanceof LangfuseConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error)?.message,
        });
      }
    }),

  // Get experiments (dataset runs) for a widget based on its filters
  getExperiments: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        widgetId: z.string(),
        fromTimestamp: z.string(),
        toTimestamp: z.string(),
        dashboardFilters: z.array(singleFilter).optional(),
        ...paginationZod,
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "dashboards:read",
      });

      // Get the widget configuration
      const widget = await DashboardService.getWidget(
        input.widgetId,
        input.projectId,
      );

      if (!widget) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Widget not found",
        });
      }

      // Build score filter conditions based on widget filters
      const { whereClause: scoreWhereClause, params: scoreFilterParams } =
        buildScoreFilterConditions(widget.filters, widget.view);

      console.log(`[getSessions] Widget: ${widget.name}`);
      console.log(
        `[getSessions] Widget filters:`,
        JSON.stringify(widget.filters),
      );
      console.log(`[getSessions] Score WHERE clause: ${scoreWhereClause}`);
      console.log(`[getSessions] Score filter params:`, scoreFilterParams);

      // Simple query: Get sessions with scores matching widget filters
      const sessionsQuery = `
        SELECT 
          session_id,
          COUNT(*) as score_count,
          MIN(timestamp) as first_score_time,
          MAX(timestamp) as last_score_time,
          AVG(CASE WHEN data_type = 'NUMERIC' THEN value END) as avg_numeric,
          SUM(CASE WHEN data_type = 'BOOLEAN' AND value = 1 THEN 1 ELSE 0 END) as pass_count,
          COUNT(CASE WHEN data_type = 'BOOLEAN' THEN 1 END) as boolean_count,
          argMax(string_value, timestamp) as latest_category_value
        FROM scores FINAL
        WHERE project_id = {projectId: String}
          AND session_id IS NOT NULL
          AND timestamp >= {fromTimestamp: DateTime64(3)}
          AND timestamp <= {toTimestamp: DateTime64(3)}
          AND is_deleted = 0
          ${scoreWhereClause}
        GROUP BY session_id
        ORDER BY score_count DESC
      `;

      const allSessions = await queryClickhouse<{
        session_id: string;
        score_count: string;
        first_score_time: string;
        last_score_time: string;
        avg_numeric: number | null;
        pass_count: string;
        boolean_count: string;
        latest_category_value: string | null;
      }>({
        query: sessionsQuery,
        params: {
          projectId: input.projectId,
          fromTimestamp: convertDateToClickhouseDateTime(
            new Date(input.fromTimestamp),
          ),
          toTimestamp: convertDateToClickhouseDateTime(
            new Date(input.toTimestamp),
          ),
          ...scoreFilterParams,
        },
      });

      const totalCount = allSessions.length;

      console.log(
        `[getSessions] Found ${totalCount} sessions with matching scores`,
      );

      if (totalCount === 0) {
        console.log(
          `[getSessions] No sessions found with matching scores - returning empty result`,
        );
        return {
          sessions: [],
          totalCount: 0,
        };
      }

      // Apply pagination
      const paginatedSessions = allSessions.slice(
        input.page * input.limit,
        (input.page + 1) * input.limit,
      );

      // Fetch session metadata from PostgreSQL
      const sessionIds = paginatedSessions.map((s) => s.session_id);
      const sessionsMetadata = await ctx.prisma.traceSession.findMany({
        where: {
          id: {
            in: sessionIds,
          },
          projectId: input.projectId,
        },
        select: {
          id: true,
          createdAt: true,
          bookmarked: true,
          environment: true,
        },
      });

      const sessionsMetadataMap = new Map(
        sessionsMetadata.map((s) => [s.id, s]),
      );

      // Calculate metrics for each session
      const sessionsWithMetrics = paginatedSessions.map((session) => {
        const metadata = sessionsMetadataMap.get(session.session_id);
        const scoreCount = parseInt(session.score_count);
        const passCount = parseInt(session.pass_count);
        const booleanCount = parseInt(session.boolean_count);

        // Calculate metric based on score type
        let metricValue: number | null = null;
        let metricType: "pass_rate" | "average" | "most_frequent" | null = null;
        let metricLabel: string | null = null;

        // Priority 1: Boolean scores (pass rate)
        if (booleanCount > 0) {
          metricValue = (passCount / booleanCount) * 100;
          metricType = "pass_rate";
        }
        // Priority 2: Numeric scores (average)
        else if (session.avg_numeric !== null) {
          metricValue = session.avg_numeric;
          metricType = "average";
        }
        // Priority 3: Categorical scores (most frequent)
        else if (session.latest_category_value) {
          metricType = "most_frequent";
          metricLabel = session.latest_category_value;
        }

        return {
          sessionId: session.session_id,
          scoreCount,
          firstScoreTime: new Date(session.first_score_time),
          lastScoreTime: new Date(session.last_score_time),
          metricValue,
          metricType,
          metricLabel,
          createdAt: metadata?.createdAt || new Date(session.first_score_time),
          bookmarked: metadata?.bookmarked ?? false,
          environment: metadata?.environment,
        };
      });

      return {
        sessions: sessionsWithMetrics,
        totalCount,
      };
    }),
});
