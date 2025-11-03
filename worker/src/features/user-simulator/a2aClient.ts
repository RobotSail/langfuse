import {
  type A2AMessage,
  type A2ATask,
  type A2AJsonRpcRequest,
  type A2AJsonRpcResponse,
  type A2AMessageSendResult,
  type A2AAgentCard,
  type AgentEndpointConfig,
  type Part,
  A2AJsonRpcResponseSchema,
  A2AAgentCardSchema,
} from "@langfuse/shared/src/features/user-simulator";
import { logger } from "@langfuse/shared/src/server";

export class A2AClientError extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = "A2AClientError";
  }
}

/**
 * A2A Protocol Client implementing JSON-RPC 2.0
 * Based on: https://github.com/google/a2a
 */
export class A2AClient {
  private config: AgentEndpointConfig;
  private agentCard: A2AAgentCard | null = null;
  private jsonRpcEndpoint: string | null = null;
  private requestIdCounter = 0;

  constructor(config: AgentEndpointConfig) {
    this.config = config;
  }

  /**
   * Initialize the client by discovering agent capabilities
   */
  async initialize(): Promise<void> {
    if (this.config.jsonRpcEndpoint) {
      // Direct endpoint provided, skip discovery
      this.jsonRpcEndpoint = this.config.jsonRpcEndpoint;
      logger.info("A2A client initialized with direct JSON-RPC endpoint", {
        endpoint: this.jsonRpcEndpoint,
      });
      return;
    }

    if (this.config.agentCardUrl) {
      // Fetch agent card for discovery
      await this.fetchAgentCard();

      // Try different possible locations for the JSON-RPC endpoint
      const card = this.agentCard as any;
      let endpointPath =
        card?.endpoints?.jsonRpc ||
        card?.endpoints?.jsonrpc ||
        card?.endpoints?.messageSend ||
        card?.jsonRpc ||
        card?.jsonrpc ||
        card?.endpoint;

      // If no explicit endpoint, use conventional A2A path based on preferredTransport
      if (!endpointPath && card?.preferredTransport === "JSONRPC") {
        endpointPath = "/v1/message:send";
        logger.info("No explicit endpoint in Agent Card, using conventional A2A path", {
          path: endpointPath,
        });
      }

      if (!endpointPath) {
        throw new A2AClientError(
          "Agent Card does not contain an endpoint and no conventional path could be determined. Tried: endpoints.jsonRpc, endpoints.jsonrpc, endpoints.messageSend, jsonRpc, jsonrpc, endpoint, conventional /v1/message:send",
          -32000,
          { agentCard: this.agentCard }
        );
      }

      // If the endpoint is a relative path, construct the full URL
      if (endpointPath.startsWith('/')) {
        const baseUrl = card?.url || this.config.agentCardUrl?.replace('/.well-known/agent-card.json', '').replace('/.well-known/agent.json', '');
        this.jsonRpcEndpoint = `${baseUrl}${endpointPath}`;
      } else {
        this.jsonRpcEndpoint = endpointPath;
      }

      logger.info("A2A client initialized via Agent Card discovery", {
        agentName: card?.name,
        endpoint: this.jsonRpcEndpoint,
        capabilities: card?.capabilities,
      });
      return;
    }

    throw new A2AClientError(
      "No endpoint configuration provided (need agentCardUrl or jsonRpcEndpoint)",
      -32000
    );
  }

  /**
   * Fetch the Agent Card from the well-known URL
   */
  private async fetchAgentCard(): Promise<void> {
    if (!this.config.agentCardUrl) {
      throw new A2AClientError("No Agent Card URL configured", -32000);
    }

    try {
      logger.info("Fetching A2A Agent Card", { url: this.config.agentCardUrl });

      const response = await fetch(this.config.agentCardUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          ...this.getAuthHeaders(),
        },
      });

      if (!response.ok) {
        throw new A2AClientError(
          `Failed to fetch Agent Card: ${response.status} ${response.statusText}`,
          -32000,
          await response.text()
        );
      }

      const cardData = await response.json();

      // Try to parse with the schema, but don't fail if it doesn't match exactly
      const parsed = A2AAgentCardSchema.safeParse(cardData);

      if (parsed.success) {
        this.agentCard = parsed.data;
      } else {
        // Store the raw card data even if it doesn't match the schema
        // We'll try to extract the endpoint flexibly below
        logger.warn("Agent Card doesn't match expected schema, using raw data", {
          validationErrors: parsed.error.issues,
        });
        this.agentCard = cardData as any;
      }
      logger.info("Agent Card fetched successfully", {
        agentId: this.agentCard?.id,
        name: this.agentCard?.name,
      });
    } catch (error) {
      if (error instanceof A2AClientError) throw error;

      throw new A2AClientError(
        `Failed to fetch Agent Card: ${error instanceof Error ? error.message : String(error)}`,
        -32000,
        error
      );
    }
  }

  /**
   * Send a message to the agent using A2A protocol (message/send)
   */
  async sendMessage(
    messages: A2AMessage[],
    context?: string,
    metadata?: Record<string, unknown>,
  ): Promise<A2AMessageSendResult> {
    if (!this.jsonRpcEndpoint) {
      await this.initialize();
    }

    if (!this.jsonRpcEndpoint) {
      throw new A2AClientError("No JSON-RPC endpoint available", -32000);
    }

    // Get the last message to send (most recent user message)
    const lastMessage = messages[messages.length - 1];

    // Use the simpler A2A format (not full JSON-RPC wrapper)
    const request = {
      message: {
        role: lastMessage.role,
        parts: lastMessage.parts.map(part => {
          if (part.type === "text") {
            return { text: part.text };
          }
          return part;
        }),
      },
      ...(context && { context }),
      ...(metadata && { metadata }),
    };

    return await this.makeSimpleA2ARequest<A2AMessageSendResult>(request);
  }

  /**
   * Send a text message (convenience method)
   */
  async sendTextMessage(
    text: string,
    role: "user" | "agent" = "user",
    context?: string,
  ): Promise<string> {
    const message: A2AMessage = {
      role,
      parts: [{ type: "text", text }],
    };

    const result = await this.sendMessage([message], context);

    logger.info("sendTextMessage result", {
      status: result.status,
      hasArtifacts: !!result.artifacts,
      artifactsLength: result.artifacts?.length || 0,
      fullResult: JSON.stringify(result),
    });

    // Extract text from response artifacts
    if (result.status === "completed" && result.artifacts && result.artifacts.length > 0) {
      const textParts = result.artifacts[0].parts.filter(
        (part): part is Extract<Part, { type: "text" }> => part.type === "text"
      );

      logger.info("Extracted text parts", {
        textPartsCount: textParts.length,
        firstPartPreview: textParts[0]?.text?.substring(0, 100),
      });

      if (textParts.length > 0) {
        return textParts.map(p => p.text).join("\n");
      }
    }

    // If in_progress, we'd need to poll for completion
    if (result.status === "in_progress") {
      throw new A2AClientError(
        "Async tasks not yet supported - agent returned in_progress status",
        -32000,
        result
      );
    }

    throw new A2AClientError(
      "No text response received from agent",
      -32000,
      result
    );
  }

  /**
   * Make a simple A2A request (without JSON-RPC wrapper)
   */
  private async makeSimpleA2ARequest<T = unknown>(
    request: any,
    retryAttempt = 0,
  ): Promise<T> {
    const maxRetries = this.config.retries ?? 3;

    try {
      logger.info(`A2A request (attempt ${retryAttempt + 1}/${maxRetries + 1})`, {
        endpoint: this.jsonRpcEndpoint,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout ?? 30000
      );

      const response = await fetch(this.jsonRpcEndpoint!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.getAuthHeaders(),
          ...(this.config.headers || {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new A2AClientError(
          `HTTP error ${response.status}: ${response.statusText}`,
          -32000,
          errorText
        );
      }

      const responseData = await response.json();

      // Debug logging with console.log to ensure we see the data
      console.log("=== A2A RESPONSE DEBUG ===");
      console.log("Response data:", JSON.stringify(responseData, null, 2));
      console.log("Has message:", !!responseData.message);
      console.log("Has artifact:", !!responseData.artifact);
      console.log("Has task:", !!responseData.task);
      console.log("========================");

      logger.info("A2A response received", {
        responseData: JSON.stringify(responseData),
      });

      // Parse the response - expecting task, message, or artifact format
      // Convert to our standard A2AMessageSendResult format
      const result: A2AMessageSendResult = {
        taskId: responseData.task?.id || responseData.taskId || `task-${Date.now()}`,
        status: "completed",
        artifacts: [],
      };

      // Extract response message/artifact
      if (responseData.message) {
        console.log("=== PARSING MESSAGE ===");
        console.log("Message:", JSON.stringify(responseData.message, null, 2));

        // Normalize A2A parts to our Part format
        // A2A parts have { text: "...", mimeType: "..." }
        // Our Part format needs { type: "text", text: "..." }
        const normalizedParts = responseData.message.parts?.map((part: any) => {
          if (part.text !== undefined) {
            return { type: "text" as const, text: part.text };
          }
          return part;
        }) || [{ type: "text" as const, text: responseData.message.content || "" }];

        result.artifacts = [{
          parts: normalizedParts,
        }];
        console.log("Artifacts after message parse:", JSON.stringify(result.artifacts, null, 2));
      } else if (responseData.artifact) {
        console.log("=== PARSING ARTIFACT ===");
        console.log("Artifact:", JSON.stringify(responseData.artifact, null, 2));
        result.artifacts = [responseData.artifact];
      } else if (responseData.task?.artifact) {
        console.log("=== PARSING TASK ARTIFACT ===");
        console.log("Task artifact:", JSON.stringify(responseData.task.artifact, null, 2));
        result.artifacts = [responseData.task.artifact];
      } else {
        console.log("=== NO KNOWN RESPONSE FORMAT ===");
        console.log("Response keys:", Object.keys(responseData));
      }

      console.log("=== FINAL RESULT ===");
      console.log("Artifacts count:", result.artifacts?.length || 0);
      console.log("========================");

      logger.info("A2A request successful", {
        taskId: result.taskId,
        artifactsCount: result.artifacts?.length || 0,
      });

      return result as T;
    } catch (error) {
      // Handle timeout
      if (error instanceof Error && error.name === "AbortError") {
        logger.warn(`A2A request timeout after ${this.config.timeout}ms`);

        if (retryAttempt < maxRetries) {
          return await this.retrySimpleA2ARequest(request, retryAttempt);
        }

        throw new A2AClientError(
          `Request timeout after ${this.config.timeout}ms`,
          -32000
        );
      }

      // Handle A2A errors
      if (error instanceof A2AClientError) {
        // Don't retry client errors (4xx equivalent)
        if (error.code && error.code >= -32099 && error.code <= -32000) {
          throw error;
        }

        // Retry server errors
        if (retryAttempt < maxRetries) {
          return await this.retrySimpleA2ARequest(request, retryAttempt);
        }

        throw error;
      }

      // Unknown errors
      logger.error("A2A request failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      if (retryAttempt < maxRetries) {
        return await this.retrySimpleA2ARequest(request, retryAttempt);
      }

      throw new A2AClientError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        -32000,
        error
      );
    }
  }

  /**
   * Retry a simple A2A request with exponential backoff
   */
  private async retrySimpleA2ARequest<T>(
    request: any,
    currentAttempt: number,
  ): Promise<T> {
    const delay = Math.min(1000 * Math.pow(2, currentAttempt), 10000);
    logger.info(`Retrying A2A request in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return await this.makeSimpleA2ARequest<T>(request, currentAttempt + 1);
  }

  /**
   * Make a JSON-RPC 2.0 request
   */
  private async makeJsonRpcRequest<T = unknown>(
    request: A2AJsonRpcRequest,
    retryAttempt = 0,
  ): Promise<T> {
    const maxRetries = this.config.retries ?? 3;

    try {
      logger.info(`A2A JSON-RPC request (attempt ${retryAttempt + 1}/${maxRetries + 1})`, {
        method: request.method,
        id: request.id,
        endpoint: this.jsonRpcEndpoint,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout ?? 30000
      );

      const response = await fetch(this.jsonRpcEndpoint!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.getAuthHeaders(),
          ...(this.config.headers || {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new A2AClientError(
          `HTTP error ${response.status}: ${response.statusText}`,
          -32000,
          await response.text()
        );
      }

      const responseData = await response.json();
      const parsed = A2AJsonRpcResponseSchema.safeParse(responseData);

      if (!parsed.success) {
        throw new A2AClientError(
          "Invalid JSON-RPC response format",
          -32600,
          parsed.error
        );
      }

      const jsonRpcResponse: A2AJsonRpcResponse = parsed.data;

      // Check for JSON-RPC error
      if (jsonRpcResponse.error) {
        throw new A2AClientError(
          jsonRpcResponse.error.message,
          jsonRpcResponse.error.code,
          jsonRpcResponse.error.data
        );
      }

      if (!jsonRpcResponse.result) {
        throw new A2AClientError(
          "No result in JSON-RPC response",
          -32000,
          jsonRpcResponse
        );
      }

      logger.info("A2A JSON-RPC request successful", {
        method: request.method,
        id: request.id,
      });

      return jsonRpcResponse.result as T;
    } catch (error) {
      // Handle timeout
      if (error instanceof Error && error.name === "AbortError") {
        logger.warn(`A2A request timeout after ${this.config.timeout}ms`);

        if (retryAttempt < maxRetries) {
          return await this.retryRequest(request, retryAttempt);
        }

        throw new A2AClientError(
          `Request timeout after ${this.config.timeout}ms`,
          -32000
        );
      }

      // Handle A2A errors
      if (error instanceof A2AClientError) {
        // Don't retry client errors (4xx equivalent in JSON-RPC)
        if (error.code && error.code >= -32099 && error.code <= -32000) {
          throw error;
        }

        // Retry server errors
        if (retryAttempt < maxRetries) {
          return await this.retryRequest(request, retryAttempt);
        }

        throw error;
      }

      // Unknown errors
      logger.error("A2A request failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      if (retryAttempt < maxRetries) {
        return await this.retryRequest(request, retryAttempt);
      }

      throw new A2AClientError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        -32000,
        error
      );
    }
  }

  /**
   * Retry a request with exponential backoff
   */
  private async retryRequest<T>(
    request: A2AJsonRpcRequest,
    currentAttempt: number,
  ): Promise<T> {
    const delay = Math.min(1000 * Math.pow(2, currentAttempt), 10000);
    logger.info(`Retrying A2A request in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return await this.makeJsonRpcRequest<T>(request, currentAttempt + 1);
  }

  /**
   * Get authentication headers based on config
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.authType === "bearer" && this.config.authToken) {
      headers["Authorization"] = `Bearer ${this.config.authToken}`;
    } else if (this.config.authType === "api_key" && this.config.authToken) {
      headers["X-API-Key"] = this.config.authToken;
    }

    return headers;
  }

  /**
   * Test connection to the agent
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.initialize();

      // Try sending a simple test message
      const response = await this.sendTextMessage(
        "Hello, this is a connection test from Langfuse User Simulator.",
        "user",
        "test"
      );

      logger.info("A2A connection test succeeded", {
        responseLength: response.length,
      });

      return true;
    } catch (error) {
      logger.error("A2A connection test failed", {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorData: error instanceof A2AClientError ? error.data : undefined,
      });
      return false;
    }
  }

  /**
   * Get the discovered agent card (if available)
   */
  getAgentCard(): A2AAgentCard | null {
    return this.agentCard;
  }
}
