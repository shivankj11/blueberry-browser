/**
 * Generates JavaScript code for citation highlighting that can be injected
 * into web pages. The code is injected once per page load and exposes a
 * stable `window.__blueberryCitations` API for the main process to call.
 */
export function getInjectionScript(): string {
  return `
    (function() {
      if (window.__blueberryCitations) return;

      const HIGHLIGHT_STYLE_ID = 'blueberry-citation-styles';

      function injectStyles() {
        if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = HIGHLIGHT_STYLE_ID;
        style.textContent = \`
          ::highlight(citation-highlight) {
            background-color: rgba(255, 237, 74, 0.4);
            color: inherit;
          }
        \`;
        document.head.appendChild(style);
      }

      function findTextInDOM(searchText) {
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

        let currentNode;
        let aggregatedText = '';
        const nodeMap = [];
        while (currentNode = walker.nextNode()) {
          const text = currentNode.textContent;
          nodeMap.push({
            node: currentNode,
            startIndex: aggregatedText.length,
            endIndex: aggregatedText.length + text.length
          });
          aggregatedText += text;
        }

        const searchLower = searchText.toLowerCase();
        const textLower = aggregatedText.toLowerCase();
        let startIndex = 0;

        while ((startIndex = textLower.indexOf(searchLower, startIndex)) !== -1) {
          const endIndex = startIndex + searchText.length;
          const range = createRangeFromIndices(nodeMap, startIndex, endIndex);
          if (range) ranges.push(range);
          startIndex = endIndex;
        }

        // Fallback: build a mapping from normalized text indices to original
        // indices so whitespace differences don't prevent matching.
        if (ranges.length === 0) {
          const normToOrig = [];
          let ni = 0;
          let prevWasSpace = true;
          for (let oi = 0; oi < textLower.length; oi++) {
            const ch = textLower[oi];
            const isWS = /\\s/.test(ch);
            if (isWS) {
              if (!prevWasSpace) {
                normToOrig.push(oi);
                ni++;
              }
              prevWasSpace = true;
            } else {
              normToOrig.push(oi);
              ni++;
              prevWasSpace = false;
            }
          }

          const normalizedText = textLower.replace(/\\s+/g, ' ').trimStart();
          const normalizedSearch = searchLower.replace(/\\s+/g, ' ').trim();

          let nsi = 0;
          while ((nsi = normalizedText.indexOf(normalizedSearch, nsi)) !== -1) {
            const nEnd = nsi + normalizedSearch.length - 1;
            if (nsi < normToOrig.length && nEnd < normToOrig.length) {
              const origStart = normToOrig[nsi];
              const origEnd = normToOrig[nEnd] + 1;
              const range = createRangeFromIndices(nodeMap, origStart, origEnd);
              if (range) ranges.push(range);
            }
            nsi = nsi + normalizedSearch.length;
          }
        }

        return ranges;
      }

      function createRangeFromIndices(nodeMap, startIdx, endIdx) {
        let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
        for (const mapping of nodeMap) {
          if (startIdx >= mapping.startIndex && startIdx < mapping.endIndex && !startNode) {
            startNode = mapping.node;
            startOffset = startIdx - mapping.startIndex;
          }
          if (endIdx > mapping.startIndex && endIdx <= mapping.endIndex) {
            endNode = mapping.node;
            endOffset = endIdx - mapping.startIndex;
            break;
          }
        }
        if (startNode && endNode) {
          try {
            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            return range;
          } catch (e) {
            return null;
          }
        }
        return null;
      }

      function highlightRanges(ranges) {
        if (!CSS.highlights) return false;
        CSS.highlights.clear();
        if (ranges.length === 0) return false;
        try {
          const highlight = new Highlight(...ranges);
          CSS.highlights.set('citation-highlight', highlight);
          return true;
        } catch (e) {
          return false;
        }
      }

      function scrollToFirstMatch(ranges) {
        if (ranges.length === 0) return false;
        try {
          const element = ranges[0].startContainer.parentElement;
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      }

      if (CSS.highlights) injectStyles();

      window.__blueberryCitations = {
        searchAndHighlight(citationText) {
          try {
            const ranges = findTextInDOM(citationText);
            if (ranges.length === 0) {
              return { success: false, matchCount: 0, message: 'Text not found in page' };
            }
            const highlighted = highlightRanges(ranges);
            const scrolled = scrollToFirstMatch(ranges);
            return { success: true, matchCount: ranges.length, highlighted, scrolled };
          } catch (error) {
            return { success: false, matchCount: 0, message: error.message };
          }
        },
        clearHighlights() {
          if (CSS.highlights) CSS.highlights.clear();
        }
      };
    })();
  `;
}

export function getSearchAndHighlightCall(citationText: string): string {
  return `window.__blueberryCitations
    ? window.__blueberryCitations.searchAndHighlight(${JSON.stringify(citationText)})
    : { success: false, matchCount: 0, message: 'Citation highlighter not loaded' }`;
}

export function getClearHighlightsCall(): string {
  return `window.__blueberryCitations
    ? (window.__blueberryCitations.clearHighlights(), { success: true })
    : { success: false, message: 'Citation highlighter not loaded' }`;
}
