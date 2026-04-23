import React, { useRef, useEffect, useState, useCallback } from "react";
import { ArrowUp, Square, Plus, Mic, MicOff, Link, HardDrive, Youtube, AtSign, FileUp, Cloud, BookOpen, X, Sparkles, Search as SearchIcon, BarChart3, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/workspace-context";

interface PromptCategory {
  label: string;
  icon: React.ReactNode;
  prompts: string[];
}

const ECOM_CATEGORIES: PromptCategory[] = [
  {
    label: "Diagnostics",
    icon: <SearchIcon className="w-3 h-3" />,
    prompts: [
      "Run PMax X-Ray diagnostic",
      "POAS analysis — last 7 days",
      "Audit conversion tracking setup",
    ],
  },
  {
    label: "Optimization",
    icon: <Zap className="w-3 h-3" />,
    prompts: [
      "Find out-of-stock SKUs with active ads",
      "Identify low-ROAS campaigns to pause",
      "Recommend budget reallocation across campaigns",
    ],
  },
  {
    label: "Reporting",
    icon: <BarChart3 className="w-3 h-3" />,
    prompts: [
      "Generate weekly PDF report",
      "Compare this week vs last week performance",
      "Summarize top 5 campaigns by ROAS",
    ],
  },
];

const LEADGEN_CATEGORIES: PromptCategory[] = [
  {
    label: "Diagnostics",
    icon: <SearchIcon className="w-3 h-3" />,
    prompts: [
      "Pipeline quality triage",
      "Audit blended CAC — last 30 days",
      "Identify attribution gaps across channels",
    ],
  },
  {
    label: "Optimization",
    icon: <Zap className="w-3 h-3" />,
    prompts: [
      "Flag zero-conversion campaigns",
      "Compare CPL across all channels",
      "Recommend lead-to-MQL conversion improvements",
    ],
  },
  {
    label: "Reporting",
    icon: <BarChart3 className="w-3 h-3" />,
    prompts: [
      "Generate pipeline velocity report",
      "Summarize cost per qualified lead by source",
      "Week-over-week lead volume comparison",
    ],
  },
];

const HYBRID_CATEGORIES: PromptCategory[] = [
  {
    label: "Diagnostics",
    icon: <SearchIcon className="w-3 h-3" />,
    prompts: [
      "Cross-funnel POAS vs CAC analysis",
      "Unified attribution check",
      "Flag campaigns with no revenue AND no pipeline",
    ],
  },
  {
    label: "Optimization",
    icon: <Zap className="w-3 h-3" />,
    prompts: [
      "Dual-funnel budget allocation review",
      "Identify underperforming channels across both funnels",
      "Recommend spend shifts between e-com and lead gen",
    ],
  },
  {
    label: "Reporting",
    icon: <BarChart3 className="w-3 h-3" />,
    prompts: [
      "Top channels by total contribution margin",
      "Combined e-com + pipeline weekly summary",
      "Compare blended ROAS and pipeline velocity trends",
    ],
  },
];

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  prefillValue?: string;
  onPrefillConsumed?: () => void;
}

// Web Speech API: not in lib.dom by default in this TS version. Minimal
// ambient stubs so we can typecheck without pulling in @types/dom-speech-recognition.
declare global {
  interface SpeechRecognitionEventLike {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
  }
  interface SpeechRecognition extends EventTarget {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((e: SpeechRecognitionEventLike) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start(): void;
    stop(): void;
  }
  type SpeechRecognitionEvent = SpeechRecognitionEventLike;
  interface Window {
    webkitSpeechRecognition: new () => SpeechRecognition;
    SpeechRecognition: new () => SpeechRecognition;
  }
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, prefillValue, onPrefillConsumed }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  // Polite announcement for screen-reader users when the assistant
  // starts/stops streaming. The streamed tokens themselves are exposed
  // via a separate role="log" region in the chat thread.
  const [streamStatus, setStreamStatus] = useState("");
  const prevStreaming = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      setStreamStatus("Assistant is responding");
    } else if (!isStreaming && prevStreaming.current) {
      setStreamStatus("Response complete");
    }
    prevStreaming.current = !!isStreaming;
  }, [isStreaming]);
  const { activeWorkspace } = useWorkspace();
  const goal = activeWorkspace?.primaryGoal;
  const promptCategories = goal === "hybrid" ? HYBRID_CATEGORIES : goal === "leadgen" ? LEADGEN_CATEGORIES : ECOM_CATEGORIES;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (prefillValue) {
      setInput(prefillValue);
      textareaRef.current?.focus();
      onPrefillConsumed?.();
    }
  }, [prefillValue, onPrefillConsumed]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const MAX_LENGTH = 4000;

  const handleSend = () => {
    if (input.trim() && !disabled && input.length <= MAX_LENGTH) {
      onSend(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = useCallback(() => {
    const SpeechRec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [isListening]);

  const handleAttachmentClick = (label: string) => {
    setAttachOpen(false);

    if (label === "Upload") {
      fileInputRef.current?.click();
      return;
    }

    if (label === "By URL") {
      setUrlInput("");
      setUrlModalOpen(true);
      return;
    }

    if (label === "@variable") {
      setInput((prev) => prev + (prev ? " " : "") + "@");
      textareaRef.current?.focus();
      return;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const names = files.map((f) => f.name).join(", ");
    setInput((prev) => (prev ? `${prev} [Attached: ${names}]` : `[Attached: ${names}]`));
    textareaRef.current?.focus();
    e.target.value = "";
  };

  const handleAttachUrl = () => {
    if (!urlInput.trim()) return;
    setInput((prev) => (prev ? `${prev} ${urlInput.trim()}` : urlInput.trim()));
    setUrlModalOpen(false);
    setUrlInput("");
    textareaRef.current?.focus();
  };

  const ATTACHMENT_ITEMS = [
    { icon: FileUp,    label: "Upload",          hint: "Local files",       disabled: false },
    { icon: Link,      label: "By URL",          hint: "Paste a link",      disabled: false },
    { icon: Cloud,     label: "Cloud Storage",   hint: "Coming Soon",       disabled: true  },
    { icon: HardDrive, label: "Google Drive",    hint: "Coming Soon",       disabled: true  },
    { icon: Youtube,   label: "YouTube",         hint: "Coming Soon",       disabled: true  },
    { icon: BookOpen,  label: "Example",         hint: "Coming Soon",       disabled: true  },
    { icon: AtSign,    label: "@variable",       hint: "Insert reference",  disabled: false },
  ];

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
      />

      {urlModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/30 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setUrlModalOpen(false); }}
        >
          <div className="w-full max-w-md sm:mx-4 bg-white border border-outline-variant/15 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-on-surface">Attach by URL</h3>
              <button
                onClick={() => setUrlModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAttachUrl(); }}
              placeholder="Paste URL here..."
              autoFocus
              className="w-full px-3 py-2.5 bg-surface-container-low border border-outline-variant/20 rounded-2xl text-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/15 transition-all mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setUrlModalOpen(false)}
                className="px-4 py-2 text-sm text-on-secondary-container hover:text-on-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAttachUrl}
                disabled={!urlInput.trim()}
                className="px-4 py-2 text-sm bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-colors"
              >
                Attach
              </button>
            </div>
          </div>
        </div>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {streamStatus}
      </div>

      <div className="relative flex items-end w-full max-w-4xl mx-auto bg-white border border-outline-variant/15 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-accent-blue/20 focus-within:border-accent-blue/30 transition-all duration-200">

        <div className="absolute left-2 bottom-2 z-10">
          <Popover open={attachOpen} onOpenChange={setAttachOpen}>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="w-9 h-9 rounded-2xl text-on-surface-variant hover:text-on-surface hover:bg-surface"
                disabled={disabled}
                aria-label="Add attachment"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-52 p-1 bg-white border border-outline-variant/15 rounded-2xl shadow-xl"
            >
              {ATTACHMENT_ITEMS.map(({ icon: Icon, label, hint, disabled: itemDisabled }) => (
                <button
                  key={label}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-sm transition-colors",
                    itemDisabled
                      ? "text-outline-variant cursor-not-allowed"
                      : "text-on-surface-variant hover:bg-surface hover:text-on-surface",
                  )}
                  onClick={() => !itemDisabled && handleAttachmentClick(label)}
                  disabled={itemDisabled}
                >
                  <Icon className={cn("w-4 h-4 shrink-0", itemDisabled ? "text-outline-variant" : "text-on-surface-variant")} />
                  <span className="text-xs">
                    <span className={cn("font-medium", itemDisabled ? "text-outline-variant" : "text-on-surface")}>{label}</span>
                    <span className={cn("ml-1.5 text-[10px]", itemDisabled ? "text-outline-variant italic" : "text-on-surface-variant")}>{hint}</span>
                  </span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => { if (e.target.value.length <= MAX_LENGTH) setInput(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder="Command the agent — e.g. 'Update product price to $29.99'…"
          aria-label="Chat message input"
          className="w-full max-h-[200px] min-h-[56px] resize-none bg-transparent py-4 pl-12 pr-24 sm:pr-36 outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 focus-visible:ring-offset-1 rounded-md text-sm placeholder:text-on-surface-variant text-on-surface"
          disabled={disabled}
          rows={1}
          maxLength={MAX_LENGTH}
        />
        {input.length > MAX_LENGTH * 0.8 && (
          <span className={cn("absolute right-2 top-1.5 text-[10px] font-medium", input.length >= MAX_LENGTH ? "text-red-500" : "text-on-surface-variant")}>
            {input.length}/{MAX_LENGTH}
          </span>
        )}

        <div className="absolute right-2 bottom-2 flex items-center gap-1">
          <Popover open={promptsOpen} onOpenChange={setPromptsOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label="Prompt library"
                className="h-9 px-2.5 rounded-2xl text-on-surface-variant hover:text-accent-blue hover:bg-accent-blue/5 transition-colors gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold hidden sm:inline">Prompts</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-72 p-0 bg-white border border-outline-variant/15 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="px-3.5 pt-3 pb-2 border-b ghost-border">
                <p className="text-xs font-bold text-on-surface">Prompt Library</p>
                <p className="text-[10px] text-on-surface-variant mt-0.5">Select a command to run</p>
              </div>
              <div className="max-h-72 overflow-y-auto py-1.5">
                {promptCategories.map((cat) => (
                  <div key={cat.label} className="px-1.5 mb-1 last:mb-0">
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <span className="text-on-surface-variant">{cat.icon}</span>
                      <span className="text-[10px] font-bold text-on-secondary-container uppercase tracking-wider">{cat.label}</span>
                    </div>
                    {cat.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => {
                          onSend(prompt);
                          setPromptsOpen(false);
                        }}
                        className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-2xl text-[11px] font-medium text-on-surface-variant hover:text-accent-blue hover:bg-accent-blue/5 transition-all group"
                      >
                        <span className="w-1 h-1 rounded-full bg-[#c8c5cb] group-hover:bg-accent-blue shrink-0 transition-colors" />
                        <span className="truncate">{prompt}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleVoice}
            disabled={disabled}
            aria-label={isListening ? "Stop listening" : "Voice input"}
            className={cn(
              "w-9 h-9 rounded-2xl transition-colors",
              isListening
                ? "text-error-m3 bg-error-container hover:bg-[#fecdd3] animate-pulse"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface",
            )}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>
          {isStreaming ? (
            <Button
              size="icon"
              variant="default"
              className="w-10 h-10 rounded-2xl bg-red-500 hover:bg-red-600 text-white animate-pulse"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="default"
              className="w-10 h-10 rounded-2xl bg-accent-blue hover:bg-accent-blue/90 text-white"
              onClick={handleSend}
              disabled={!input.trim() || disabled}
            >
              <ArrowUp className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
