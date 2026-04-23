import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface TerminalLine {
  text: string;
  type?: "info" | "success" | "error" | "warn" | "system" | "data";
}

interface TerminalViewerProps {
  lines: TerminalLine[];
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  info: "\x1b[36m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  warn: "\x1b[33m",
  system: "\x1b[90m",
  data: "\x1b[37m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function sanitizeForTerminal(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

export function TerminalViewer({ lines, className }: TerminalViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#060e20",
        foreground: "var(--on-surface-variant)",
        cursor: "#0081FB",
        selectionBackground: "#0081FB33",
        black: "#0b1326",
        red: "#ef4444",
        green: "#16a34a",
        yellow: "#ffd866",
        blue: "#82aaff",
        magenta: "#c792ea",
        cyan: "#0081FB",
        white: "var(--on-surface-variant)",
      },
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      cursorBlink: false,
      cursorStyle: "bar",
      disableStdin: true,
      scrollback: 500,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
    });

    termRef.current = term;
    fitRef.current = fit;
    writtenRef.current = 0;

    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      writtenRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const newLines = lines.slice(writtenRef.current);
    for (const line of newLines) {
      const color = TYPE_COLORS[line.type ?? "info"] ?? TYPE_COLORS.info;
      const prefix = line.type === "system" ? `${DIM}[SYS]${RESET} ` :
                     line.type === "error" ? `${BOLD}${color}[ERR]${RESET} ` :
                     line.type === "success" ? `${BOLD}${color}[OK]${RESET}  ` :
                     line.type === "warn" ? `${color}[!]${RESET}   ` :
                     line.type === "data" ? `${DIM}     ${RESET}` :
                     `${color}[>]${RESET}   `;
      term.writeln(`${prefix}${color}${sanitizeForTerminal(line.text)}${RESET}`);
    }
    writtenRef.current = lines.length;

    if (newLines.length > 0) {
      term.scrollToBottom();
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight: 180, background: "#060e20", borderRadius: 8, padding: 4 }}
    />
  );
}

export function formatPayloadForTerminal(
  endpoint: string,
  method: string,
  payload: Record<string, unknown>,
): TerminalLine[] {
  const lines: TerminalLine[] = [
    { text: "━━━ Execution Payload ━━━━━━━━━━━━━━━━━━━━━━━━━", type: "system" },
    { text: `Endpoint: ${method.toUpperCase()} ${endpoint}`, type: "info" },
    { text: "", type: "system" },
    { text: "Payload:", type: "info" },
  ];

  const sanitizedPayload = JSON.parse(JSON.stringify(payload, (_key, value) =>
    typeof value === "string" ? sanitizeForTerminal(value) : value
  ));
  const jsonStr = JSON.stringify(sanitizedPayload, null, 2);
  for (const jLine of jsonStr.split("\n")) {
    lines.push({ text: jLine, type: "data" });
  }

  lines.push({ text: "", type: "system" });
  lines.push({ text: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", type: "system" });

  return lines;
}
