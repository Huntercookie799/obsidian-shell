import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { hexToRgb } from "../TerminalView";
import { stateManager } from "../../core/StateManager";
import { promptSelectWallpaperImage } from "../../utils/formatters";

export interface AppearanceCallbacks {
  onAccentChange?: (hex: string) => void;
  onBackgroundChange?: (transparent: boolean) => void;
}

export class AppearanceManager {
  private inputOpacity: HTMLInputElement | null = null;
  private labelOpacity: HTMLElement | null = null;
  private inputBlur: HTMLInputElement | null = null;
  private labelBlur: HTMLElement | null = null;
  private labelWallpaperStatus: HTMLElement | null = null;
  private btnRemoveWallpaper: HTMLButtonElement | null = null;
  private inputWallpaperFile: HTMLInputElement | null = null;
  private inputAccentPicker: HTMLInputElement | null = null;
  private callbacks: AppearanceCallbacks;

  constructor(callbacks: AppearanceCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public initDom(): void {
    this.inputOpacity = document.getElementById("input-terminal-opacity") as HTMLInputElement;
    this.labelOpacity = document.getElementById("label-terminal-opacity");
    this.inputBlur = document.getElementById("input-terminal-blur") as HTMLInputElement;
    this.labelBlur = document.getElementById("label-terminal-blur");
    this.labelWallpaperStatus = document.getElementById("label-wallpaper-status");
    this.btnRemoveWallpaper = document.getElementById("btn-remove-wallpaper") as HTMLButtonElement;
    this.inputWallpaperFile = document.getElementById("input-wallpaper-file") as HTMLInputElement;
    this.inputAccentPicker = document.getElementById("input-accent-picker") as HTMLInputElement;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Sliders de opacidad y desenfoque
    if (this.inputOpacity) {
      this.inputOpacity.addEventListener("input", (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        this.applyTerminalOpacity(val);
      });
      this.inputOpacity.addEventListener("change", (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        stateManager.saveSettings({ terminalOpacity: val });
      });
    }

    if (this.inputBlur) {
      this.inputBlur.addEventListener("input", (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        this.applyTerminalBlur(val);
      });
      this.inputBlur.addEventListener("change", (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        stateManager.saveSettings({ terminalBlur: val });
      });
    }

    // Selector de color de acento
    const swatches = document.querySelectorAll<HTMLElement>(".color-swatch");
    swatches.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;
        if (color) {
          this.applyAccentColor(color);
          stateManager.saveSettings({ accentColor: color });
        }
      });
    });

    if (this.inputAccentPicker) {
      this.inputAccentPicker.addEventListener("input", () => {
        this.applyAccentColor(this.inputAccentPicker!.value);
      });
      this.inputAccentPicker.addEventListener("change", () => {
        stateManager.saveSettings({ accentColor: this.inputAccentPicker!.value });
      });
    }

    // Selector de wallpaper nativo / fallback
    const btnSelectWallpaper = document.getElementById("btn-select-wallpaper");
    if (btnSelectWallpaper) {
      btnSelectWallpaper.addEventListener("click", () => {
        this.promptSelectWallpaper();
      });
    }

    if (this.btnRemoveWallpaper) {
      this.btnRemoveWallpaper.addEventListener("click", () => {
        this.clearTerminalWallpaper();
      });
    }

    if (this.inputWallpaperFile) {
      this.inputWallpaperFile.addEventListener("change", () => {
        const file = this.inputWallpaperFile?.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              this.setTerminalWallpaper(reader.result, file.name);
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }
  }

  public applyAccentColor(hex: string): void {
    const rgb = hexToRgb(hex) || { r: 255, g: 107, b: 0 };
    document.documentElement.style.setProperty("--accent-color", hex);
    document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);

    // Actualizar resaltado en las muestras circulares
    const swatches = document.querySelectorAll<HTMLElement>(".color-swatch");
    swatches.forEach((swatch) => {
      const swatchColor = swatch.dataset.color?.toLowerCase();
      if (swatchColor === hex.toLowerCase()) {
        swatch.classList.add("active");
      } else {
        swatch.classList.remove("active");
      }
    });

    if (this.inputAccentPicker) {
      this.inputAccentPicker.value = hex;
    }

    this.callbacks.onAccentChange?.(hex);
  }

  public applyTerminalOpacity(opacity: number): void {
    const clamped = Math.max(0.1, Math.min(1.0, opacity));
    // Actualizar variable base
    document.documentElement.style.setProperty("--terminal-opacity", clamped.toString());
    // Sobreescribir explícitamente el background translúcido del HUD
    const bgColor = `rgba(13, 13, 18, ${clamped})`;
    document.documentElement.style.setProperty("--vayli-bg-expanded", bgColor);
    // Aplicar directamente al elemento backdrop desacoplado
    const backdrop = document.getElementById("island-backdrop");
    if (backdrop) backdrop.style.background = bgColor;
    if (this.labelOpacity) {
      this.labelOpacity.textContent = `${Math.round(clamped * 100)}%`;
    }
    if (this.inputOpacity) {
      this.inputOpacity.value = clamped.toString();
    }
    this.callbacks.onBackgroundChange?.(true);
  }

  public applyTerminalBlur(blurPx: number): void {
    const clamped = Math.max(0, Math.min(30, Math.round(blurPx)));
    const blurVal = `${clamped}px`;
    document.documentElement.style.setProperty("--terminal-bg-blur", blurVal);
    if (this.labelBlur) {
      this.labelBlur.textContent = `${clamped}px`;
    }
    if (this.inputBlur) {
      this.inputBlur.value = clamped.toString();
    }
  }

  public async setTerminalWallpaper(imagePathOrDataUrl: string, displayName?: string): Promise<void> {
    if (!imagePathOrDataUrl || !imagePathOrDataUrl.trim()) {
      this.clearTerminalWallpaper();
      return;
    }
    const clean = imagePathOrDataUrl.trim();
    let bgUrl: string;

    if (clean.startsWith("data:") || clean.startsWith("blob:") || clean.startsWith("http://") || clean.startsWith("https://")) {
      // Data URLs, blob URLs, and remote URLs can be used directly
      bgUrl = clean;
    } else {
      // Local file path: read the file using Tauri FS plugin and convert to data URL
      try {
        // Convert Windows path to proper file:// URL (file:///C:/path on Windows)
        let fileUrl: string;
        if (clean.startsWith("file://")) {
          fileUrl = clean;
        } else if (/^[A-Za-z]:\\/.test(clean) || /^[A-Za-z]:\//.test(clean)) {
          // Windows absolute path like C:\path or C:/path
          fileUrl = `file:///${clean.replace(/\\/g, "/")}`;
        } else if (clean.startsWith("/")) {
          // Unix absolute path
          fileUrl = `file://${clean}`;
        } else {
          // Relative path - use as-is
          fileUrl = clean;
        }
        const binaryData = await readFile(fileUrl);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(binaryData)));
        const mimeType = this.getMimeType(clean);
        bgUrl = `data:${mimeType};base64,${base64}`;
        console.log("[AppearanceManager] Wallpaper loaded successfully via FS plugin", { fileUrl });
      } catch (err) {
        console.error("[AppearanceManager] Error al leer archivo de wallpaper con FS plugin:", err);
        // Fallback to convertFileSrc (may work for some paths)
        try {
          bgUrl = convertFileSrc(clean);
          console.log("[AppearanceManager] Fallback to convertFileSrc succeeded");
        } catch (err2) {
          console.error("[AppearanceManager] convertFileSrc also failed:", err2);
          bgUrl = "";
        }
      }
    }

    if (!bgUrl) {
      console.error("[AppearanceManager] No se pudo cargar el wallpaper");
      return;
    }

    document.documentElement.style.setProperty("--terminal-bg-image", `url("${bgUrl}")`);

    const currentSettings = stateManager.getSettings();
    let updatedOpacity = currentSettings.terminalOpacity;
    if (updatedOpacity === undefined || updatedOpacity >= 0.99) {
      updatedOpacity = 0.8;
      this.applyTerminalOpacity(0.8);
    }

    stateManager.saveSettings({
      terminalWallpaper: clean,
      terminalOpacity: updatedOpacity,
    });

    const name = displayName || clean.split(/[/\\]/).filter(Boolean).pop() || "Imagen activa";
    if (this.labelWallpaperStatus) {
      this.labelWallpaperStatus.textContent = name;
      this.labelWallpaperStatus.classList.add("active");
      this.labelWallpaperStatus.title = clean;
    }
    if (this.btnRemoveWallpaper) {
      this.btnRemoveWallpaper.classList.remove("hidden");
    }
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "png": return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      case "gif": return "image/gif";
      case "bmp": return "image/bmp";
      default: return "image/png";
    }
  }

  public clearTerminalWallpaper(): void {
    document.documentElement.style.setProperty("--terminal-bg-image", "none");
    stateManager.saveSettings({ terminalWallpaper: undefined });

    if (this.labelWallpaperStatus) {
      this.labelWallpaperStatus.textContent = "Sin imagen";
      this.labelWallpaperStatus.classList.remove("active");
      this.labelWallpaperStatus.title = "";
    }
    if (this.btnRemoveWallpaper) {
      this.btnRemoveWallpaper.classList.add("hidden");
    }
    if (this.inputWallpaperFile) {
      this.inputWallpaperFile.value = "";
    }
  }

  public async promptSelectWallpaper(): Promise<void> {
    try {
      const selected = await promptSelectWallpaperImage();
      if (selected) {
        await this.setTerminalWallpaper(selected);
      }
    } catch (err) {
      console.debug("Diálogo nativo no disponible, abriendo selector de archivos alternativo:", err);
      this.inputWallpaperFile?.click();
    }
  }
}
