import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

export const VAYLI_THEME = {
  background: "#0D0D0F",
  foreground: "#F4F4F6",
  cursor: "#FF6B00",
  cursorAccent: "#0D0D0F",
  selectionBackground: "rgba(255, 107, 0, 0.25)",
  selectionInactiveBackground: "rgba(255, 107, 0, 0.15)",
  black: "#1F1F24",
  red: "#EF4444",
  green: "#10B981",
  yellow: "#F59E0B",
  blue: "#3B82F6",
  magenta: "#EC4899",
  cyan: "#06B6D4",
  white: "#F4F4F6",
  brightBlack: "#8E8E93",
  brightRed: "#F87171",
  brightGreen: "#34D399",
  brightYellow: "#FBBF24",
  brightBlue: "#60A5FA",
  brightMagenta: "#F472B6",
  brightCyan: "#22D3EE",
  brightWhite: "#FFFFFF",
};

/**
 * Convierte un código hexadecimal (#RGB o #RRGGBB) a valores RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

/**
 * Actualiza el cursor y fondo de selección de Xterm en caliente
 */
export function updateTerminalAccentTheme(terminal: Terminal, hex: string) {
  const rgb = hexToRgb(hex) || { r: 255, g: 107, b: 0 };
  terminal.options.theme = {
    ...terminal.options.theme,
    cursor: hex,
    selectionBackground: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`,
    selectionInactiveBackground: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
  };
}

/**
 * Strips ANSI escape sequences, control chars, and OSC title strings
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
    .replace(/\x1B\][0-9];[^\x07]*\x07/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synchronously and safely fits xterm dimensions and propagates to PTY
 */
export function fitSafely(terminal: Terminal, fitAddon: FitAddon, sessionId: string) {
  const element = terminal.element;
  if (!element || element.offsetWidth < 50 || element.offsetHeight < 50) {
    return;
  }

  try {
    fitAddon.fit();
    const cols = terminal.cols;
    const rows = terminal.rows;
    if (cols > 0 && rows > 0) {
      invoke("resize_pty", { sessionId, cols, rows }).catch(() => {});
    }
  } catch (err) {
    console.debug("[Anti-Flicker] Safe fit deferred:", err);
  }
}

export function createTerminalInstance(sessionId: string, initialAccent: string = "#FF6B00"): {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  serializeBuffer: (maxLines?: number) => string;
  mount: (container: HTMLElement) => void;
  dispose: () => void;
} {
  const rgb = hexToRgb(initialAccent) || { r: 255, g: 107, b: 0 };
  const dynamicTheme = {
    ...VAYLI_THEME,
    cursor: initialAccent,
    selectionBackground: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`,
    selectionInactiveBackground: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
  };

  const terminal = new Terminal({
    theme: dynamicTheme,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowTransparency: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(new WebLinksAddon());

  const serializeBuffer = (maxLines: number = 500): string => {
    try {
      return serializeAddon.serialize({ scrollback: maxLines });
    } catch (e) {
      console.warn(`[PTY ${sessionId}] Error al serializar buffer:`, e);
      return "";
    }
  };

  // Input listener from user keystrokes -> Rust PTY
  terminal.onData((data) => {
    invoke("write_to_pty", { sessionId, data }).catch((err) => {
      console.error(`[PTY ${sessionId}] Write error:`, err);
    });
  });

  // Attach key listeners for clipboard productivity and pane close
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    // Intercept Ctrl+Shift+C (Copy)
    if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
      return false;
    }

    // Intercept Ctrl+Shift+V (Paste)
    if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
      navigator.clipboard.readText().then((text) => {
        if (text) {
          invoke("write_to_pty", { sessionId, data: text });
        }
      });
      return false;
    }

    // Intercept Ctrl+W and Ctrl+Shift+W to close active pane/tab instead of terminal ETB
    if (event.ctrlKey && event.code === "KeyW") {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("vayli:close-active-pane"));
      return false;
    }

    return true;
  });

  const mount = (container: HTMLElement) => {
    terminal.open(container);

    // Try WebGL acceleration with graceful Canvas/DOM fallback
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn("WebGL addon not supported, falling back to Canvas renderer", e);
    }

    requestAnimationFrame(() => {
      fitSafely(terminal, fitAddon, sessionId);
    });
  };

  const dispose = () => {
    try {
      terminal.dispose();
    } catch (e) {
      console.error("Error disposing terminal:", e);
    }
  };

  return { terminal, fitAddon, searchAddon, serializeAddon, serializeBuffer, mount, dispose };
}
