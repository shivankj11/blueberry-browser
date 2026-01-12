import { ElectronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
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

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: ChatRequest) => Promise<void>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  removeChatResponseListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;

  // Citation highlighting
  highlightCitation: (citationText: string) => Promise<HighlightResult>;
  clearCitationHighlights: () => Promise<{ success: boolean; message?: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}

