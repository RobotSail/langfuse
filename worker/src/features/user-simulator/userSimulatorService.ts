import OpenAI from "openai";
import {
  type ConversationResult,
  type UserSimulatorScenario,
  type SuccessCriteria,
  type ModelConfig,
  type AgentEndpointConfig,
  type TerminationConditions,
} from "@langfuse/shared/src/features/user-simulator";
import { logger } from "@langfuse/shared/src/server";
import { A2AClient, A2AClientError } from "./a2aClient";
import { ConversationManager } from "./conversationManager";

export class UserSimulatorServiceError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "UserSimulatorServiceError";
  }
}

/**
 * Orchestrates user simulations using OpenAI (for simulator) and A2A protocol (for agent)
 */
export class UserSimulatorService {
  private openaiClient: OpenAI;
  private a2aClient: A2AClient;
  private modelConfig: ModelConfig;

  constructor(
    openaiApiKey: string,
    agentEndpoint: AgentEndpointConfig,
    modelConfig: ModelConfig,
  ) {
    this.openaiClient = new OpenAI({
      apiKey: openaiApiKey,
    });
    this.a2aClient = new A2AClient(agentEndpoint);
    this.modelConfig = modelConfig;
  }

  /**
   * Run a single conversation simulation with an external agent via A2A protocol
   */
  async runSimulation(
    scenario: UserSimulatorScenario,
    successCriteria: SuccessCriteria,
    terminationConditions?: TerminationConditions,
    metadata?: Record<string, unknown>,
  ): Promise<ConversationResult> {
    const conversationManager = new ConversationManager(
      scenario,
      successCriteria,
      terminationConditions,
    );

    const sessionId = conversationManager.getSessionId();

    logger.info("Starting user simulation with A2A protocol", {
      sessionId,
      scenario: scenario.scenarioName,
      persona: scenario.persona?.type,
      maxTurns: successCriteria.maxTurns,
    });

    try {
      // Initialize A2A client (discover agent card if needed)
      await this.a2aClient.initialize();

      const agentCard = this.a2aClient.getAgentCard();
      if (agentCard) {
        logger.info("Connected to A2A agent", {
          agentName: agentCard.name,
          agentId: agentCard.id,
          capabilities: agentCard.capabilities,
        });
      }

      // Main conversation loop
      // Note: ConversationManager already added the initial agent message "Hi! How can I help you today?"
      while (true) {
        // Generate next user message from simulator (OpenAI)
        // The simulator sees the conversation history including the initial "Hi! How can I help you today?"
        const userMessage = await this.generateUserMessage(
          conversationManager.getMessagesForSimulator(),
        );
        conversationManager.addUserMessage(userMessage);

        console.log(`\n=== USER SIMULATOR (Turn ${conversationManager.getTurnCount()}) ===`);
        console.log(`User says: ${userMessage}`);
        console.log("==========================================\n");

        logger.info("Simulator generated user message", {
          sessionId,
          turn: conversationManager.getTurnCount(),
          message: userMessage,
        });

        // Check for ###STOP### from user simulator
        const { shouldContinue: shouldContinueAfterUser, reason: reasonAfterUser } =
          conversationManager.shouldContinueConversation(userMessage);

        if (!shouldContinueAfterUser) {
          logger.info("Conversation terminated after user message", {
            sessionId,
            reason: reasonAfterUser,
            turns: conversationManager.getTurnCount(),
            taskId: conversationManager.getTaskId(),
          });
          return conversationManager.buildResult(
            reasonAfterUser as
              | "max_turns"
              | "keyword_match"
              | "timeout"
              | "error"
              | "success",
            undefined,
            metadata,
          );
        }

        // Send to agent via A2A protocol and get response
        const agentResponse = await this.sendToAgent(
          userMessage,
          conversationManager,
          metadata,
        );
        conversationManager.addAgentMessage(agentResponse);

        console.log(`\n=== AGENT RESPONSE (Turn ${conversationManager.getTurnCount()}) ===`);
        console.log(`Agent says: ${agentResponse}`);
        console.log("==========================================\n");

        logger.info("Received agent response via A2A", {
          sessionId,
          turn: conversationManager.getTurnCount(),
          response: agentResponse,
          turn: conversationManager.getTurnCount(),
          messageLength: agentResponse.length,
          taskId: conversationManager.getTaskId(),
        });
      }
    } catch (error) {
      logger.error("Simulation failed with error", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return conversationManager.buildResult(
        "error",
        error instanceof Error ? error.message : String(error),
        metadata,
      );
    }
  }

  /**
   * Generate a user message using the OpenAI simulator
   */
  private async generateUserMessage(
    conversationHistory: Array<{ role: string; content: string }>,
  ): Promise<string> {
    try {
      const response = await this.openaiClient.chat.completions.create({
        model: this.modelConfig.model,
        messages: conversationHistory as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: this.modelConfig.temperature,
        max_tokens: this.modelConfig.maxTokens,
        top_p: this.modelConfig.topP,
      });

      const message = response.choices[0]?.message?.content;
      if (!message) {
        throw new UserSimulatorServiceError(
          "No message content in OpenAI response",
        );
      }

      return message;
    } catch (error) {
      logger.error("Failed to generate user message from simulator", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new UserSimulatorServiceError(
        "Failed to generate user message",
        error,
      );
    }
  }

  /**
   * Send messages to the external agent via A2A protocol (JSON-RPC message/send)
   */
  private async sendToAgent(
    userMessage: string,
    conversationManager: ConversationManager,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    try {
      // Get A2A-formatted messages (includes conversation history)
      const messages = conversationManager.getMessagesForAgent();

      // Add the new user message
      const updatedMessages = [
        ...messages,
        {
          role: "user" as const,
          parts: [{ type: "text" as const, text: userMessage }],
        },
      ];

      // Use session ID as context for A2A task grouping
      const context = conversationManager.getSessionId();

      logger.debug("Sending A2A message/send request", {
        context,
        messageCount: updatedMessages.length,
      });

      // Send via A2A protocol
      const result = await this.a2aClient.sendMessage(
        updatedMessages,
        context,
        metadata,
      );

      // Store task ID for tracking
      if (result.taskId) {
        conversationManager.setTaskId(result.taskId);
      }

      // Extract text response from artifacts
      if (result.status === "completed" && result.artifacts && result.artifacts.length > 0) {
        const textParts = result.artifacts[0].parts
          .filter((p) => p.type === "text")
          .map((p) => (p.type === "text" ? p.text : ""));

        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }

      // Handle async tasks
      if (result.status === "in_progress") {
        throw new UserSimulatorServiceError(
          `Agent returned in_progress status (taskId: ${result.taskId}). Async tasks not yet supported.`,
        );
      }

      // Failed or no response
      throw new UserSimulatorServiceError(
        `Agent failed to return a response (status: ${result.status})`,
      );
    } catch (error) {
      if (error instanceof A2AClientError) {
        throw new UserSimulatorServiceError(
          `A2A protocol error: ${error.message} (code: ${error.code})`,
          error,
        );
      }
      throw error;
    }
  }

  /**
   * Test connection to both OpenAI and the agent endpoint
   */
  async testConnections(): Promise<{
    openai: boolean;
    agent: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let openaiOk = false;
    let agentOk = false;

    // Test OpenAI
    try {
      await this.openaiClient.chat.completions.create({
        model: this.modelConfig.model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
      });
      openaiOk = true;
    } catch (error) {
      errors.push(
        `OpenAI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Test A2A agent
    try {
      agentOk = await this.a2aClient.testConnection();
      if (!agentOk) {
        errors.push("A2A Agent: Connection test failed");
      }
    } catch (error) {
      errors.push(
        `A2A Agent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      openai: openaiOk,
      agent: agentOk,
      errors,
    };
  }
}
