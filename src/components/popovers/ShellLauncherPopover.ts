import { CustomProfile } from "../../types";
import { stateManager } from "../../core/StateManager";

export class ShellLauncherPopover {
  private popoverEl: HTMLElement | null = null;
  private customProfilesContainer: HTMLElement | null = null;
  private inputProfileName: HTMLInputElement | null = null;
  private inputProfileCmd: HTMLInputElement | null = null;
  private inputProfileCwd: HTMLInputElement | null = null;
  private btnSaveProfile: HTMLButtonElement | null = null;
  private onLaunchShellCallback: (shellPath?: string, cwd?: string) => void;

  constructor(onLaunchShell: (shellPath?: string, cwd?: string) => void) {
    this.onLaunchShellCallback = onLaunchShell;
  }

  public initDom(): void {
    this.popoverEl = document.getElementById("shell-menu-popover");
    this.customProfilesContainer = document.getElementById("custom-profiles-container");
    this.inputProfileName = document.getElementById("input-profile-name") as HTMLInputElement;
    this.inputProfileCmd = document.getElementById("input-profile-cmd") as HTMLInputElement;
    this.inputProfileCwd = document.getElementById("input-profile-cwd") as HTMLInputElement;
    this.btnSaveProfile = document.getElementById("btn-save-profile") as HTMLButtonElement;

    this.bindEvents();
    this.renderCustomProfiles();
  }

  private bindEvents(): void {
    // Shells predefinidos
    const shellOptions = document.querySelectorAll<HTMLElement>("#shell-menu-popover .menu-item[data-shell], .shell-option");
    shellOptions.forEach((btn) => {
      btn.addEventListener("click", () => {
        const shell = btn.dataset.shell;
        this.hide();
        this.onLaunchShellCallback(shell || undefined);
      });
    });

    // Creador de perfil personalizado
    if (this.btnSaveProfile) {
      this.btnSaveProfile.addEventListener("click", () => {
        this.handleSaveProfile();
      });
    }

    if (this.inputProfileCmd) {
      this.inputProfileCmd.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.handleSaveProfile();
        }
      });
    }
  }

  private handleSaveProfile(): void {
    const name = this.inputProfileName?.value.trim();
    const cmd = this.inputProfileCmd?.value.trim();
    const cwd = this.inputProfileCwd?.value.trim() || undefined;

    if (!name || !cmd) return;

    const newProfile: CustomProfile = {
      id: "profile_" + Date.now(),
      name,
      command: cmd,
      cwd,
    };

    stateManager.addCustomProfile(newProfile);
    this.renderCustomProfiles();

    if (this.inputProfileName) this.inputProfileName.value = "";
    if (this.inputProfileCmd) this.inputProfileCmd.value = "";
    if (this.inputProfileCwd) this.inputProfileCwd.value = "";
  }

  public toggle(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.toggle("hidden");
    if (!this.popoverEl.classList.contains("hidden")) {
      this.renderCustomProfiles();
    }
  }

  public show(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.remove("hidden");
    this.renderCustomProfiles();
  }

  public hide(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.add("hidden");
  }

  public isVisible(): boolean {
    return !!this.popoverEl && !this.popoverEl.classList.contains("hidden");
  }

  public renderCustomProfiles(): void {
    const container = this.customProfilesContainer;
    if (!container) return;
    container.innerHTML = "";

    const profiles = stateManager.loadCustomProfiles();
    if (profiles.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.cssText = "font-size: 10px; color: #52525B; padding: 4px;";
      emptyMsg.textContent = "No hay perfiles guardados.";
      container.appendChild(emptyMsg);
      return;
    }

    profiles.forEach((profile) => {
      const item = document.createElement("div");
      item.className = "profile-item";

      const info = document.createElement("div");
      info.style.cssText = "display: flex; flex-direction: column; overflow: hidden; min-width: 0; flex: 1;";
      const name = document.createElement("span");
      name.style.cssText = "font-weight: 600; color: #F4F4F6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
      name.textContent = profile.name;
      const cmd = document.createElement("span");
      cmd.style.cssText = "font-family: var(--font-mono); font-size: 9px; color: #8E8E93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
      cmd.textContent = profile.command + (profile.cwd ? ` [${profile.cwd}]` : "");
      info.appendChild(name);
      info.appendChild(cmd);

      const delBtn = document.createElement("button");
      delBtn.className = "profile-delete-btn";
      delBtn.innerHTML = "&times;";
      delBtn.title = "Eliminar perfil";
      delBtn.style.flexShrink = "0";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stateManager.removeCustomProfile(profile.id);
        this.renderCustomProfiles();
      });

      item.appendChild(info);
      item.appendChild(delBtn);

      item.addEventListener("click", () => {
        this.hide();
        this.onLaunchShellCallback(profile.command, profile.cwd);
      });

      container.appendChild(item);
    });
  }
}
