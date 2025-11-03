import {
  type A2AMessage,
  type ConversationResult,
  type TerminationConditions,
  type UserSimulatorScenario,
  type SuccessCriteria,
} from "@langfuse/shared/src/features/user-simulator";
import { logger } from "@langfuse/shared/src/server";
import { v4 as uuidv4 } from "uuid";

/**
 * Manages conversation state and history for A2A protocol interactions
 */
export class ConversationManager {
  private conversationHistory: A2AMessage[] = [];
  private turnCount = 0;
  private startTime: number;
  private sessionId: string;
  private scenarioId: string;
  private taskId: string | undefined;
  private systemPrompt: string;

  constructor(
    private scenario: UserSimulatorScenario,
    private successCriteria: SuccessCriteria,
    private terminationConditions?: TerminationConditions,
  ) {
    this.sessionId = uuidv4();
    this.scenarioId = scenario.scenarioName;
    this.startTime = Date.now();
    this.systemPrompt = this.buildSystemPrompt(scenario.systemPrompt, scenario.userInstruction);

    // Start with initial agent message: "Hi! How can I help you today?"
    // This will be sent to the simulator to generate the first user response
    this.conversationHistory.push({
      role: "agent",
      parts: [{ type: "text", text: "Hi! How can I help you today?" }],
    });
    this.turnCount = 0; // We haven't generated a user message yet
  }

  /**
   * Build the system prompt with rules and instruction
   */
  private buildSystemPrompt(systemPrompt: string, userInstruction: string): string {
    const instructionDisplay = userInstruction
      ? `\n\nInstruction: ${userInstruction}\n`
      : "";

    return `You are a user interacting with an agent.${instructionDisplay}
${systemPrompt ? `\nPersona: ${systemPrompt}\n` : ""}
Rules:
- Just generate one line at a time to simulate the user's message.
- Do not give away all the instruction at once. Only provide the information that is necessary for the current step.
- Do not hallucinate information that is not provided in the instruction. For example, if the agent asks for the order id but it is not mentioned in the instruction, do not make up an order id, just say you do not remember or have it.
- If the instruction goal is satisfied, generate '###STOP###' as a standalone message without anything else to end the conversation.
- Do not repeat the exact instruction in the conversation. Instead, use your own words to convey the same information.
- Try to make the conversation as natural as possible, and stick to the personalities in the instruction.`;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  getTaskId(): string | undefined {
    return this.taskId;
  }

  setTaskId(taskId: string): void {
    this.taskId = taskId;
  }

  getConversationHistory(): A2AMessage[] {
    return this.conversationHistory;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Get messages to send to simulator (for OpenAI API - converts A2A to OpenAI format)
   * Includes system prompt as first message
   *
   * IMPORTANT: Role reversal for user simulator perspective:
   * - Agent messages (from A2A) → appear as "user" to the simulator (the other person in the conversation)
   * - User messages (simulator's own messages) → appear as "assistant" to the simulator (their own responses)
   */
  getMessagesForSimulator(): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: this.systemPrompt },
    ];

    // Convert A2A messages to OpenAI format with REVERSED roles
    // The simulator is playing the role of a user, so:
    // - The agent's messages are what the "user" (simulator) sees
    // - The simulator's own messages are its responses
    for (const msg of this.conversationHistory) {
      const textParts = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""));

      const content = textParts.join("\n");

      messages.push({
        // REVERSED: agent becomes user (what the simulator sees)
        // user becomes assistant (the simulator's own responses)
        role: msg.role === "agent" ? "user" : "assistant",
        content,
      });
    }

    return messages;
  }

  /**
   * Get messages to send to agent (A2A format)
   * Excludes system prompt (agent has its own prompt)
   */
  getMessagesForAgent(): A2AMessage[] {
    return this.conversationHistory;
  }

  /**
   * Add a user message from the simulator
   */
  addUserMessage(content: string): void {
    this.conversationHistory.push({
      role: "user",
      parts: [{ type: "text", text: content }],
    });
    this.turnCount++;

    logger.debug(`Turn ${this.turnCount}: User message added`, {
      sessionId: this.sessionId,
      contentLength: content.length,
    });
  }

  /**
   * Add an agent message (response from the external agent)
   */
  addAgentMessage(content: string): void {
    this.conversationHistory.push({
      role: "agent",
      parts: [{ type: "text", text: content }],
    });

    logger.debug(`Turn ${this.turnCount}: Agent message added`, {
      sessionId: this.sessionId,
      contentLength: content.length,
    });
  }

  /**
   * Extract text from last message
   */
  private extractTextFromMessage(message: A2AMessage): string {
    const textParts = message.parts.filter((p) => p.type === "text");
    return textParts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  }

  /**
   * Check if the conversation should continue
   * Returns { shouldContinue: boolean, reason: string }
   */
  shouldContinueConversation(lastMessage?: string): {
    shouldContinue: boolean;
    reason: string;
  } {
    // Check max turns
    const maxTurns = this.successCriteria.maxTurns ?? 10;
    if (this.turnCount >= maxTurns) {
      return {
        shouldContinue: false,
        reason: "max_turns",
      };
    }

    // Check timeout
    if (this.terminationConditions?.timeout) {
      const elapsed = Date.now() - this.startTime;
      if (elapsed > this.terminationConditions.timeout) {
        return {
          shouldContinue: false,
          reason: "timeout",
        };
      }
    }

    // Check for ###STOP### keyword (user goal satisfied)
    if (lastMessage && lastMessage.includes("###STOP###")) {
      logger.info("User simulator sent ###STOP### - goal satisfied", {
        sessionId: this.sessionId,
      });
      return {
        shouldContinue: false,
        reason: "success",
      };
    }

    // Check termination keywords
    if (lastMessage && this.terminationConditions?.keywords) {
      const lowerMessage = lastMessage.toLowerCase();
      for (const keyword of this.terminationConditions.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          logger.info("Termination keyword detected", {
            keyword,
            sessionId: this.sessionId,
          });
          return {
            shouldContinue: false,
            reason: "keyword_match",
          };
        }
      }
    }

    return {
      shouldContinue: true,
      reason: "continue",
    };
  }

  /**
   * Build final conversation result
   */
  buildResult(
    terminationReason:
      | "max_turns"
      | "keyword_match"
      | "timeout"
      | "error"
      | "success",
    error?: string,
    metadata?: Record<string, unknown>,
  ): ConversationResult {
    return {
      sessionId: this.sessionId,
      scenarioId: this.scenarioId,
      taskId: this.taskId,
      turnCount: this.turnCount,
      conversationHistory: this.conversationHistory,
      terminationReason,
      error,
      metadata: {
        ...metadata,
        duration: Date.now() - this.startTime,
        scenario: this.scenario.scenarioName,
        persona: this.scenario.persona?.type,
      },
    };
  }

  /**
   * Get the last user message (useful for resuming or debugging)
   */
  getLastUserMessage(): string | undefined {
    const userMessages = this.conversationHistory.filter(
      (msg) => msg.role === "user",
    );
    const lastUserMsg = userMessages[userMessages.length - 1];
    return lastUserMsg ? this.extractTextFromMessage(lastUserMsg) : undefined;
  }

  /**
   * Get the last agent message
   */
  getLastAgentMessage(): string | undefined {
    const agentMessages = this.conversationHistory.filter(
      (msg) => msg.role === "agent",
    );
    const lastAgentMsg = agentMessages[agentMessages.length - 1];
    return lastAgentMsg ? this.extractTextFromMessage(lastAgentMsg) : undefined;
  }

  /**
   * Get conversation summary for logging
   */
  getSummary(): {
    sessionId: string;
    scenarioId: string;
    taskId: string | undefined;
    turnCount: number;
    duration: number;
    messageCount: number;
  } {
    return {
      sessionId: this.sessionId,
      scenarioId: this.scenarioId,
      taskId: this.taskId,
      turnCount: this.turnCount,
      duration: Date.now() - this.startTime,
      messageCount: this.conversationHistory.length,
    };
  }
}
