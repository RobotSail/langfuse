import { useRouter } from "next/router";
import { api } from "@/src/utils/api";
import Page from "@/src/components/layouts/page";
import { useState } from "react";
import { DataTable } from "@/src/components/table/data-table";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { DataTableToolbar } from "@/src/components/table/data-table-toolbar";
import { useQueryParams, NumberParam, withDefault } from "use-query-params";
import { useRowHeightLocalStorage } from "@/src/components/table/data-table-row-height-switch";
import TableLink from "@/src/components/table/table-link";
import { type RouterOutput } from "@/src/utils/types";

type SessionRow =
  RouterOutput["dashboardWidgets"]["getSessions"]["sessions"][number];

export default function WidgetSessionsPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const widgetId = router.query.widgetId as string;
  const dashboardId = router.query.dashboardId as string | undefined;

  const [paginationState, setPaginationState] = useQueryParams({
    pageIndex: withDefault(NumberParam, 0),
    pageSize: withDefault(NumberParam, 50),
  });

  const [rowHeight, setRowHeight] = useRowHeightLocalStorage(
    "widget-sessions",
    "s",
  );

  // Get date range from dashboard or default to last 7 days
  const [dateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });

  const widget = api.dashboardWidgets.get.useQuery(
    {
      widgetId,
      projectId,
    },
    {
      enabled: Boolean(widgetId) && Boolean(projectId),
    },
  );

  const sessions = api.dashboardWidgets.getSessions.useQuery(
    {
      projectId,
      widgetId,
      fromTimestamp: dateRange.from.toISOString(),
      toTimestamp: dateRange.to.toISOString(),
      page: paginationState.pageIndex,
      limit: paginationState.pageSize,
    },
    {
      enabled: Boolean(widgetId) && Boolean(projectId),
    },
  );

  const columns: LangfuseColumnDef<SessionRow>[] = [
    {
      accessorKey: "sessionId",
      header: "Session ID",
      id: "sessionId",
      size: 200,
      cell: ({ row }) => {
        return (
          <TableLink
            path={`/project/${projectId}/sessions/${row.original.sessionId}`}
            value={row.original.sessionId}
            truncateAt={20}
          />
        );
      },
    },
    {
      accessorKey: "scoreCount",
      header: "Scores",
      id: "scoreCount",
      size: 80,
      cell: ({ row }) => {
        return <span className="font-mono">{row.original.scoreCount}</span>;
      },
    },
    {
      accessorKey: "metricValue",
      header: "Metric",
      id: "metric",
      size: 150,
      cell: ({ row }) => {
        const metricValue = row.original.metricValue;
        const metricType = row.original.metricType;
        const metricLabel = row.original.metricLabel;

        if (
          metricValue === null ||
          metricValue === undefined ||
          metricType === null ||
          metricType === undefined
        ) {
          return <span className="text-muted-foreground">—</span>;
        }

        if (metricType === "pass_rate") {
          return (
            <div className="flex flex-col">
              <span className="font-mono font-semibold">
                {metricValue.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">Pass Rate</span>
            </div>
          );
        } else if (metricType === "average") {
          return (
            <div className="flex flex-col">
              <span className="font-mono font-semibold">
                {metricValue.toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">Avg Score</span>
            </div>
          );
        } else if (metricType === "most_frequent") {
          return (
            <div className="flex flex-col">
              <span
                className="truncate font-semibold"
                title={metricLabel ?? ""}
              >
                {metricLabel}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {metricValue ? `${metricValue.toFixed(1)}%` : ""}
              </span>
            </div>
          );
        }

        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: "firstScoreTime",
      header: "First Score",
      id: "firstScoreTime",
      size: 150,
      cell: ({ row }) => {
        return <span>{new Date(row.original.firstScoreTime).toLocaleString()}</span>;
      },
    },
    {
      accessorKey: "createdAt",
      header: "Session Created",
      id: "createdAt",
      size: 150,
      cell: ({ row }) => {
        return <span>{new Date(row.original.createdAt).toLocaleString()}</span>;
      },
    },
  ];

  if (!projectId || !widgetId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Invalid parameters</p>
      </div>
    );
  }

  return (
    <Page
      headerProps={{
        title: `Sessions: ${widget.data?.name ?? "Loading..."}`,
        breadcrumb: dashboardId
          ? [
              { name: "Dashboards", href: `/project/${projectId}/dashboards` },
              {
                name: "Dashboard",
                href: `/project/${projectId}/dashboards/${dashboardId}`,
              },
            ]
          : undefined,
        help: {
          description:
            "View all sessions with scores captured by this widget's filters",
        },
      }}
    >
      <div className="flex flex-col gap-4">
        {widget.data && (
          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="font-semibold">{widget.data.name}</h3>
            <p className="text-sm text-muted-foreground">
              {widget.data.description}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Time range: {dateRange.from.toLocaleDateString()} -{" "}
              {dateRange.to.toLocaleDateString()}
            </p>
          </div>
        )}
        <DataTableToolbar
          columns={columns}
          rowHeight={rowHeight}
          setRowHeight={setRowHeight}
        />
        <DataTable
          tableName="widget-sessions"
          columns={columns}
          data={
            sessions.isLoading
              ? { isLoading: true, isError: false }
              : sessions.isError
                ? { isLoading: false, isError: true, error: sessions.error.message }
                : {
                    isLoading: false,
                    isError: false,
                    data: sessions.data?.sessions ?? [],
                  }
          }
          pagination={{
            totalCount: sessions.data?.totalCount ?? null,
            onChange: setPaginationState,
            state: paginationState,
          }}
          rowHeight={rowHeight}
        />
      </div>
    </Page>
  );
}


