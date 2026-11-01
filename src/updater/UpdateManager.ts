import { getVersion } from "@tauri-apps/api/app";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "offline";

export type UpdateListener = (
  state: UpdateState,
  label: string,
  progressPercent?: number
) => void;

export class UpdateManager {
  private currentVersion = "0.1.0";
  private pendingUpdate: Update | null = null;
  private listeners: Set<UpdateListener> = new Set();
  private state: UpdateState = "idle";
  private currentLabel = "v0.1.0";

  public async init(): Promise<string> {
    try {
      this.currentVersion = await getVersion();
    } catch {
      this.currentVersion = "0.1.0";
    }
    this.currentLabel = `v${this.currentVersion}`;
    this.notify(this.state, this.currentLabel);
    return this.currentVersion;
  }

  public getVersion(): string {
    return this.currentVersion;
  }

  public getState(): UpdateState {
    return this.state;
  }

  public subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.currentLabel);
    return () => this.listeners.delete(listener);
  }

  private notify(state: UpdateState, label: string, progressPercent?: number) {
    this.state = state;
    this.currentLabel = label;
    for (const listener of this.listeners) {
      try {
        listener(state, label, progressPercent);
      } catch (e) {
        console.error("[UpdateManager] Listener error:", e);
      }
    }
  }

  /**
   * Checks for updates with strict offline tolerance.
   * If network or endpoint is unavailable, silently catches the error
   * without affecting UI stability or Rim Light states.
   */
  public async checkForAppUpdates(silent = true): Promise<boolean> {
    if (this.state === "downloading") {
      return false;
    }

    if (!silent) {
      this.notify("checking", "Buscando...");
    }

    try {
      const update = await check();

      if (update) {
        this.pendingUpdate = update;
        this.notify("available", `Actualizar a v${update.version}`);
        return true;
      } else {
        this.pendingUpdate = null;
        if (!silent) {
          this.notify("up-to-date", "Al día");
          setTimeout(() => {
            if (this.state === "up-to-date") {
              this.notify("idle", `v${this.currentVersion}`);
            }
          }, 3000);
        }
        return false;
      }
    } catch (err) {
      // 100% Offline-safe: log for diagnostic purposes without raising UI errors
      console.debug("[Vayli Offline-First] Update check skipped or offline:", err);
      this.pendingUpdate = null;

      if (!silent) {
        this.notify("offline", "Al día (Offline)");
        setTimeout(() => {
          if (this.state === "offline") {
            this.notify("idle", `v${this.currentVersion}`);
          }
        }, 3000);
      }
      return false;
    }
  }

  /**
   * Downloads and installs the pending update, tracking byte progress.
   */
  public async installUpdate(): Promise<void> {
    if (!this.pendingUpdate) {
      return;
    }

    this.notify("downloading", "Descargando 0%", 0);

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      await this.pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            const percent = Math.min(
              100,
              Math.round((downloadedBytes / totalBytes) * 100)
            );
            this.notify("downloading", `Descargando ${percent}%`, percent);
          } else {
            const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
            this.notify("downloading", `Descargando ${mb} MB`);
          }
        } else if (event.event === "Finished") {
          this.notify("ready", "Reiniciar para aplicar");
        }
      });

      this.notify("ready", "Reiniciar");
    } catch (err) {
      console.warn("[Vayli Update] Download error:", err);
      this.notify("idle", `v${this.currentVersion}`);
    }
  }

  /**
   * Restarts application using tauri-plugin-process
   */
  public async applyAndRelaunch(): Promise<void> {
    try {
      await relaunch();
    } catch (err) {
      console.error("[Vayli Update] Relaunch failed:", err);
    }
  }
}

export const updateManager = new UpdateManager();
