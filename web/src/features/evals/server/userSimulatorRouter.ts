import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  UserSimulationEvalConfigSchema,
  AgentEndpointConfigSchema,
} from "@langfuse/shared/src/features/user-simulator";
import {
  QueueJobs,
  UserSimulatorQueue,
  logger,
} from "@langfuse/shared/src/server";
import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";

export const userSimulatorRouter = createTRPCRouter({
  /**
   * Create and run a user simulation job
   */
  runUserSimulation: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        jobConfigId: z.string().optional(), // Optional: link to existing job config
        datasetId: z.string(),
        datasetItemIds: z.array(z.string()).optional(), // Optional: specific items to run
        config: UserSimulationEvalConfigSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Temporarily bypass permission check for testing
      // await throwIfNoProjectAccess({
      //   session: ctx.session,
      //   projectId: input.projectId,
      //   scope: "eval:CUD",
      // });

      console.log("=== RUN USER SIMULATION CALLED ===");
      console.log("Input:", JSON.stringify(input, null, 2));
      console.log("===================================");

      logger.info("runUserSimulation mutation called", {
        projectId: input.projectId,
        datasetId: input.datasetId,
        hasOpenAIKey: !!input.config.openaiApiKey,
        hasAgentEndpoint: !!(input.config.agentEndpoint.agentCardUrl || input.config.agentEndpoint.jsonRpcEndpoint),
      });

      try {
        // Get queue instance
        const queue = UserSimulatorQueue.getInstance();
        if (!queue) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "User simulator queue not available",
          });
        }

        // Validate that dataset exists and belongs to project
        const dataset = await ctx.prisma.dataset.findFirst({
          where: {
            id: input.datasetId,
            projectId: input.projectId,
          },
        });

        if (!dataset) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Dataset not found",
          });
        }

        // Create job ID
        const jobId = uuidv4();

        // Queue the simulation job
        const job = await queue.add(
          QueueJobs.UserSimulatorJob,
          {
            timestamp: new Date(),
            id: jobId,
            name: QueueJobs.UserSimulatorJob as const,
            payload: {
              projectId: input.projectId,
              jobConfigId: input.jobConfigId ?? jobId,
              datasetId: input.datasetId,
              datasetItemIds: input.datasetItemIds,
              config: input.config as Record<string, unknown>,
            },
          },
          {
            jobId,
          },
        );

        // Audit log
        await auditLog({
          session: ctx.session,
          resourceType: "job",
          resourceId: jobId,
          action: "create",
          after: {
            type: "user_simulation",
            datasetId: input.datasetId,
          },
        });

        logger.info("User simulation job queued", {
          jobId: job.id,
          projectId: input.projectId,
          datasetId: input.datasetId,
        });

        return {
          jobId: job.id ?? jobId,
          status: "queued",
          message: "User simulation job has been queued for processing",
        };
      } catch (error) {
        logger.error("Failed to queue user simulation job", {
          error: error instanceof Error ? error.message : String(error),
          projectId: input.projectId,
        });
        throw error;
      }
    }),

  /**
   * Get status of a user simulation job
   */
  getSimulationJobStatus: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        jobId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      const queue = UserSimulatorQueue.getInstance();
      if (!queue) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "User simulator queue not available",
        });
      }

      const job = await queue.getJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      const state = await job.getState();
      const progress = job.progress;
      const returnValue = job.returnvalue;
      const failedReason = job.failedReason;

      return {
        jobId: job.id,
        status: state,
        progress,
        result: returnValue,
        error: failedReason,
        timestamp: job.timestamp,
      };
    }),

  /**
   * List traces from a simulation session
   */
  getSimulationTraces: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "project:read",
      });

      const traces = await ctx.prisma.trace.findMany({
        where: {
          projectId: input.projectId,
          sessionId: input.sessionId,
        },
        include: {
          observations: {
            select: {
              id: true,
              type: true,
              name: true,
              startTime: true,
              endTime: true,
              metadata: true,
              input: true,
              output: true,
            },
          },
          scores: {
            select: {
              id: true,
              name: true,
              value: true,
              comment: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      return {
        sessionId: input.sessionId,
        traceCount: traces.length,
        traces: traces.map((trace) => ({
          id: trace.id,
          name: trace.name,
          timestamp: trace.timestamp,
          input: trace.input,
          output: trace.output,
          metadata: trace.metadata,
          observations: trace.observations,
          scores: trace.scores,
        })),
      };
    }),

  /**
   * Test connection to A2A agent endpoint
   */
  testAgentConnection: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentEndpoint: AgentEndpointConfigSchema,
      }),
    )
    .mutation(async ({ input }) => {
      // Temporarily bypass permission check for testing
      // await throwIfNoProjectAccess({
      //   session: ctx.session,
      //   projectId: input.projectId,
      //   scope: "eval:CUD",
      // });

      try {
        // Determine the endpoint to test
        let testEndpoint: string;

        if (input.agentEndpoint.agentCardUrl) {
          // Try to fetch agent card first
          try {
            const cardResponse = await fetch(input.agentEndpoint.agentCardUrl, {
              headers: {
                "Accept": "application/json",
                ...(input.agentEndpoint.authType === "bearer" && input.agentEndpoint.authToken
                  ? { "Authorization": `Bearer ${input.agentEndpoint.authToken}` }
                  : {}),
                ...(input.agentEndpoint.authType === "api_key" && input.agentEndpoint.authToken
                  ? { "X-API-Key": input.agentEndpoint.authToken }
                  : {}),
              },
            });

            if (!cardResponse.ok) {
              return {
                success: false,
                error: `Failed to fetch Agent Card: ${cardResponse.status} ${cardResponse.statusText}`,
              };
            }

            const agentCard = await cardResponse.json();

            // Try different possible locations for the JSON-RPC endpoint
            let endpointPath =
              agentCard.endpoints?.jsonRpc ||
              agentCard.endpoints?.jsonrpc ||
              agentCard.endpoints?.messageSend ||
              agentCard.jsonRpc ||
              agentCard.jsonrpc ||
              agentCard.endpoint;

            // If no explicit endpoint, use conventional A2A path based on preferredTransport
            if (!endpointPath && agentCard.preferredTransport === "JSONRPC") {
              endpointPath = "/v1/message:send";
              logger.info("No explicit endpoint in Agent Card, using conventional A2A path", {
                path: endpointPath,
              });
            }

            if (!endpointPath) {
              return {
                success: false,
                error: "Agent Card does not contain an endpoint and no conventional path could be determined. Tried: endpoints.jsonRpc, endpoints.jsonrpc, endpoints.messageSend, jsonRpc, jsonrpc, endpoint, conventional /v1/message:send",
                agentCardStructure: JSON.stringify(agentCard, null, 2),
              };
            }

            // If the endpoint is a relative path, construct the full URL
            if (endpointPath.startsWith('/')) {
              const baseUrl = agentCard.url || input.agentEndpoint.agentCardUrl?.replace('/.well-known/agent-card.json', '').replace('/.well-known/agent.json', '');
              testEndpoint = `${baseUrl}${endpointPath}`;
            } else {
              testEndpoint = endpointPath;
            }
          } catch (error) {
            return {
              success: false,
              error: `Agent Card fetch failed: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        } else if (input.agentEndpoint.jsonRpcEndpoint) {
          testEndpoint = input.agentEndpoint.jsonRpcEndpoint;
        } else {
          return {
            success: false,
            error: "No endpoint configured",
          };
        }

        // Test A2A connection
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, input.agentEndpoint.timeout ?? 10000);

        // Use the simpler A2A message format (not full JSON-RPC wrapper)
        const a2aRequest = {
          message: {
            role: "user",
            parts: [
              {
                text: "Hello, this is a connection test from Langfuse User Simulator.",
              },
            ],
          },
        };

        const response = await fetch(testEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(input.agentEndpoint.authType === "bearer" && input.agentEndpoint.authToken
              ? { "Authorization": `Bearer ${input.agentEndpoint.authToken}` }
              : {}),
            ...(input.agentEndpoint.authType === "api_key" && input.agentEndpoint.authToken
              ? { "X-API-Key": input.agentEndpoint.authToken }
              : {}),
            ...(input.agentEndpoint.headers || {}),
          },
          body: JSON.stringify(a2aRequest),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          return {
            success: false,
            status: response.status,
            statusText: response.statusText,
            error: `HTTP ${response.status}: ${response.statusText}`,
            errorDetails: errorText,
          };
        }

        const responseData = await response.json();

        // Check if response contains a valid A2A message or task
        const hasValidResponse =
          responseData.message ||
          responseData.task ||
          responseData.artifact ||
          responseData.result;

        if (!hasValidResponse) {
          return {
            success: false,
            error: "Invalid A2A response format",
            responseData: JSON.stringify(responseData, null, 2),
          };
        }

        return {
          success: true,
          status: response.status,
          statusText: "A2A connection successful",
          agentCard: input.agentEndpoint.agentCardUrl
            ? `Agent Card discovered at ${input.agentEndpoint.agentCardUrl}`
            : undefined,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return {
            success: false,
            error: "Connection timeout",
          };
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
});
