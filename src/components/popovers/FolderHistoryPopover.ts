import { formatPathSnippet, promptOpenFolder } from "../../utils/formatters";
import { stateManager } from "../../core/StateManager";

export class FolderHistoryPopover {
  private popoverEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private btnBrowse: HTMLButtonElement | null = null;
  private onSelectFolderCallback: (path: string) => void;

  constructor(onSelectFolder: (path: string) => void) {
    this.onSelectFolderCallback = onSelectFolder;
  }

  public initDom(): void {
    this.popoverEl = document.getElementById("folder-menu-popover");
    this.containerEl = document.getElementById("recent-folders-container");
    this.btnBrowse = document.getElementById("btn-browse-folder") as HTMLButtonElement;

    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    if (this.btnBrowse) {
      this.btnBrowse.addEventListener("click", async () => {
        const selected = await promptOpenFolder();
        if (selected) {
          this.hide();
          this.onSelectFolderCallback(selected);
        }
      });
    }

    const btnSettingsOpen = document.getElementById("btn-settings-open-folder");
    if (btnSettingsOpen) {
      btnSettingsOpen.addEventListener("click", async () => {
        const selected = await promptOpenFolder();
        if (selected) {
          this.onSelectFolderCallback(selected);
        }
      });
    }

    const btnSettingsClear = document.getElementById("btn-settings-clear-folders");
    if (btnSettingsClear) {
      btnSettingsClear.addEventListener("click", () => {
        stateManager.clearRecentFolders();
        this.render();
      });
    }
  }

  public toggle(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.toggle("hidden");
    if (!this.popoverEl.classList.contains("hidden")) {
      this.render();
    }
  }

  public show(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.remove("hidden");
    this.render();
  }

  public hide(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.add("hidden");
  }

  public isVisible(): boolean {
    return !!this.popoverEl && !this.popoverEl.classList.contains("hidden");
  }

  public render(): void {
    if (!this.containerEl) return;
    this.containerEl.innerHTML = "";

    const settings = stateManager.getSettings();
    const folders = settings.recentFolders || [];

    if (folders.length === 0) {
      const empty = document.createElement("div");
      empty.className = "recent-folders-empty";
      empty.textContent = "Sin carpetas recientes";
      this.containerEl.appendChild(empty);
      return;
    }

    const container = this.containerEl;
    if (!container) return;

    folders.forEach((fPath) => {
      const item = document.createElement("div");
      item.className = "recent-folder-item";
      item.title = fPath;

      const icon = document.createElement("span");
      icon.className = "recent-folder-icon";
      icon.textContent = "📁";

      const info = document.createElement("div");
      info.className = "recent-folder-info";

      const name = document.createElement("span");
      name.className = "recent-folder-name";
      const parts = fPath.split(/[/\\]/).filter(Boolean);
      name.textContent = parts[parts.length - 1] || fPath;

      const pathEl = document.createElement("span");
      pathEl.className = "recent-folder-path";
      pathEl.textContent = formatPathSnippet(fPath, 34);

      info.appendChild(name);
      info.appendChild(pathEl);

      const delBtn = document.createElement("button");
      delBtn.className = "recent-folder-remove";
      delBtn.innerHTML = "&times;";
      delBtn.title = "Eliminar del historial";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stateManager.removeRecentFolder(fPath);
        this.render();
      });

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(delBtn);

      item.addEventListener("click", () => {
        this.hide();
        this.onSelectFolderCallback(fPath);
      });

      container.appendChild(item);
    });
  }
}
