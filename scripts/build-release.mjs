import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Terminate running instance if any to prevent Windows OS file-lock (os error 5)
if (process.platform === "win32") {
  try {
    execSync('taskkill /F /IM "obsidian-shell.exe" /T', { stdio: "ignore" });
    execSync('taskkill /F /IM "vayli-terminal.exe" /T', { stdio: "ignore" });
  } catch {}
}

const keyPath = path.join(rootDir, ".tauri", "vayli.key");
if (!fs.existsSync(keyPath)) {
  console.error(`Error: Private signing key not found at ${keyPath}`);
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, "utf-8").trim();

console.log("\x1b[38;2;255;107;0m[ObsidianShell Release Builder]\x1b[0m Starting production build with cryptographic signing...");

// Ensure cargo bin is in PATH for child process
const cargoBin = path.join(process.env.USERPROFILE || "", ".cargo", "bin");
const currentPath = process.env.PATH || "";
const env = {
  ...process.env,
  PATH: `${cargoBin};${currentPath}`,
  TAURI_SIGNING_PRIVATE_KEY: privateKey,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
};

const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const buildProc = spawn(cmd, ["tauri", "build"], {
  cwd: rootDir,
  env,
  shell: true,
  stdio: "inherit",
});

buildProc.on("close", (code) => {
  if (code === 0) {
    console.log("\x1b[32m[ObsidianShell Release Builder] Production build finished successfully!\x1b[0m");
    if (process.platform === "win32") {
      try {
        console.log("\x1b[38;2;255;107;0m[ObsidianShell Release Builder]\x1b[0m Applying Authenticode digital signature...");
        execSync('powershell -ExecutionPolicy Bypass -File scripts/sign-windows.ps1', { stdio: "inherit" });
      } catch (err) {
        console.warn("[ObsidianShell Release Builder] Warning: Could not sign Windows binaries:", err.message);
      }
    }
  } else {
    console.error(`\x1b[31m[ObsidianShell Release Builder] Build failed with exit code ${code}\x1b[0m`);
    process.exit(code || 1);
  }
});
