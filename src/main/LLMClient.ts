import { WebContents } from "electron";
import { streamObject, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { z } from "zod";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface Citation {
  text: string;
  source: "screenshot" | "page_content" | "url";
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
  citations?: Citation[];
}

// Zod schema for structured LLM output with citations
const CitationSchema = z.object({
  text: z.string().describe("The exact quote or excerpt from the source that supports the answer"),
  source: z.enum(["screenshot", "page_content", "url"]).describe("Where this information came from: screenshot, page_content, or url"),
});

const ResponseWithCitationsSchema = z.object({
  response: z.string().describe("The main response to the user's question"),
  citations: z.array(CitationSchema).describe("Array of citations with exact quotes from the page content or screenshot that support the response"),
});

type LLMProvider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-5",
};

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];
  private citations: Map<number, Citation[]> = new Map();

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();
    this.model = this.initializeModel();

    this.logInitializationStatus();
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  private getProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    return "openai"; // Default to OpenAI
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
        `✅ LLM Client initialized with ${this.provider} provider using model: ${this.modelName}`
      );
    } else {
      const keyName =
        this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Get screenshot from active tab if available
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

      // Build user message content with screenshot first, then text
      const userContent: any[] = [];
      
      // Add screenshot as the first part if available
      if (screenshot) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }
      
      // Add text content
      userContent.push({
        type: "text",
        text: request.message,
      });

      // Create user message in CoreMessage format
      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };
      
      this.messages.push(userMessage);

      // Send updated messages to renderer
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file."
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext(request);
      await this.streamResponse(messages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.citations.clear();
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  getCitations(): Map<number, Citation[]> {
    return this.citations;
  }

  private sendMessagesToRenderer(): void {
    // Convert citations map to a plain object for JSON serialization
    const citationsObj: Record<number, Citation[]> = {};
    this.citations.forEach((value, key) => {
      citationsObj[key] = value;
    });

    this.webContents.send("chat-messages-updated", {
      messages: this.messages,
      citations: citationsObj,
    });
  }

  private async prepareMessagesWithContext(_request: ChatRequest): Promise<CoreMessage[]> {
    // Get page context from active tab
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

    // Build system message
    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    // Include all messages in history (system + conversation)
    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(url: string | null, pageText: string | null): string {
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
      "\n\nCITATION GUIDELINES:",
      "- Only include citations when you directly reference SPECIFIC information from the page content, screenshot, or URL.",
      "- Citations should be VERY concise and only refer to SPECIFIC details, not general information.",
      "- Do NOT over-cite. For general questions about what a website is, 0-2 citations are sufficient.",
      "- Citations should contain the EXACT text/quote from the source that supports your answer.",
      "- Specify the source type: 'page_content' (for text content), 'screenshot' (for visual elements), or 'url' (for URL-based info).",
      "- If you're providing general knowledge or common information about a website, you don't need citations.",
      "- Only cite when it adds value and supports specific claims you're making."
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    try {
      const result = await streamObject({
        model: this.model,
        messages,
        schema: ResponseWithCitationsSchema,
        maxRetries: 3,
        abortSignal: undefined, // Could add abort controller for cancellation
      });

      await this.processStructuredStream(result, messageId);
    } catch (error) {
      throw error; // Re-throw to be handled by the caller
    }
  }

  private async processStructuredStream(
    result: Awaited<ReturnType<typeof streamObject<typeof ResponseWithCitationsSchema>>>,
    messageId: string
  ): Promise<void> {
    let currentResponse = "";

    // Create a placeholder assistant message
    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };

    // Keep track of the index for updates
    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    // Stream the partial objects as they arrive
    for await (const partialObject of result.partialObjectStream) {
      // Update response if available
      if (partialObject.response !== undefined) {
        const newContent = partialObject.response.slice(currentResponse.length);
        currentResponse = partialObject.response;

        // Update assistant message content
        this.messages[messageIndex] = {
          role: "assistant",
          content: currentResponse,
        };
        this.sendMessagesToRenderer();

        // Send incremental chunk
        if (newContent) {
          this.sendStreamChunk(messageId, {
            content: newContent,
            isComplete: false,
          });
        }
      }
    }

    // Get the final complete object
    const finalObject = await result.object;

    // Final update with complete content
    this.messages[messageIndex] = {
      role: "assistant",
      content: finalObject.response,
    };

    // Store citations if present
    if (finalObject.citations && finalObject.citations.length > 0) {
      this.citations.set(messageIndex, finalObject.citations);
    }

    // Send messages to renderer AFTER storing citations
    this.sendMessagesToRenderer();

    // Send the final complete signal with citations
    this.sendStreamChunk(messageId, {
      content: finalObject.response,
      isComplete: true,
      citations: finalObject.citations,
    });
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
