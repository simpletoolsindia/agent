import { constants } from "node:fs";
import { access, readlink, realpath, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";

export type DoctorStatus = "pass" | "warn" | "fail";

export type DoctorCheck = {
  readonly label: string;
  readonly status: DoctorStatus;
  readonly detail: string;
  readonly next?: string;
};

export type DoctorReportOptions = {
  readonly cwd: string;
  readonly model: string;
  readonly baseURL?: string;
  readonly apiKey?: string;
  readonly binName?: string;
  readonly installBinDir?: string;
  readonly cliPath?: string;
  readonly envPath?: string;
};

const DEFAULT_BIN_NAME = "harness";
const MIN_NODE_MAJOR = 20;

/**
 * Builds a deterministic setup report for users and install scripts.
 *
 * The checks are intentionally local and side-effect free: the doctor explains
 * missing config, stale build artifacts, and PATH/link issues without starting
 * Ollama, contacting a provider, or mutating the workspace.
 */
export async function createDoctorReport(options: DoctorReportOptions): Promise<string> {
  const checks = await runDoctorChecks(options);
  return formatDoctorReport(options, checks);
}

export async function runDoctorChecks(options: DoctorReportOptions): Promise<readonly DoctorCheck[]> {
  const binName = options.binName ?? DEFAULT_BIN_NAME;
  const installBinDir = options.installBinDir ?? join(process.env.HOME ?? "", ".local/bin");
  const cliPath = options.cliPath ?? process.argv[1];

  return [
    checkNodeVersion(),
    await checkWorkspace(options.cwd),
    await checkCliBuild(cliPath),
    checkProviderConfig(options),
    checkPathContains(installBinDir, options.envPath ?? process.env.PATH ?? ""),
    await checkInstallLink(join(installBinDir, binName), cliPath),
  ];
}

function checkNodeVersion(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major >= MIN_NODE_MAJOR) {
    return pass("Node.js runtime", `Node ${process.version} satisfies >=${MIN_NODE_MAJOR}.`);
  }

  return fail("Node.js runtime", `Node ${process.version} is too old.`, `Install Node.js ${MIN_NODE_MAJOR} or newer.`);
}

async function checkWorkspace(cwd: string): Promise<DoctorCheck> {
  try {
    const meta = await stat(resolve(cwd));
    if (meta.isDirectory()) {
      return pass("Workspace", resolve(cwd));
    }

    return fail("Workspace", `${cwd} exists but is not a directory.`, "Pass --cwd with a project directory.");
  } catch {
    return fail("Workspace", `${cwd} does not exist.`, "Create the project directory or pass --cwd with an existing path.");
  }
}

async function checkCliBuild(cliPath: string | undefined): Promise<DoctorCheck> {
  if (cliPath === undefined || cliPath.length === 0) {
    return warn("Built CLI", "Could not determine the current CLI entry path.", "Run npm run build, then retry harness doctor.");
  }

  try {
    await access(cliPath, constants.R_OK);
    return pass("Built CLI", resolve(cliPath));
  } catch {
    return fail("Built CLI", `${cliPath} is missing or unreadable.`, "Run npm run build or ./install.sh from the repository root.");
  }
}

function checkProviderConfig(options: DoctorReportOptions): DoctorCheck {
  if ((options.apiKey ?? "").trim().length > 0) {
    const endpoint = options.baseURL === undefined ? "OpenAI default endpoint" : options.baseURL;
    return pass("Model provider", `${options.model} via ${endpoint}.`);
  }

  if (options.baseURL !== undefined && options.baseURL.includes("localhost:11434")) {
    return warn("Model provider", "Ollama endpoint selected but no API key supplied.", "Use --api-key ollama; Ollama ignores the value but the client requires one.");
  }

  return warn("Model provider", "No API key is configured.", "Run harness tui --setup, set OPENAI_API_KEY, or use Ollama with --base-url http://localhost:11434/v1 --api-key ollama.");
}

function checkPathContains(binDir: string, pathValue: string): DoctorCheck {
  const normalizedBinDir = resolve(binDir);
  const hasPath = pathValue.split(delimiter).some((entry) => entry.length > 0 && resolve(entry) === normalizedBinDir);
  if (hasPath) {
    return pass("Shell PATH", `${binDir} is on PATH.`);
  }

  return warn("Shell PATH", `${binDir} is not on PATH.`, `Add: export PATH=\"${binDir}:$PATH\"`);
}

async function checkInstallLink(linkPath: string, cliPath: string | undefined): Promise<DoctorCheck> {
  try {
    const target = await readlink(linkPath);
    const resolvedLink = await realpath(linkPath);
    const expectedTarget = cliPath === undefined ? undefined : await realpathOrResolve(cliPath);
    if (expectedTarget === undefined || resolvedLink === expectedTarget) {
      return pass("Command link", `${linkPath} -> ${target}`);
    }

    return warn("Command link", `${linkPath} points to ${target}.`, "Run ./install.sh again from the clone you want to use.");
  } catch {
    return warn("Command link", `${linkPath} is not installed yet.`, "Run ./install.sh, then open a new shell if PATH changed.");
  }
}

async function realpathOrResolve(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function formatDoctorReport(options: DoctorReportOptions, checks: readonly DoctorCheck[]): string {
  const binName = options.binName ?? DEFAULT_BIN_NAME;
  const lines = [
    "Harness setup doctor",
    `Workspace: ${resolve(options.cwd)}`,
    `Model: ${options.model}`,
    "",
    ...checks.map(formatCheck),
    "",
    "Next start commands:",
    `  ${binName} tui --setup`,
    `  ${binName} ai --prompt \"Read package.json and explain the scripts\"`,
    "",
    "Local Ollama example:",
    `  ${binName} tui --model qwen2.5-coder:7b --base-url http://localhost:11434/v1 --api-key ollama`,
  ];

  return lines.join("\n");
}

function formatCheck(check: DoctorCheck): string {
  const prefix = check.status === "pass" ? "ok" : check.status;
  const base = `[${prefix}] ${check.label}: ${check.detail}`;
  return check.next === undefined ? base : `${base}\n       Next: ${check.next}`;
}

function pass(label: string, detail: string): DoctorCheck {
  return { label, detail, status: "pass" };
}

function warn(label: string, detail: string, next?: string): DoctorCheck {
  return { label, detail, next, status: "warn" };
}

function fail(label: string, detail: string, next: string): DoctorCheck {
  return { label, detail, next, status: "fail" };
}
