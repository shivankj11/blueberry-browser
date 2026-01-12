import { ipcMain, WebContents } from "electron";
import type { Window } from "./Window";

export class EventManager {
  private mainWindow: Window;

  constructor(mainWindow: Window) {
    this.mainWindow = mainWindow;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Tab management events
    this.handleTabEvents();

    // Sidebar events
    this.handleSidebarEvents();

    // Page content events
    this.handlePageContentEvents();

    // Dark mode events
    this.handleDarkModeEvents();

    // Debug events
    this.handleDebugEvents();
  }

  private handleTabEvents(): void {
    // Create new tab
    ipcMain.handle("create-tab", (_, url?: string) => {
      const newTab = this.mainWindow.createTab(url);
      return { id: newTab.id, title: newTab.title, url: newTab.url };
    });

    // Close tab
    ipcMain.handle("close-tab", (_, id: string) => {
      this.mainWindow.closeTab(id);
    });

    // Switch tab
    ipcMain.handle("switch-tab", (_, id: string) => {
      this.mainWindow.switchActiveTab(id);
    });

    // Get tabs
    ipcMain.handle("get-tabs", () => {
      const activeTabId = this.mainWindow.activeTab?.id;
      return this.mainWindow.allTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: activeTabId === tab.id,
      }));
    });

    // Navigation (for compatibility with existing code)
    ipcMain.handle("navigate-to", (_, url: string) => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.loadURL(url);
      }
    });

    ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        await tab.loadURL(url);
        return true;
      }
      return false;
    });

    ipcMain.handle("go-back", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goBack();
      }
    });

    ipcMain.handle("go-forward", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goForward();
      }
    });

    ipcMain.handle("reload", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.reload();
      }
    });

    // Tab-specific navigation handlers
    ipcMain.handle("tab-go-back", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-go-forward", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-reload", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.reload();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-screenshot", async (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        const image = await tab.screenshot();
        return image.toDataURL();
      }
      return null;
    });

    ipcMain.handle("tab-run-js", async (_, tabId: string, code: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        return await tab.runJs(code);
      }
      return null;
    });

    // Tab info
    ipcMain.handle("get-active-tab-info", () => {
      const activeTab = this.mainWindow.activeTab;
      if (activeTab) {
        return {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          canGoBack: activeTab.webContents.canGoBack(),
          canGoForward: activeTab.webContents.canGoForward(),
        };
      }
      return null;
    });
  }

  private handleSidebarEvents(): void {
    // Toggle sidebar
    ipcMain.handle("toggle-sidebar", () => {
      this.mainWindow.sidebar.toggle();
      this.mainWindow.updateAllBounds();
      return true;
    });

    // Chat message
    ipcMain.handle("sidebar-chat-message", async (_, request) => {
      // The LLMClient now handles getting the screenshot and context directly
      await this.mainWindow.sidebar.client.sendChatMessage(request);
    });

    // Clear chat
    ipcMain.handle("sidebar-clear-chat", () => {
      this.mainWindow.sidebar.client.clearMessages();
      return true;
    });

    // Get messages
    ipcMain.handle("sidebar-get-messages", () => {
      const messages = this.mainWindow.sidebar.client.getMessages();
      const citationsMap = this.mainWindow.sidebar.client.getCitations();

      // Convert citations map to a plain object for JSON serialization
      const citationsObj: Record<number, any[]> = {};
      citationsMap.forEach((value, key) => {
        citationsObj[key] = value;
      });

      return {
        messages,
        citations: citationsObj,
      };
    });
  }

  private handlePageContentEvents(): void {
    // Get page content
    ipcMain.handle("get-page-content", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabHtml();
        } catch (error) {
          console.error("Error getting page content:", error);
          return null;
        }
      }
      return null;
    });

    // Get page text
    ipcMain.handle("get-page-text", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabText();
        } catch (error) {
          console.error("Error getting page text:", error);
          return null;
        }
      }
      return null;
    });

    // Get current URL
    ipcMain.handle("get-current-url", () => {
      if (this.mainWindow.activeTab) {
        return this.mainWindow.activeTab.url;
      }
      return null;
    });

    // Highlight citation in page
    ipcMain.handle("highlight-citation", async (_, citationText: string) => {
      if (this.mainWindow.activeTab) {
        try {
          const result = await this.mainWindow.activeTab.runJs(`
            (function() {
              ${this.getCitationHighlighterCode()}
              return CitationHighlighter.searchAndHighlight(${JSON.stringify(citationText)});
            })();
          `);

          return result;
        } catch (error) {
          console.error("Error highlighting citation:", error);
          return { success: false, matchCount: 0, message: String(error) };
        }
      }
      return { success: false, matchCount: 0, message: "No active tab" };
    });

    // Clear citation highlights
    ipcMain.handle("clear-citation-highlights", async () => {
      if (this.mainWindow.activeTab) {
        try {
          await this.mainWindow.activeTab.runJs(`
            (function() {
              ${this.getCitationHighlighterCode()}
              CitationHighlighter.clearHighlights();
            })();
          `);

          return { success: true };
        } catch (error) {
          console.error("Error clearing highlights:", error);
          return { success: false, message: String(error) };
        }
      }
      return { success: false, message: "No active tab" };
    });
  }

  private getCitationHighlighterCode(): string {
    return `
      const CitationHighlighter = {
        findTextInDOM(searchText) {
          const ranges = [];
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;

                const style = window.getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') {
                  return NodeFilter.FILTER_REJECT;
                }

                if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
                  return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );

          let currentNode, aggregatedText = '', nodeMap = [];
          while (currentNode = walker.nextNode()) {
            const text = currentNode.textContent;
            nodeMap.push({
              node: currentNode,
              startIndex: aggregatedText.length,
              endIndex: aggregatedText.length + text.length
            });
            aggregatedText += text;
          }

          console.log('[Citation] Total aggregated text length:', aggregatedText.length);
          console.log('[Citation] Search text:', searchText);
          console.log('[Citation] Search text length:', searchText.length);

          // Try exact match first
          const searchLower = searchText.toLowerCase();
          const textLower = aggregatedText.toLowerCase();
          let startIndex = 0;

          while ((startIndex = textLower.indexOf(searchLower, startIndex)) !== -1) {
            console.log('[Citation] Found match at index:', startIndex);
            const endIndex = startIndex + searchText.length;
            const range = this.createRangeFromIndices(nodeMap, startIndex, endIndex);
            if (range) {
              console.log('[Citation] Created range successfully');
              ranges.push(range);
            } else {
              console.log('[Citation] Failed to create range');
            }
            startIndex = endIndex;
          }

          // If no exact match, try with normalized whitespace
          if (ranges.length === 0) {
            console.log('[Citation] No exact match, trying normalized whitespace...');
            const normalizeWS = (str) => str.replace(/\s+/g, ' ').trim();
            const searchNorm = normalizeWS(searchLower);
            const textNorm = normalizeWS(textLower);

            const normIndex = textNorm.indexOf(searchNorm);
            if (normIndex !== -1) {
              console.log('[Citation] Found normalized match at index:', normIndex);
              // This is tricky - for now just try finding a substring
              const snippet = searchText.substring(0, Math.min(20, searchText.length));
              const snippetIndex = textLower.indexOf(snippet.toLowerCase());
              if (snippetIndex !== -1) {
                console.log('[Citation] Found snippet match at:', snippetIndex);
                const range = this.createRangeFromIndices(nodeMap, snippetIndex, snippetIndex + snippet.length);
                if (range) ranges.push(range);
              }
            }
          }

          return ranges;
        },

        createRangeFromIndices(nodeMap, startIdx, endIdx) {
          let startNode = null, startOffset = 0, endNode = null, endOffset = 0;

          console.log('[Citation] Creating range for indices:', startIdx, '-', endIdx);

          for (const mapping of nodeMap) {
            if (startIdx >= mapping.startIndex && startIdx < mapping.endIndex && !startNode) {
              startNode = mapping.node;
              startOffset = startIdx - mapping.startIndex;
              console.log('[Citation] Found start node, offset:', startOffset);
            }
            if (endIdx > mapping.startIndex && endIdx <= mapping.endIndex) {
              endNode = mapping.node;
              endOffset = endIdx - mapping.startIndex;
              console.log('[Citation] Found end node, offset:', endOffset);
              break;
            }
          }

          if (startNode && endNode) {
            try {
              const range = document.createRange();
              range.setStart(startNode, startOffset);
              range.setEnd(endNode, endOffset);
              console.log('[Citation] Range created successfully');
              return range;
            } catch (e) {
              console.error('[Citation] Error creating range:', e);
              return null;
            }
          }
          console.log('[Citation] Could not find start/end nodes');
          return null;
        },

        highlightRanges(ranges) {
          console.log('[Citation] highlightRanges called with', ranges.length, 'ranges');

          if (!CSS.highlights) {
            console.error('[Citation] CSS.highlights API not supported!');
            return false;
          }

          CSS.highlights.clear();
          console.log('[Citation] Cleared previous highlights');

          if (ranges.length === 0) {
            console.log('[Citation] No ranges to highlight');
            return false;
          }

          try {
            const highlight = new Highlight(...ranges);
            CSS.highlights.set('citation-highlight', highlight);
            console.log('[Citation] Highlight set successfully');
            return true;
          } catch (e) {
            console.error('[Citation] Error setting highlight:', e);
            return false;
          }
        },

        scrollToFirstMatch(ranges) {
          console.log('[Citation] scrollToFirstMatch called with', ranges.length, 'ranges');

          if (ranges.length === 0) {
            console.log('[Citation] No ranges to scroll to');
            return false;
          }

          try {
            const element = ranges[0].startContainer.parentElement;
            console.log('[Citation] Found element to scroll to:', element?.tagName);

            if (element) {
              element.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
              });
              console.log('[Citation] Scrolled to element');
              return true;
            }
            console.log('[Citation] No parent element found');
            return false;
          } catch (e) {
            console.error('[Citation] Error scrolling:', e);
            return false;
          }
        },

        searchAndHighlight(citationText) {
          try {
            console.log('[Citation] Searching for:', citationText);
            console.log('[Citation] CSS.highlights supported:', !!CSS.highlights);

            const ranges = this.findTextInDOM(citationText);
            console.log('[Citation] Found ranges:', ranges.length);

            if (ranges.length === 0) {
              // Try to show what text IS available
              const bodyText = document.body.innerText.substring(0, 500);
              console.log('[Citation] First 500 chars of page:', bodyText);
              return { success: false, matchCount: 0, message: 'Text not found in page' };
            }

            const highlighted = this.highlightRanges(ranges);
            console.log('[Citation] Highlighted:', highlighted);

            const scrolled = this.scrollToFirstMatch(ranges);
            console.log('[Citation] Scrolled:', scrolled);

            return { success: true, matchCount: ranges.length, highlighted, scrolled };
          } catch (error) {
            console.error('[Citation] Error:', error);
            return { success: false, matchCount: 0, message: error.message };
          }
        },

        clearHighlights() {
          if (CSS.highlights) CSS.highlights.clear();
        }
      };

      if (CSS.highlights && !document.getElementById('blueberry-citation-styles')) {
        const style = document.createElement('style');
        style.id = 'blueberry-citation-styles';
        style.textContent = \`
          ::highlight(citation-highlight) {
            background-color: rgba(255, 237, 74, 0.4);
            color: inherit;
          }
        \`;
        document.head.appendChild(style);
      }

      CitationHighlighter;
    `;
  }

  private handleDarkModeEvents(): void {
    // Dark mode broadcasting
    ipcMain.on("dark-mode-changed", (event, isDarkMode) => {
      this.broadcastDarkMode(event.sender, isDarkMode);
    });
  }

  private handleDebugEvents(): void {
    // Ping test
    ipcMain.on("ping", () => console.log("pong"));
  }

  private broadcastDarkMode(sender: WebContents, isDarkMode: boolean): void {
    // Send to topbar
    if (this.mainWindow.topBar.view.webContents !== sender) {
      this.mainWindow.topBar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode
      );
    }

    // Send to sidebar
    if (this.mainWindow.sidebar.view.webContents !== sender) {
      this.mainWindow.sidebar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode
      );
    }

    // Send to all tabs
    this.mainWindow.allTabs.forEach((tab) => {
      if (tab.webContents !== sender) {
        tab.webContents.send("dark-mode-updated", isDarkMode);
      }
    });
  }

  // Clean up event listeners
  public cleanup(): void {
    ipcMain.removeAllListeners();
  }
}
