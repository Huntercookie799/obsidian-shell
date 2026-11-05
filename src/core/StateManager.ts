import { CustomProfile, ObsidianSettings } from "../types";

export const DEFAULT_SETTINGS: ObsidianSettings = {
  autoCollapseOnLeave: true,
  restoreSessionOnStartup: true,
  showOverFullscreen: false,
  collapsedWidget: "pty_status",
  clock24h: true,
  accentColor: "#FF6B00",
  cliNotifications: true,
  notificationSound: true,
  recentFolders: [],
  terminalOpacity: 0.70,
  terminalBlur: 14,
  terminalWallpaper: undefined,
  autoHideEnabled: false,
  autoHideMinutes: 3,
};

type StateChangeSubscriber = (settings: ObsidianSettings) => void;

export class StateManager {
  private static instance: StateManager;
  private settings: ObsidianSettings = { ...DEFAULT_SETTINGS };
  private customProfiles: CustomProfile[] = [];
  private subscribers: Set<StateChangeSubscriber> = new Set();

  private constructor() {
    this.loadSettings();
    this.loadCustomProfiles();
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  public getSettings(): ObsidianSettings {
    return { ...this.settings };
  }

  public loadSettings(): ObsidianSettings {
    try {
      const raw = localStorage.getItem("obsidian_settings") || localStorage.getItem("vayli_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };

        // Migración: asegurar que la opacidad translúcida por defecto (0.70)
        // se aplique para usuarios con valores anteriores muy oscuros (0.85 / 1.0)
        if (!parsed.__translucencyMigratedV2) {
          if (parsed.terminalOpacity === undefined || parsed.terminalOpacity >= 0.85) {
            this.settings.terminalOpacity = 0.70;
          }
          this.settings = { ...this.settings, __translucencyMigratedV2: true } as ObsidianSettings & { __translucencyMigratedV2: boolean };
          localStorage.setItem("obsidian_settings", JSON.stringify(this.settings));
        }
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
      }
    } catch (e) {
      console.warn("[StateManager] Error al parsear ajustes de localStorage:", e);
      this.settings = { ...DEFAULT_SETTINGS };
    }

    if (!Array.isArray(this.settings.recentFolders)) {
      this.settings.recentFolders = [];
    }

    return this.settings;
  }

  public saveSettings(partial?: Partial<ObsidianSettings>): ObsidianSettings {
    if (partial) {
      this.settings = { ...this.settings, ...partial };
    }
    try {
      localStorage.setItem("obsidian_settings", JSON.stringify(this.settings));
    } catch (e) {
      console.warn("[StateManager] Error al guardar configuración en localStorage:", e);
    }
    this.notifySubscribers();
    return this.settings;
  }

  public updateSettings(partial: Partial<ObsidianSettings>): ObsidianSettings {
    return this.saveSettings(partial);
  }

  public loadCustomProfiles(): CustomProfile[] {
    try {
      const raw = localStorage.getItem("vayli_custom_profiles");
      if (raw) {
        this.customProfiles = JSON.parse(raw);
      } else {
        this.customProfiles = [];
      }
    } catch (e) {
      console.warn("[StateManager] Error al parsear perfiles de localStorage:", e);
      this.customProfiles = [];
    }
    return [...this.customProfiles];
  }

  public saveCustomProfiles(profiles: CustomProfile[]): void {
    this.customProfiles = [...profiles];
    try {
      localStorage.setItem("vayli_custom_profiles", JSON.stringify(this.customProfiles));
    } catch (e) {
      console.warn("[StateManager] Error al guardar perfiles en localStorage:", e);
    }
  }

  public addCustomProfile(profile: CustomProfile): CustomProfile[] {
    this.customProfiles.push(profile);
    this.saveCustomProfiles(this.customProfiles);
    return [...this.customProfiles];
  }

  public removeCustomProfile(profileId: string): CustomProfile[] {
    this.customProfiles = this.customProfiles.filter((p) => p.id !== profileId);
    this.saveCustomProfiles(this.customProfiles);
    return [...this.customProfiles];
  }

  public addRecentFolder(folderPath: string, maxItems = 10): string[] {
    if (!folderPath) return this.settings.recentFolders || [];
    const clean = folderPath.trim();
    if (!clean) return this.settings.recentFolders || [];

    let folders = this.settings.recentFolders || [];
    const isWin = typeof navigator !== "undefined" && navigator.platform.includes("Win");
    const target = isWin ? clean.toLowerCase() : clean;

    folders = folders.filter((f) => {
      const norm = isWin ? f.toLowerCase() : f;
      return norm !== target;
    });

    folders.unshift(clean);
    if (folders.length > maxItems) {
      folders = folders.slice(0, maxItems);
    }
    this.saveSettings({ recentFolders: folders });
    return [...folders];
  }

  public removeRecentFolder(folderPath: string): string[] {
    let folders = this.settings.recentFolders || [];
    folders = folders.filter((f) => f !== folderPath);
    this.saveSettings({ recentFolders: folders });
    return [...folders];
  }

  public clearRecentFolders(): string[] {
    this.saveSettings({ recentFolders: [] });
    return [];
  }

  public subscribe(subscriber: StateChangeSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private notifySubscribers(): void {
    const current = this.getSettings();
    this.subscribers.forEach((fn) => {
      try {
        fn(current);
      } catch (err) {
        console.error("[StateManager] Error en notificador de suscriptor:", err);
      }
    });
  }
}

export const stateManager = StateManager.getInstance();
