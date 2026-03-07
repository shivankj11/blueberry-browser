import { ElectronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface Citation {
  index: number;
  text: string;
  source: "screenshot" | "page_content" | "url";
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface HighlightResult {
  success: boolean;
  matchCount: number;
  highlighted?: boolean;
  scrolled?: boolean;
  message?: string;
}

interface MessagesData {
  messages: any[];
  messageIds: string[];
  citations: Record<string, Citation[]>;
}

interface SidebarAPI {
  sendChatMessage: (request: ChatRequest) => Promise<void>;
  clearChat: () => Promise<boolean>;
  getMessages: () => Promise<MessagesData>;

  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  onMessagesUpdated: (callback: (data: MessagesData) => void) => void;
  removeChatResponseListener: () => void;
  removeMessagesUpdatedListener: () => void;

  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  getActiveTabInfo: () => Promise<TabInfo | null>;

  highlightCitation: (citationText: string) => Promise<HighlightResult>;
  clearCitationHighlights: () => Promise<{ success: boolean; message?: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}
