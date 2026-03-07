import { WebContents } from "electron";
import { streamText, tool, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import { z } from "zod";
import type { Window } from "./Window";
import type { Citation, ChatRequest, StreamChunk } from "./types";

dotenv.config({ path: join(__dirname, "../../.env") });

type LLMProvider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-5",
};

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

const citeInputSchema = z.object({
  index: z
    .number()
    .describe("The citation number matching the [N] marker in your text"),
  text: z.string().describe("The exact quote or excerpt from the source"),
  source: z
    .enum(["screenshot", "page_content", "url"])
    .describe("Where this information came from"),
});

const citeTool = tool({
  description:
    "Create a citation that references specific content from the page. " +
    "Call this tool for each fact you cite. Use the same index number " +
    "that you place in square brackets in your response text, e.g. [1].",
  inputSchema: citeInputSchema,
});

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];
  private messageIds: string[] = [];
  private citations: Map<string, Citation[]> = new Map();

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();
    this.model = this.initializeModel();
    this.logInitializationStatus();
  }

  setWindow(window: Window): void {
    this.window = window;
  }

  private getProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    return "openai";
  }

  private getModelName(): string {
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
  }

  private initializeModel(): LanguageModel | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName);
      case "openai":
        return openai(this.modelName);
      default:
        return null;
    }
  }

  private getApiKey(): string | undefined {
    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      default:
        return undefined;
    }
  }

  private logInitializationStatus(): void {
    if (this.model) {
      console.log(
        `LLM Client initialized with ${this.provider} provider using model: ${this.modelName}`,
      );
    } else {
      const keyName =
        this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`,
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      let screenshot: string | null = null;
      if (this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            console.error("Failed to capture screenshot:", error);
          }
        }
      }

      const userContent: any[] = [];
      if (screenshot) {
        userContent.push({ type: "image", image: screenshot });
      }
      userContent.push({ type: "text", text: request.message });

      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };

      const userMessageId = `user-${request.messageId}`;
      this.messages.push(userMessage);
      this.messageIds.push(userMessageId);
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file.",
        );
        return;
      }

      const preparedMessages = await this.prepareMessagesWithContext();
      await this.streamResponse(preparedMessages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.messageIds = [];
    this.citations.clear();
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  getMessageIds(): string[] {
    return this.messageIds;
  }

  getCitations(): Map<string, Citation[]> {
    return this.citations;
  }

  private sendMessagesToRenderer(): void {
    const citationsObj: Record<string, Citation[]> = {};
    this.citations.forEach((value, key) => {
      citationsObj[key] = value;
    });

    this.webContents.send("chat-messages-updated", {
      messages: this.messages,
      messageIds: this.messageIds,
      citations: citationsObj,
    });
  }

  private async prepareMessagesWithContext(): Promise<CoreMessage[]> {
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          console.error("Failed to get page text:", error);
        }
      }
    }

    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(
    url: string | null,
    pageText: string | null,
  ): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided.",
      "\nCITATION GUIDELINES:",
      "- When you reference SPECIFIC information from the page, include inline markers like [1], [2], etc.",
      "- For each marker, call the 'cite' tool with the matching index, the exact source text, and the source type.",
      "- Only cite when you directly reference specific details, not for general knowledge.",
      "- Keep citations concise. For general questions, 0-2 citations are sufficient.",
      "- Source types: 'page_content' for text, 'screenshot' for visual elements, 'url' for URL-based info.",
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string,
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    const assistantMessageId = `assistant-${messageId}`;
    const assistantMessage: CoreMessage = { role: "assistant", content: "" };
    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);
    this.messageIds.push(assistantMessageId);

    let currentText = "";

    const result = streamText({
      model: this.model,
      messages,
      tools: { cite: citeTool },
      toolChoice: "auto",
      temperature: DEFAULT_TEMPERATURE,
      maxRetries: 3,
      onError: ({ error }) => {
        console.error("Stream error:", error);
      },
    });

    try {
      for await (const textPart of result.textStream) {
        currentText += textPart;
        this.messages[messageIndex] = {
          role: "assistant",
          content: currentText,
        };
        this.sendMessagesToRenderer();
        this.sendStreamChunk(messageId, {
          content: textPart,
          isComplete: false,
        });
      }

      const toolCalls = await result.toolCalls;
      const citations: Citation[] = toolCalls
        .filter((tc) => tc.toolName === "cite")
        .map((tc) => {
          const input = tc.input as z.infer<typeof citeInputSchema>;
          return {
            index: input.index,
            text: input.text,
            source: input.source,
          };
        })
        .sort((a, b) => a.index - b.index);

      const finalText = await result.text;
      this.messages[messageIndex] = { role: "assistant", content: finalText };

      if (citations.length > 0) {
        this.citations.set(assistantMessageId, citations);
      }

      this.sendMessagesToRenderer();
      this.sendStreamChunk(messageId, {
        content: finalText,
        isComplete: true,
        citations,
      });
    } catch (error) {
      this.handleStreamError(error, messageId);
    }
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);
    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(messageId, errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }
    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }
    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }
    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
      citations: chunk.citations,
    });
  }
}
