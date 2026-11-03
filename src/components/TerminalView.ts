import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
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

const lastDimensionsMap = new Map<string, { cols: number; rows: number }>();

/**
 * Registra dimensiones iniciales para evitar un primer resize redundante
 */
export function setInitialDimensions(sessionId: string, cols: number, rows: number) {
  if (sessionId && cols > 0 && rows > 0) {
    lastDimensionsMap.set(sessionId, { cols, rows });
  }
}

/**
 * Synchronously and safely fits xterm dimensions and propagates to PTY
 */
export function fitSafely(terminal: Terminal, fitAddon: FitAddon, sessionId: string, isUserScrolledUp: boolean = false) {
  if (!sessionId) return;
  const element = terminal.element;
  if (!element || element.offsetWidth < 50 || element.offsetHeight < 50) {
    return;
  }

  try {
    fitAddon.fit();
    const cols = terminal.cols;
    const rows = terminal.rows;
    if (cols > 0 && rows > 0) {
      const last = lastDimensionsMap.get(sessionId);
      if (!last || last.cols !== cols || last.rows !== rows) {
        lastDimensionsMap.set(sessionId, { cols, rows });
        invoke("resize_pty", { sessionId, cols, rows }).catch(() => {});
      }
    }
    if (!isUserScrolledUp) {
      terminal.scrollToBottom();
    }
  } catch (err) {
    console.debug("[Anti-Flicker] Safe fit deferred:", err);
  }
}

export function createTerminalInstance(sessionId: string = "", initialAccent: string = "#FF6B00"): {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  serializeBuffer: (maxLines?: number) => string;
  smartPaste: (rawText: string) => void;
  writeBatched: (data: string) => void;
  isUserScrolledUp: () => boolean;
  setSessionId: (newId: string) => void;
  mount: (container: HTMLElement) => void;
  dispose: () => void;
} {
  let currentSessionId = sessionId;
  const rgb = hexToRgb(initialAccent) || { r: 255, g: 107, b: 0 };
  const dynamicTheme = {
    ...VAYLI_THEME,
    cursor: initialAccent,
    selectionBackground: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`,
    selectionInactiveBackground: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
  };

  const terminal = new Terminal({
    theme: dynamicTheme,
    fontFamily: "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'MesloLGS NF', 'Cascadia Code NF', 'Cascadia Mono', 'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace",
    fontSize: 13,
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowTransparency: true,
    scrollback: 2500,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  const unicode11Addon = new Unicode11Addon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.loadAddon(new WebLinksAddon());

  // Activar soporte Unicode 11 para cálculo exacto de ancho de glifos Nerd Fonts y emojis
  terminal.unicode.activeVersion = "11";

  // Control de scroll y auto-anclaje al final del buffer
  let isUserScrolledUp = false;
  let pendingOutput = "";
  let rafScheduled = false;

  // Botón flotante para saltar al final (↓ Final)
  const scrollBottomBtn = document.createElement("button");
  scrollBottomBtn.className = "scroll-bottom-btn hidden";
  scrollBottomBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
      <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
    <span>Final</span>
  `;
  scrollBottomBtn.title = "Saltar al final del buffer";
  scrollBottomBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isUserScrolledUp = false;
    terminal.scrollToBottom();
    scrollBottomBtn.classList.add("hidden");
    terminal.focus();
  });

  terminal.onScroll(() => {
    const buf = terminal.buffer.active;
    isUserScrolledUp = buf.viewportY < buf.baseY;
    if (isUserScrolledUp) {
      scrollBottomBtn.classList.remove("hidden");
    } else {
      scrollBottomBtn.classList.add("hidden");
    }
  });

  // Renderizado optimizado por Animation Frame (RAF Batching con Fast-Forward masivo)
  const writeBatched = (data: string) => {
    pendingOutput += data;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (pendingOutput.length === 0) return;

        let chunk = pendingOutput;
        pendingOutput = "";

        // Fast-Forward si la cola acumulada supera los 180,000 caracteres
        const MAX_PENDING_CHARS = 180_000;
        if (chunk.length > MAX_PENDING_CHARS) {
          const tail = chunk.slice(-MAX_PENDING_CHARS);
          const newlineIndex = tail.indexOf("\n");
          if (newlineIndex !== -1) {
            chunk = "\x1b[0m" + tail.slice(newlineIndex + 1);
          } else {
            chunk = "\x1b[0m" + tail;
          }
        }

        terminal.write(chunk, () => {
          if (!isUserScrolledUp) {
            terminal.scrollToBottom();
          }
        });
      });
    }
  };

  const serializeBuffer = (maxLines: number = 500): string => {
    try {
      return serializeAddon.serialize({ scrollback: maxLines });
    } catch (e) {
      console.warn(`[PTY ${currentSessionId}] Error al serializar buffer:`, e);
      return "";
    }
  };

  // Pegado Inteligente Multi-Línea con soporte forzado de Bracketed Paste
  const smartPaste = (rawText: string) => {
    if (!rawText || rawText.length === 0 || !currentSessionId) return;

    // Normalizar saltos de línea Windows \r\n -> \n, \r -> \n para que permanezcan como \n puro
    const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const hasNewlines = normalized.includes("\n");
    const isBracketed = hasNewlines || Boolean((terminal.modes as any)?.bracketedPasteMode);

    let payload: string;
    if (isBracketed) {
      // Estrictamente envuelto en las secuencias de escape ANSI de inicio y fin de pegado
      payload = `\x1b[200~${normalized}\x1b[201~`;
    } else {
      payload = normalized;
    }

    invoke("write_to_pty", { sessionId: currentSessionId, data: payload }).catch((err) => {
      console.error(`[PTY ${currentSessionId}] Error al pegar texto en PTY:`, err);
    });
  };

  // Input listener from user keystrokes -> Rust PTY
  terminal.onData((data) => {
    if (currentSessionId) {
      invoke("write_to_pty", { sessionId: currentSessionId, data }).catch((err) => {
        console.error(`[PTY ${currentSessionId}] Write error:`, err);
      });
    }
  });

  // Attach key listeners for clipboard productivity and pane close
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    // Intercept Ctrl+Shift+C (Copy)
    if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
      if (event.type === "keydown") {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
      }
      return false;
    }

    // Intercept Ctrl+V or Ctrl+Shift+V (Smart Paste)
    if (event.ctrlKey && event.code === "KeyV") {
      if (event.type === "keydown") {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            smartPaste(text);
          }
        }).catch((err) => {
          console.debug(`[PTY ${currentSessionId}] Error leyendo portapapeles:`, err);
        });
      }
      return false;
    }

    // Intercept Shift+Insert (Atajo clásico de terminal para pegar)
    if (event.shiftKey && event.code === "Insert") {
      if (event.type === "keydown") {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            smartPaste(text);
          }
        }).catch((err) => {
          console.debug(`[PTY ${currentSessionId}] Error leyendo portapapeles en Shift+Insert:`, err);
        });
      }
      return false;
    }

    // Desactivar tecla Insert suelta para evitar caracteres desprotegidos al socket
    if (event.code === "Insert" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      return false;
    }

    // Intercept Ctrl+W and Ctrl+Shift+W to close active pane/tab instead of terminal ETB
    if (event.ctrlKey && event.code === "KeyW") {
      if (event.type === "keydown") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("vayli:close-active-pane"));
      }
      return false;
    }

    // Intercept Ctrl+Tab and Ctrl+Shift+Tab to cycle tabs instead of typing tab in terminal
    if ((event.ctrlKey || event.metaKey) && (event.key === "Tab" || event.code === "Tab")) {
      if (event.type === "keydown") {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("vayli:cycle-tab", {
            detail: { direction: event.shiftKey ? "prev" : "next" },
          })
        );
      }
      return false;
    }

    return true;
  });

  let contextMenuHandler: ((e: MouseEvent) => void) | null = null;
  let pasteHandler: ((e: ClipboardEvent) => void) | null = null;
  let targetContainer: HTMLElement | null = null;

  const mount = (container: HTMLElement) => {
    targetContainer = container;
    terminal.open(container);

    // Forzar activación del modo Bracketed Paste en el core de Xterm
    try {
      if ((terminal as any)._core?.coreService?.decPrivateModes) {
        (terminal as any)._core.coreService.decPrivateModes.bracketedPasteMode = true;
      }
    } catch (e) {
      console.debug("Note: Could not force xterm bracketedPasteMode:", e);
    }

    // Clic derecho estilo Windows Terminal:
    // Si hay selección -> copiar y limpiar selección
    // Si no hay selección -> pegar inteligentemente con Bracketed Paste
    contextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (terminal.hasSelection()) {
        const selected = terminal.getSelection();
        if (selected) {
          navigator.clipboard.writeText(selected).catch(() => {});
        }
        terminal.clearSelection();
      } else {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            smartPaste(text);
          }
        }).catch((err) => {
          console.debug(`[PTY ${currentSessionId}] Error leyendo portapapeles en clic derecho:`, err);
        });
      }
    };
    container.addEventListener("contextmenu", contextMenuHandler);

    // Interceptar evento paste nativo del DOM en fase de captura (capture: true)
    // para evitar que el navegador envíe caracteres sueltos directamente al socket sin pasar por smartPaste
    pasteHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const pastedText = e.clipboardData?.getData("text/plain") || e.clipboardData?.getData("text");
      if (pastedText) {
        smartPaste(pastedText);
      }
    };
    container.addEventListener("paste", pasteHandler, true);
    if (terminal.textarea) {
      terminal.textarea.addEventListener("paste", pasteHandler, true);
    }

    // Intento de aceleración WebGL con fallback transparente a Canvas/DOM
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.debug(`[PTY ${currentSessionId}] Pérdida de contexto WebGL, revirtiendo a Canvas`);
        try {
          webglAddon.dispose();
        } catch {
          // Ignorar error al desechar contexto perdido
        }
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.debug("WebGL no disponible o no soportado en este compositor, usando Canvas/DOM:", e);
    }

    container.appendChild(scrollBottomBtn);

    requestAnimationFrame(() => {
      if (currentSessionId) {
        fitSafely(terminal, fitAddon, currentSessionId, isUserScrolledUp);
      }
    });
  };

  const dispose = () => {
    scrollBottomBtn.remove();
    if (currentSessionId) {
      lastDimensionsMap.delete(currentSessionId);
    }
    if (targetContainer) {
      if (contextMenuHandler) {
        targetContainer.removeEventListener("contextmenu", contextMenuHandler);
      }
      if (pasteHandler) {
        targetContainer.removeEventListener("paste", pasteHandler, true);
      }
    }
    if (terminal.textarea && pasteHandler) {
      terminal.textarea.removeEventListener("paste", pasteHandler, true);
    }
    try {
      terminal.dispose();
    } catch (e) {
      console.error("Error disposing terminal:", e);
    }
  };

  return {
    terminal,
    fitAddon,
    searchAddon,
    serializeAddon,
    serializeBuffer,
    smartPaste,
    writeBatched,
    isUserScrolledUp: () => isUserScrolledUp,
    setSessionId: (newId: string) => {
      currentSessionId = newId;
    },
    mount,
    dispose,
  };
}
