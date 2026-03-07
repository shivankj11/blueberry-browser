export interface Citation {
  index: number;
  text: string;
  source: "screenshot" | "page_content" | "url";
}

export interface ChatRequest {
  message: string;
  messageId: string;
}

export interface StreamChunk {
  content: string;
  isComplete: boolean;
  citations?: Citation[];
}

export interface HighlightResult {
  success: boolean;
  matchCount: number;
  highlighted?: boolean;
  scrolled?: boolean;
  message?: string;
}
