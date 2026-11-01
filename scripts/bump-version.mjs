import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const packageJsonPath = path.join(rootDir, "package.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/bump-version.mjs [patch|minor|major|<explicit-version>]");
  process.exit(1);
}

// 1. Read current version from package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const currentVersion = packageJson.version;
const semverParts = currentVersion.split(".").map(Number);

if (semverParts.length !== 3 || semverParts.some(isNaN)) {
  console.error(`Invalid current version: "${currentVersion}"`);
  process.exit(1);
}

let [major, minor, patch] = semverParts;

switch (arg.toLowerCase()) {
  case "patch":
    patch += 1;
    break;
  case "minor":
    minor += 1;
    patch = 0;
    break;
  case "major":
    major += 1;
    minor = 0;
    patch = 0;
    break;
  default:
    if (/^\d+\.\d+\.\d+.*$/.test(arg)) {
      [major, minor, patch] = arg.split(".").map((n) => parseInt(n, 10));
    } else {
      console.error(`Unrecognized bump type or version format: "${arg}"`);
      process.exit(1);
    }
}

const nextVersion = `${major}.${minor}.${patch}`;
console.log(`\x1b[38;2;255;107;0m[Vayli Versioner]\x1b[0m Bumping version: ${currentVersion} -> ${nextVersion}`);

// 2. Update package.json
packageJson.version = nextVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf-8");
console.log(`  ✓ Updated package.json`);

// 3. Update Cargo.toml (only under [package])
let cargoToml = fs.readFileSync(cargoTomlPath, "utf-8");
cargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?version\s*=\s*)"[^"]+"/,
  `$1"${nextVersion}"`
);
fs.writeFileSync(cargoTomlPath, cargoToml, "utf-8");
console.log(`  ✓ Updated src-tauri/Cargo.toml`);

// 4. Update tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
tauriConf.version = nextVersion;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf-8");
console.log(`  ✓ Updated src-tauri/tauri.conf.json`);

console.log(`\x1b[32m  ✓ All manifests synchronized successfully to v${nextVersion}\x1b[0m\n`);
