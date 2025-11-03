import { Job } from "bullmq";
import {
  QueueName,
  TQueueJobTypes,
  logger,
  traceException,
} from "@langfuse/shared/src/server";
import { prisma } from "@langfuse/shared/src/db";
import {
  UserSimulationEvalConfigSchema,
  UserSimulatorDatasetItemSchema,
  type UserSimulatorScenario,
  type SuccessCriteria,
  type ConversationResult,
} from "@langfuse/shared/src/features/user-simulator";
import { UserSimulatorService } from "../features/user-simulator/userSimulatorService";

export const userSimulatorQueueProcessor = async (
  job: Job<TQueueJobTypes[QueueName.UserSimulatorQueue]>,
) => {
  try {
    logger.info("Processing user simulator job", {
      jobId: job.id,
      projectId: job.data.payload.projectId,
      datasetId: job.data.payload.datasetId,
    });

    const { projectId, jobConfigId, datasetId, datasetItemIds, config } =
      job.data.payload;

    // Parse and validate config
    const parsedConfig = UserSimulationEvalConfigSchema.parse(config);

    // Fetch dataset items to simulate
    const whereClause: {
      datasetId: string;
      projectId: string;
      status: "ACTIVE";
      id?: { in: string[] };
    } = {
      datasetId,
      projectId,
      status: "ACTIVE",
    };

    if (datasetItemIds && datasetItemIds.length > 0) {
      whereClause.id = { in: datasetItemIds };
    }

    const datasetItems = await prisma.datasetItem.findMany({
      where: whereClause,
      include: {
        dataset: true,
      },
    });

    if (datasetItems.length === 0) {
      logger.warn("No dataset items found for user simulation", {
        datasetId,
        datasetItemIds,
      });
      return {
        success: true,
        message: "No dataset items to process",
        simulationsRun: 0,
      };
    }

    logger.info(`Found ${datasetItems.length} dataset items to simulate`, {
      datasetId,
      projectId,
    });

    // Initialize user simulator service
    const simulator = new UserSimulatorService(
      parsedConfig.openaiApiKey,
      parsedConfig.agentEndpoint,
      parsedConfig.modelConfig,
    );

    // Test connections before running simulations
    const connectionTest = await simulator.testConnections();
    if (!connectionTest.openai || !connectionTest.agent) {
      logger.error("Connection test failed", {
        errors: connectionTest.errors,
      });
      throw new Error(
        `Connection test failed: ${connectionTest.errors.join(", ")}`,
      );
    }

    logger.info("Connection tests passed, starting simulations");

    const results: Array<{
      datasetItemId: string;
      result: ConversationResult;
    }> = [];

    // Run simulations for each dataset item
    for (const datasetItem of datasetItems) {
      try {
        console.log("=== PROCESSING DATASET ITEM ===");
        console.log("Dataset item ID:", datasetItem.id);
        console.log("Dataset item input:", JSON.stringify(datasetItem.input, null, 2));
        console.log("Dataset item expectedOutput:", JSON.stringify(datasetItem.expectedOutput, null, 2));
        console.log("Dataset item metadata:", JSON.stringify(datasetItem.metadata, null, 2));
        console.log("===============================");

        // Handle the case where dataset item has nested structure
        // The input field might contain { input: {...}, expectedOutput: {...} }
        // instead of just the scenario data
        let itemToParse: {
          input: any;
          expectedOutput: any;
          metadata: any;
        };

        if (
          datasetItem.input &&
          typeof datasetItem.input === "object" &&
          "input" in datasetItem.input &&
          "expectedOutput" in datasetItem.input
        ) {
          // Dataset item has nested structure: input.input, input.expectedOutput
          console.log("Detected nested dataset structure, unwrapping...");
          itemToParse = {
            input: (datasetItem.input as any).input,
            expectedOutput: (datasetItem.input as any).expectedOutput || datasetItem.expectedOutput,
            metadata: datasetItem.metadata || {},
          };
        } else {
          // Dataset item has flat structure: input, expectedOutput
          itemToParse = {
            input: datasetItem.input,
            expectedOutput: datasetItem.expectedOutput,
            metadata: datasetItem.metadata || {},
          };
        }

        console.log("Item to parse:", JSON.stringify(itemToParse, null, 2));

        // Parse dataset item
        const parsedItem = UserSimulatorDatasetItemSchema.parse(itemToParse);

        const scenario: UserSimulatorScenario = parsedItem.input;
        const successCriteria: SuccessCriteria = parsedItem.expectedOutput ?? {
          maxTurns: 10,
        };

        logger.info("Running simulation for dataset item", {
          datasetItemId: datasetItem.id,
          scenario: scenario.scenarioName,
        });

        // Run the simulation
        const result = await simulator.runSimulation(
          scenario,
          successCriteria,
          parsedConfig.terminationConditions,
          {
            datasetId,
            datasetItemId: datasetItem.id,
            jobConfigId,
            projectId,
          },
        );

        results.push({
          datasetItemId: datasetItem.id,
          result,
        });

        logger.info("Simulation completed", {
          datasetItemId: datasetItem.id,
          sessionId: result.sessionId,
          turns: result.turnCount,
          terminationReason: result.terminationReason,
        });
      } catch (error) {
        logger.error("Simulation failed for dataset item", {
          datasetItemId: datasetItem.id,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          errorDetails: error,
        });
        console.error("=== SIMULATION ERROR DETAILS ===");
        console.error("Dataset item ID:", datasetItem.id);
        console.error("Dataset item input:", JSON.stringify(datasetItem.input, null, 2));
        console.error("Dataset item expectedOutput:", JSON.stringify(datasetItem.expectedOutput, null, 2));
        console.error("Error:", error);
        console.error("================================");
        traceException(error);
        // Continue with next item
      }
    }

    // Wait for traces to be ingested
    logger.info("Waiting for traces to be ingested...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Session IDs for trace lookup (via userSimulatorRouter.getSimulationTraces)
    const sessionIds = results.map((r) => r.result.sessionId);
    logger.info("Simulations completed - traces can be queried by session IDs", {
      sessionIds,
    });

    // If eval template is configured, trigger evals on the traces
    if (parsedConfig.evalTemplateId) {
      logger.info("Eval template configured for simulation traces", {
        evalTemplateId: parsedConfig.evalTemplateId,
        sessionIds,
      });

      // TODO: Integrate with eval system to run evals on traces
      // Use userSimulatorRouter.getSimulationTraces to fetch traces by sessionId
      // then createEvalJobs to trigger evaluations
      logger.warn(
        "Eval template integration not yet implemented - traces created but not evaluated",
      );
    }

    logger.info("User simulation job completed successfully", {
      jobId: job.id,
      simulationsRun: results.length,
      sessionIds,
      successfulSimulations: results.filter(
        (r) => r.result.terminationReason !== "error",
      ).length,
    });

    return {
      success: true,
      simulationsRun: results.length,
      sessionIds,
      results: results.map((r) => ({
        datasetItemId: r.datasetItemId,
        sessionId: r.result.sessionId,
        turns: r.result.turnCount,
        terminationReason: r.result.terminationReason,
      })),
    };
  } catch (error) {
    logger.error("User simulator job failed", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    traceException(error);
    throw error;
  }
};
