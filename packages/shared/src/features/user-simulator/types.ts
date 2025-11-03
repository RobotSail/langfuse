import { z } from "zod/v4";

// Persona definition for user simulator
export const PersonaSchema = z.object({
  type: z.string().describe("Type of persona (e.g., 'angry_customer', 'tech_savvy_user')"),
  traits: z.array(z.string()).optional().describe("Character traits (e.g., ['impatient', 'demanding'])"),
  tone: z.string().optional().describe("Communication tone (e.g., 'frustrated', 'professional')"),
  technicalLevel: z.enum(["beginner", "intermediate", "advanced"]).optional().describe("Technical knowledge level"),
  communicationStyle: z.string().optional().describe("Communication style (e.g., 'direct', 'verbose')"),
});

export type Persona = z.infer<typeof PersonaSchema>;

// Scenario context - flexible JSON for domain-specific data
export const ScenarioContextSchema = z.record(z.string(), z.any());

export type ScenarioContext = z.infer<typeof ScenarioContextSchema>;

// Complete scenario definition stored in dataset item input field
export const UserSimulatorScenarioSchema = z.object({
  scenarioName: z.string().describe("Unique name for this scenario"),
  systemPrompt: z.string().describe("Persona/behavior instructions for the user simulator (e.g., 'You are a frustrated customer')"),
  userInstruction: z.string().describe("Specific task/goal for this scenario (e.g., 'Change flight from JFK to LAX')"),

  // Legacy fields for backward compatibility
  persona: PersonaSchema.optional(),
  initialMessage: z.string().optional().describe("Optional first message from user"),
  conversationGoals: z.array(z.string()).optional().describe("Goals the simulated user should try to achieve"),
  context: ScenarioContextSchema.optional(),
});

export type UserSimulatorScenario = z.infer<typeof UserSimulatorScenarioSchema>;

// Success criteria stored in dataset item expectedOutput field
export const SuccessCriteriaSchema = z.object({
  maxTurns: z.number().min(1).max(50).optional().default(10).describe("Maximum conversation turns"),
  successCriteria: z.record(z.string(), z.any()).optional().describe("Domain-specific success criteria"),
  expectedSentiment: z.string().optional().describe("Expected final sentiment"),
  mustResolve: z.boolean().optional().describe("Whether issue must be resolved"),
});

export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>;

// Complete dataset item structure for user simulator scenarios
export const UserSimulatorDatasetItemSchema = z.object({
  input: UserSimulatorScenarioSchema,
  expectedOutput: SuccessCriteriaSchema.optional(),
  metadata: z.object({
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  }).optional(),
});

export type UserSimulatorDatasetItem = z.infer<typeof UserSimulatorDatasetItemSchema>;

// Model configuration for the simulator LLM
export const ModelConfigSchema = z.object({
  model: z.string().default("gpt-4").describe("OpenAI model to use for simulation"),
  temperature: z.number().min(0).max(2).optional().default(0.7).describe("Temperature for response generation"),
  maxTokens: z.number().optional().describe("Maximum tokens per response"),
  topP: z.number().min(0).max(1).optional().describe("Top-p sampling parameter"),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// Termination conditions for conversation
export const TerminationConditionsSchema = z.object({
  keywords: z.array(z.string()).optional().describe("Stop if simulator says these keywords"),
  timeout: z.number().optional().describe("Maximum conversation duration in milliseconds"),
  sentimentThreshold: z.number().optional().describe("Stop if sentiment reaches this threshold"),
});

export type TerminationConditions = z.infer<typeof TerminationConditionsSchema>;

// Agent endpoint configuration
export const AgentEndpointConfigSchema = z.object({
  agentCardUrl: z.string().url().optional().describe("URL to fetch the A2A Agent Card (e.g., https://agent.com/.well-known/agent.json)"),
  jsonRpcEndpoint: z.string().url().optional().describe("Direct JSON-RPC endpoint URL (if not using Agent Card discovery)"),
  authType: z.enum(["none", "bearer", "api_key"]).optional().default("none"),
  authToken: z.string().optional().describe("Auth token/API key if required"),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional().default(30000).describe("Request timeout in milliseconds"),
  retries: z.number().optional().default(3).describe("Number of retries on failure"),
}).refine(
  (data) => data.agentCardUrl || data.jsonRpcEndpoint,
  { message: "Either agentCardUrl or jsonRpcEndpoint must be provided" }
);

export type AgentEndpointConfig = z.infer<typeof AgentEndpointConfigSchema>;

// Complete user simulation evaluation configuration
export const UserSimulationEvalConfigSchema = z.object({
  // Dataset configuration
  datasetId: z.string().describe("Dataset ID containing scenarios"),
  datasetFilter: z.array(z.any()).optional().describe("Filter to select specific dataset items"),

  // Simulator configuration
  modelConfig: ModelConfigSchema.describe("LLM configuration for user simulator"),
  terminationConditions: TerminationConditionsSchema.optional(),

  // Agent configuration
  agentEndpoint: AgentEndpointConfigSchema.describe("External agent configuration"),

  // Langfuse configuration
  langfusePublicKey: z.string().optional().describe("Langfuse public key for agent tracing"),
  langfuseSecretKey: z.string().optional().describe("Langfuse secret key for agent tracing"),

  // Evaluation configuration
  evalTemplateId: z.string().optional().describe("Optional eval template to run on resulting traces"),

  // OpenAI API key for simulator
  openaiApiKey: z.string().describe("OpenAI API key for simulator LLM"),
});

export type UserSimulationEvalConfig = z.infer<typeof UserSimulationEvalConfigSchema>;

// ============================================
// A2A Protocol Types (JSON-RPC 2.0)
// Based on: https://github.com/google/a2a
// ============================================

// Part types for A2A messages
export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const FilePartSchema = z.object({
  type: z.literal("file"),
  fileUri: z.string(),
  mimeType: z.string().optional(),
  name: z.string().optional(),
});

export const DataPartSchema = z.object({
  type: z.literal("data"),
  data: z.record(z.string(), z.any()),
  mimeType: z.string().optional(),
});

export const PartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
]);

export type Part = z.infer<typeof PartSchema>;

// A2A Message (role + parts)
export const A2AMessageSchema = z.object({
  role: z.enum(["user", "agent"]),
  parts: z.array(PartSchema),
});

export type A2AMessage = z.infer<typeof A2AMessageSchema>;

// A2A Task
export const A2ATaskSchema = z.object({
  context: z.string().optional().describe("Optional context identifier for grouping related tasks"),
  messages: z.array(A2AMessageSchema),
});

export type A2ATask = z.infer<typeof A2ATaskSchema>;

// A2A JSON-RPC Request
export const A2AJsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  id: z.union([z.string(), z.number()]),
  params: z.record(z.string(), z.any()).optional(),
});

export type A2AJsonRpcRequest = z.infer<typeof A2AJsonRpcRequestSchema>;

// A2A message/send request params
export const A2AMessageSendParamsSchema = z.object({
  task: A2ATaskSchema,
});

export type A2AMessageSendParams = z.infer<typeof A2AMessageSendParamsSchema>;

// A2A message/send response result
export const A2AMessageSendResultSchema = z.object({
  taskId: z.string(),
  status: z.enum(["in_progress", "completed", "failed"]),
  artifacts: z.array(z.object({
    parts: z.array(PartSchema),
  })).optional().describe("Response artifacts if completed synchronously"),
});

export type A2AMessageSendResult = z.infer<typeof A2AMessageSendResultSchema>;

// A2A JSON-RPC Response
export const A2AJsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.any().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.any().optional(),
  }).optional(),
});

export type A2AJsonRpcResponse = z.infer<typeof A2AJsonRpcResponseSchema>;

// A2A Agent Card
export const A2AAgentCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  endpoints: z.object({
    jsonRpc: z.string().url().optional(),
    grpc: z.string().optional(),
  }),
  authentication: z.object({
    type: z.enum(["none", "bearer", "api_key", "oauth2"]).optional(),
    required: z.boolean().optional(),
  }).optional(),
});

export type A2AAgentCard = z.infer<typeof A2AAgentCardSchema>;

// Conversation result
export const ConversationResultSchema = z.object({
  sessionId: z.string(),
  scenarioId: z.string(),
  taskId: z.string().optional().describe("A2A task ID from the agent"),
  turnCount: z.number(),
  conversationHistory: z.array(A2AMessageSchema),
  terminationReason: z.enum(["max_turns", "keyword_match", "timeout", "error", "success"]),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ConversationResult = z.infer<typeof ConversationResultSchema>;

// Job data for user simulator queue
export const UserSimulatorJobDataSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  evalConfigId: z.string(),
  config: UserSimulationEvalConfigSchema,
  datasetItemIds: z.array(z.string()).optional().describe("Specific dataset items to run, or all if not specified"),
});

export type UserSimulatorJobData = z.infer<typeof UserSimulatorJobDataSchema>;
