import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ArrowUp, Plus } from "lucide-react";
import { useChat } from "../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { Button } from "@common/components/Button";

interface Citation {
  index: number;
  text: string;
  source: "screenshot" | "page_content" | "url";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  citations?: Citation[];
}

const useAutoScroll = (messages: Message[]) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);

  useLayoutEffect(() => {
    if (messages.length > prevCount.current) {
      setTimeout(() => {
        scrollRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }, 100);
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  return scrollRef;
};

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="relative max-w-[85%] ml-auto animate-fade-in">
    <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
      <div className="text-foreground" style={{ whiteSpace: "pre-wrap" }}>
        {content}
      </div>
    </div>
  </div>
);

const StreamingText: React.FC<{ content: string }> = ({ content }) => {
  const [displayedContent, setDisplayedContent] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < content.length) {
      const timer = setTimeout(() => {
        setDisplayedContent(content.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [content, currentIndex]);

  return (
    <div className="whitespace-pre-wrap text-foreground">
      {displayedContent}
      {currentIndex < content.length && (
        <span className="inline-block w-2 h-5 bg-primary/60 dark:bg-primary/40 ml-0.5 animate-pulse" />
      )}
    </div>
  );
};

const CitationMarker: React.FC<{
  index: number;
  citation: Citation | undefined;
}> = ({ index, citation }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isHighlighting, setIsHighlighting] = useState(false);

  const handleClick = async () => {
    if (!citation) return;
    setIsHighlighting(true);
    try {
      const result = await window.sidebarAPI.highlightCitation(citation.text);
      if (!result.success) {
        console.warn("Citation not found in page:", result.message);
      }
    } catch (error) {
      console.error("Error highlighting citation:", error);
    } finally {
      setIsHighlighting(false);
    }
  };

  const truncateText = (text: string, maxWords: number = 20): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + "...";
  };

  return (
    <span className="relative inline-block">
      <span
        className={cn(
          "inline-flex items-center justify-center",
          "w-5 h-5 rounded-full text-[10px] font-semibold",
          "bg-primary/15 text-primary cursor-pointer",
          "hover:bg-primary/25 transition-colors align-super",
          isHighlighting && "opacity-50",
        )}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={handleClick}
      >
        {index}
      </span>
      {isVisible && citation && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2
                              bg-popover text-popover-foreground text-xs rounded-lg shadow-lg
                              border border-border max-w-xs whitespace-normal z-50 animate-fade-in"
        >
          <div className="mb-1 text-xs text-muted-foreground">
            Click to highlight in page ({citation.source.replace("_", " ")})
          </div>
          {truncateText(citation.text)}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-px
                                  border-4 border-transparent border-t-popover"
          />
        </div>
      )}
    </span>
  );
};

const renderTextWithCitations = (
  text: string,
  citations: Citation[] | undefined,
): React.ReactNode[] => {
  const parts = text.split(/\[(\d+)\]/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const idx = parseInt(part);
        const citation = citations?.find((c) => c.index === idx);
        return (
          <CitationMarker key={`cite-${i}`} index={idx} citation={citation} />
        );
      }
      return part ? (
        <React.Fragment key={`text-${i}`}>{part}</React.Fragment>
      ) : null;
    })
    .filter(Boolean) as React.ReactNode[];
};

const processReactChildren = (
  children: React.ReactNode,
  citations: Citation[] | undefined,
): React.ReactNode => {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      if (/\[\d+\]/.test(child)) {
        return <>{renderTextWithCitations(child, citations)}</>;
      }
      return child;
    }
    if (React.isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      if (props.children) {
        return React.cloneElement(
          child as React.ReactElement<any>,
          {},
          processReactChildren(props.children as React.ReactNode, citations),
        );
      }
    }
    return child;
  });
};

const Markdown: React.FC<{ content: string; citations?: Citation[] }> = ({
  content,
  citations,
}) => (
  <div
    className="prose prose-sm dark:prose-invert max-w-none
                    prose-headings:text-foreground prose-p:text-foreground
                    prose-strong:text-foreground prose-ul:text-foreground
                    prose-ol:text-foreground prose-li:text-foreground
                    prose-a:text-primary hover:prose-a:underline
                    prose-code:bg-muted prose-code:px-1 prose-code:py-0.5
                    prose-code:rounded prose-code:text-sm prose-code:text-foreground
                    prose-pre:bg-muted dark:prose-pre:bg-muted/50 prose-pre:p-3
                    prose-pre:rounded-lg prose-pre:overflow-x-auto"
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        code: ({ className, children, ...props }) => {
          const inline = !className;
          return inline ? (
            <code
              className="bg-muted dark:bg-muted/50 px-1 py-0.5 rounded text-sm text-foreground"
              {...props}
            >
              {children}
            </code>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        a: ({ children, href }) => (
          <a
            href={href}
            className="text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        p: ({ children }) => <p>{processReactChildren(children, citations)}</p>,
        li: ({ children, ...props }) => (
          <li {...props}>{processReactChildren(children, citations)}</li>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const CitationRefList: React.FC<{ citations: Citation[] }> = ({
  citations,
}) => {
  const [highlightingIndex, setHighlightingIndex] = useState<number | null>(
    null,
  );

  const handleClick = async (citation: Citation) => {
    setHighlightingIndex(citation.index);
    try {
      await window.sidebarAPI.highlightCitation(citation.text);
    } catch (error) {
      console.error("Error highlighting citation:", error);
    } finally {
      setHighlightingIndex(null);
    }
  };

  const truncateText = (text: string, maxWords: number = 12): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + "...";
  };

  return (
    <div className="mt-3 pt-2 border-t border-border/50">
      <div className="text-xs text-muted-foreground mb-1.5">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <button
            key={citation.index}
            onClick={() => handleClick(citation)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
              "text-xs bg-muted/60 hover:bg-muted text-foreground/80",
              "transition-colors cursor-pointer border border-border/30",
              highlightingIndex === citation.index && "opacity-50",
            )}
          >
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
              {citation.index}
            </span>
            <span className="truncate max-w-[200px]">
              {truncateText(citation.text)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

const AssistantMessage: React.FC<{
  content: string;
  isStreaming?: boolean;
  citations?: Citation[];
}> = ({ content, isStreaming, citations }) => (
  <div className="relative w-full animate-fade-in">
    <div className="py-1">
      {isStreaming ? (
        <StreamingText content={content} />
      ) : (
        <>
          <Markdown content={content} citations={citations} />
          {citations && citations.length > 0 && (
            <CitationRefList citations={citations} />
          )}
        </>
      )}
    </div>
  </div>
);

const LoadingIndicator: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div
      className={cn(
        "transition-transform duration-300 ease-in-out",
        isVisible ? "scale-100" : "scale-0",
      )}
    >
      ...
    </div>
  );
};

const ChatInput: React.FC<{
  onSend: (message: string) => void;
  disabled: boolean;
}> = ({ onSend, disabled }) => {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(scrollHeight, 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "24px";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={cn(
        "w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
        "shadow-chat animate-spring-scale outline-none transition-all duration-200",
        isFocused
          ? "border-primary/20 dark:border-primary/30"
          : "border-border",
      )}
    >
      <div className="w-full px-3 py-2">
        <div className="w-full flex items-start gap-3">
          <div className="relative flex-1 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              className="w-full resize-none outline-none bg-transparent
                                     text-foreground placeholder:text-muted-foreground
                                     min-h-[24px] max-h-[200px]"
              rows={1}
              style={{ lineHeight: "24px" }}
            />
          </div>
        </div>
      </div>
      <div className="w-full flex items-center gap-1.5 px-1 mt-2 mb-1">
        <div className="flex-1" />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "size-9 rounded-full flex items-center justify-center",
            "transition-all duration-200",
            "bg-primary text-primary-foreground",
            "hover:opacity-80 disabled:opacity-50",
          )}
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </div>
  );
};

interface ConversationTurn {
  user?: Message;
  assistant?: Message;
}

const ConversationTurnComponent: React.FC<{
  turn: ConversationTurn;
  isLoading?: boolean;
}> = ({ turn, isLoading }) => (
  <div className="pt-12 flex flex-col gap-8">
    {turn.user && <UserMessage content={turn.user.content} />}
    {turn.assistant && (
      <AssistantMessage
        content={turn.assistant.content}
        isStreaming={turn.assistant.isStreaming}
        citations={turn.assistant.citations}
      />
    )}
    {isLoading && (
      <div className="flex justify-start">
        <LoadingIndicator />
      </div>
    )}
  </div>
);

export const Chat: React.FC = () => {
  const { messages, isLoading, sendMessage, clearChat } = useChat();
  const scrollRef = useAutoScroll(messages);

  const conversationTurns: ConversationTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const turn: ConversationTurn = { user: messages[i] };
      if (messages[i + 1]?.role === "assistant") {
        turn.assistant = messages[i + 1];
        i++;
      }
      conversationTurns.push(turn);
    } else if (
      messages[i].role === "assistant" &&
      (i === 0 || messages[i - 1]?.role !== "user")
    ) {
      conversationTurns.push({ assistant: messages[i] });
    }
  }

  const showLoadingAfterLastTurn =
    isLoading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="h-8 max-w-3xl mx-auto px-4">
          {messages.length > 0 && (
            <Button onClick={clearChat} title="Start new chat" variant="ghost">
              <Plus className="size-4" />
              New Chat
            </Button>
          )}
        </div>
        <div className="pb-4 relative max-w-3xl mx-auto px-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col">
                <h3 className="text-2xl font-bold">🫐</h3>
                <p className="text-muted-foreground text-sm">
                  Press ⌘E to toggle the sidebar
                </p>
              </div>
            </div>
          ) : (
            <>
              {conversationTurns.map((turn, index) => (
                <ConversationTurnComponent
                  key={`turn-${index}`}
                  turn={turn}
                  isLoading={
                    showLoadingAfterLastTurn &&
                    index === conversationTurns.length - 1
                  }
                />
              ))}
            </>
          )}
          <div ref={scrollRef} />
        </div>
      </div>
      <div className="p-4">
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </div>
    </div>
  );
};
