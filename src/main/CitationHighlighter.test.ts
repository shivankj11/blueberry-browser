import { describe, it, expect, beforeEach } from "vitest";
import {
  getInjectionScript,
  getSearchAndHighlightCall,
  getClearHighlightsCall,
} from "./CitationHighlighter";

// The injection script targets a real DOM. We execute it in jsdom and then
// interact with the `window.__blueberryCitations` API it exposes.

declare global {
  interface Window {
    __blueberryCitations?: {
      searchAndHighlight: (text: string) => {
        success: boolean;
        matchCount: number;
        message?: string;
      };
      clearHighlights: () => void;
    };
  }
}

function injectHighlighter(): void {
  // jsdom does not support CSS.highlights – stub it so the code does not throw.
  if (!(CSS as any).highlights) {
    const store = new Map<string, unknown>();
    (CSS as any).highlights = {
      set: (k: string, v: unknown) => store.set(k, v),
      clear: () => store.clear(),
      delete: (k: string) => store.delete(k),
    };
  }

  // eslint-disable-next-line no-eval
  const script = getInjectionScript();
  const fn = new Function(script);
  fn();
}

function setPageContent(html: string): void {
  document.body.innerHTML = html;
  // Re-inject because body was replaced
  delete (window as any).__blueberryCitations;
  injectHighlighter();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CitationHighlighter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as any).__blueberryCitations;
  });

  // -----------------------------------------------------------------------
  // Module-level API tests
  // -----------------------------------------------------------------------

  describe("getSearchAndHighlightCall", () => {
    it("returns JS that references the global API", () => {
      const js = getSearchAndHighlightCall("hello");
      expect(js).toContain("window.__blueberryCitations");
      expect(js).toContain("hello");
    });

    it("properly escapes special characters in citation text", () => {
      const js = getSearchAndHighlightCall('He said "hello" & <world>');
      expect(js).toContain('\\"hello\\"');
    });
  });

  describe("getClearHighlightsCall", () => {
    it("returns JS that calls clearHighlights", () => {
      const js = getClearHighlightsCall();
      expect(js).toContain("clearHighlights");
    });
  });

  // -----------------------------------------------------------------------
  // Idempotent injection
  // -----------------------------------------------------------------------

  describe("injection", () => {
    it("exposes window.__blueberryCitations after injection", () => {
      setPageContent("<p>Hello</p>");
      expect(window.__blueberryCitations).toBeDefined();
    });

    it("does not overwrite on repeated injection", () => {
      setPageContent("<p>Hello</p>");
      const first = window.__blueberryCitations;
      injectHighlighter();
      expect(window.__blueberryCitations).toBe(first);
    });
  });

  // -----------------------------------------------------------------------
  // Diverse web content scenarios
  // -----------------------------------------------------------------------

  describe("news article page", () => {
    const html = `
      <article>
        <h1>Breaking: Climate Summit Reaches Historic Agreement</h1>
        <p class="byline">By Jane Doe | December 15, 2025</p>
        <p>World leaders gathered in Geneva today to sign a landmark climate
        accord that commits 195 nations to reducing carbon emissions by 50%
        before 2035.</p>
        <p>"This is the most ambitious climate pact in history," said UN
        Secretary-General in a press conference.</p>
        <blockquote>The agreement includes binding targets for all major
        economies, with financial penalties for non-compliance.</blockquote>
        <p>Environmental groups praised the deal while energy lobbyists
        expressed concerns about implementation timelines.</p>
      </article>
    `;

    it("finds exact text in a paragraph", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "landmark climate accord"
      );
      expect(result.success).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it("finds quoted speech", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "most ambitious climate pact in history"
      );
      expect(result.success).toBe(true);
    });

    it("finds text inside blockquote", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "binding targets for all major economies"
      );
      expect(result.success).toBe(true);
    });

    it("reports not found for absent text", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "this text does not exist anywhere on the page"
      );
      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(0);
    });
  });

  describe("Wikipedia-style page", () => {
    const html = `
      <div id="content">
        <h1>Photosynthesis</h1>
        <p><b>Photosynthesis</b> is a biological process used by many cellular
        organisms to convert <a href="/wiki/Light_energy">light energy</a> into
        chemical energy.</p>
        <h2>Overview</h2>
        <p>The overall equation for photosynthesis is:</p>
        <p class="equation">6CO<sub>2</sub> + 6H<sub>2</sub>O &rarr;
        C<sub>6</sub>H<sub>12</sub>O<sub>6</sub> + 6O<sub>2</sub></p>
        <h2>History</h2>
        <p>Jan Ingenhousz discovered in 1779 that green plants in sunlight
        absorb carbon dioxide and release oxygen.</p>
        <table>
          <tr><th>Year</th><th>Scientist</th><th>Discovery</th></tr>
          <tr><td>1779</td><td>Ingenhousz</td><td>Plant gas exchange</td></tr>
          <tr><td>1845</td><td>von Mayer</td><td>Energy conservation</td></tr>
          <tr><td>1932</td><td>Emerson</td><td>Quantum yield</td></tr>
        </table>
      </div>
    `;

    it("finds text spanning across inline elements (bold + link)", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "Photosynthesis is a biological process"
      );
      expect(result.success).toBe(true);
    });

    it("finds text in table cells", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "Energy conservation"
      );
      expect(result.success).toBe(true);
    });

    it("finds text with subscript elements (cross-element search)", () => {
      setPageContent(html);
      // The raw text is aggregated as "6CO2 + 6H2O" (subscripts become inline text)
      const result = window.__blueberryCitations!.searchAndHighlight("6CO2");
      expect(result.success).toBe(true);
    });

    it("finds historical fact", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "Jan Ingenhousz discovered in 1779"
      );
      expect(result.success).toBe(true);
    });
  });

  describe("e-commerce product page", () => {
    const html = `
      <div class="product-page">
        <h1 class="product-title">Ultra HD 4K Monitor - 32 inch</h1>
        <div class="price">$599.99</div>
        <div class="rating">★★★★☆ (4.2 out of 5 stars)</div>
        <ul class="features">
          <li>3840 x 2160 resolution</li>
          <li>HDR10 and Dolby Vision support</li>
          <li>USB-C with 90W power delivery</li>
          <li>Response time: 1ms (GtG)</li>
        </ul>
        <div class="description">
          <p>Experience stunning visual clarity with our flagship 32-inch 4K
          monitor. Designed for professionals and gamers alike, it features
          true-to-life colors with 99% sRGB coverage.</p>
        </div>
        <div class="reviews">
          <div class="review">
            <p class="review-author">JohnD - Verified Purchase</p>
            <p>Best monitor I've ever owned. Colors are amazing and the USB-C
            connectivity is a game changer for my MacBook setup.</p>
          </div>
        </div>
      </div>
    `;

    it("finds product specifications in list items", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "3840 x 2160 resolution"
      );
      expect(result.success).toBe(true);
    });

    it("finds price text", () => {
      setPageContent(html);
      const result =
        window.__blueberryCitations!.searchAndHighlight("$599.99");
      expect(result.success).toBe(true);
    });

    it("finds review text", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "Colors are amazing and the USB-C connectivity is a game changer"
      );
      expect(result.success).toBe(true);
    });

    it("finds text with special characters in feature list", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "USB-C with 90W power delivery"
      );
      expect(result.success).toBe(true);
    });
  });

  describe("forum / discussion thread page", () => {
    const html = `
      <div class="thread">
        <div class="post" id="p1">
          <div class="post-header">
            <span class="username">dev_guru42</span>
            <span class="timestamp">2 hours ago</span>
          </div>
          <div class="post-body">
            <p>Has anyone benchmarked the new React 19 concurrent features?
            I'm seeing a 40% improvement in rendering performance on our
            dashboard component.</p>
          </div>
        </div>
        <div class="post" id="p2">
          <div class="post-header">
            <span class="username">code_ninja</span>
            <span class="timestamp">1 hour ago</span>
          </div>
          <div class="post-body">
            <p>@dev_guru42 Interesting! We measured similar gains. The key was
            using <code>useTransition</code> for heavy state updates.
            Make sure you're NOT wrapping everything in
            <code>startTransition</code> though — it can actually hurt
            performance for simple updates.</p>
          </div>
        </div>
        <div class="post" id="p3">
          <div class="post-header">
            <span class="username">webdev_jane</span>
            <span class="timestamp">30 minutes ago</span>
          </div>
          <div class="post-body">
            <p>Pro tip: combine <code>useDeferredValue</code> with
            <code>React.memo</code> for list rendering. We went from 200ms to
            under 50ms for our 10,000-row table.</p>
          </div>
        </div>
      </div>
    `;

    it("finds text within inline code elements", () => {
      setPageContent(html);
      // The aggregated text will contain "useTransition" as inline text
      const result =
        window.__blueberryCitations!.searchAndHighlight("useTransition");
      expect(result.success).toBe(true);
    });

    it("finds text spanning across code and regular text", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "useDeferredValue with React.memo"
      );
      expect(result.success).toBe(true);
    });

    it("finds user-specific reply content", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "40% improvement in rendering performance"
      );
      expect(result.success).toBe(true);
    });

    it("finds performance measurement data", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "200ms to under 50ms"
      );
      expect(result.success).toBe(true);
    });
  });

  describe("documentation / API reference page", () => {
    const html = `
      <div class="docs">
        <h1>API Reference: <code>fetch()</code></h1>
        <div class="method-signature">
          <pre><code>fetch(input: RequestInfo, init?: RequestInit): Promise&lt;Response&gt;</code></pre>
        </div>
        <h2>Parameters</h2>
        <dl>
          <dt><code>input</code></dt>
          <dd>A string URL or a <code>Request</code> object defining the
          resource to fetch.</dd>
          <dt><code>init</code> (optional)</dt>
          <dd>An object containing request settings: method, headers, body,
          mode, credentials, cache, redirect, referrer, and integrity.</dd>
        </dl>
        <h2>Return Value</h2>
        <p>A <code>Promise</code> that resolves to a <code>Response</code>
        object. The promise does <strong>not</strong> reject on HTTP error
        status codes (404, 500, etc). Instead, check the
        <code>ok</code> property or <code>status</code> code.</p>
        <div class="note">
          <strong>Note:</strong> A fetch() promise only rejects when a network
          error is encountered (such as a permissions issue or DNS lookup
          failure).
        </div>
      </div>
    `;

    it("finds text in definition description (dd element)", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "method, headers, body, mode, credentials"
      );
      expect(result.success).toBe(true);
    });

    it("finds text in note block with bold", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "fetch() promise only rejects when a network error"
      );
      expect(result.success).toBe(true);
    });

    it("finds text spanning code and regular text in a paragraph", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "Promise that resolves to a Response object"
      );
      expect(result.success).toBe(true);
    });
  });

  describe("page with hidden elements", () => {
    const html = `
      <div>
        <p>This text is visible.</p>
        <div style="display:none">
          <p>This text is hidden via display none.</p>
        </div>
        <div style="visibility:hidden">
          <p>This text is hidden via visibility.</p>
        </div>
        <script>var secret = "do not find me";</script>
        <style>.hidden { display: none; }</style>
        <noscript>Enable JavaScript to use this site.</noscript>
        <p>Another visible paragraph with important data.</p>
      </div>
    `;

    it("finds visible text", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "This text is visible"
      );
      expect(result.success).toBe(true);
    });

    it("does not match text inside script tags", () => {
      setPageContent(html);
      const result =
        window.__blueberryCitations!.searchAndHighlight("do not find me");
      expect(result.success).toBe(false);
    });

    it("does not match text inside noscript tags", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "Enable JavaScript to use this site"
      );
      expect(result.success).toBe(false);
    });
  });

  describe("whitespace normalization", () => {
    const html = `
      <div>
        <p>This   has    extra   whitespace   between    words.</p>
        <p>Text that
        spans multiple
        lines in the source.</p>
      </div>
    `;

    it("matches with normalized whitespace when exact match fails", () => {
      setPageContent(html);
      // The citation text has single spaces, but the page has multiple
      const result = window.__blueberryCitations!.searchAndHighlight(
        "This has extra whitespace between words"
      );
      // Should find via normalized whitespace fallback or exact match
      // (jsdom may normalize whitespace in innerText)
      expect(result.success).toBe(true);
    });
  });

  describe("multiple matches", () => {
    const html = `
      <div>
        <p>React is a JavaScript library. React makes UI development easy.
        Many companies use React for their web applications.</p>
      </div>
    `;

    it("finds all occurrences of repeated text", () => {
      setPageContent(html);
      const result =
        window.__blueberryCitations!.searchAndHighlight("React");
      expect(result.success).toBe(true);
      expect(result.matchCount).toBe(3);
    });
  });

  describe("case insensitive matching", () => {
    const html = `
      <div>
        <h1>TypeScript Handbook</h1>
        <p>TYPESCRIPT is a strongly typed programming language that builds on
        JavaScript.</p>
      </div>
    `;

    it("matches regardless of case", () => {
      setPageContent(html);
      const result =
        window.__blueberryCitations!.searchAndHighlight("typescript");
      expect(result.success).toBe(true);
      expect(result.matchCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("clearHighlights", () => {
    it("clears without error when nothing is highlighted", () => {
      setPageContent("<p>Hello</p>");
      expect(() =>
        window.__blueberryCitations!.clearHighlights()
      ).not.toThrow();
    });

    it("clears after a highlight was set", () => {
      setPageContent("<p>Hello world</p>");
      window.__blueberryCitations!.searchAndHighlight("Hello");
      expect(() =>
        window.__blueberryCitations!.clearHighlights()
      ).not.toThrow();
    });
  });

  describe("deeply nested DOM structures", () => {
    const html = `
      <div class="wrapper">
        <div class="container">
          <section>
            <article>
              <div class="content">
                <span class="intro">
                  <em>The <strong>quick <a href="#">brown fox</a></strong>
                  jumps</em> over the <mark>lazy</mark> dog.
                </span>
              </div>
            </article>
          </section>
        </div>
      </div>
    `;

    it("finds text spanning many nested inline elements", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "quick brown fox jumps over the lazy dog"
      );
      expect(result.success).toBe(true);
    });
  });

  describe("internationalized content", () => {
    const html = `
      <div>
        <p>日本語のテキストを検索します。</p>
        <p>Ñoño está en español con acentos: café, résumé, naïve.</p>
        <p>Emoji content: The rating is 🌟🌟🌟🌟🌟 five stars!</p>
      </div>
    `;

    it("finds Japanese text", () => {
      setPageContent(html);
      const result =
        window.__blueberryCitations!.searchAndHighlight("テキストを検索");
      expect(result.success).toBe(true);
    });

    it("finds text with accented characters", () => {
      setPageContent(html);
      const result =
        window.__blueberryCitations!.searchAndHighlight("café, résumé, naïve");
      expect(result.success).toBe(true);
    });

    it("finds text around emoji", () => {
      setPageContent(html);
      const result = window.__blueberryCitations!.searchAndHighlight(
        "five stars"
      );
      expect(result.success).toBe(true);
    });
  });
});
