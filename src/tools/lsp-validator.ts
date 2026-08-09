import { spawn } from "node:child_process";
import { extname } from "node:path";

export type LspValidation = {
  readonly language: string;
  readonly status: "unsupported" | "server-available" | "server-missing";
  readonly command?: readonly string[];
  readonly note: string;
};

type ServerSpec = {
  readonly language: string;
  readonly command: readonly string[];
};

const SERVER_BY_EXTENSION: ReadonlyMap<string, ServerSpec> = new Map([
  [".ts", { language: "typescript", command: ["typescript-language-server", "--stdio"] }],
  [".tsx", { language: "typescript", command: ["typescript-language-server", "--stdio"] }],
  [".js", { language: "javascript", command: ["typescript-language-server", "--stdio"] }],
  [".jsx", { language: "javascript", command: ["typescript-language-server", "--stdio"] }],
  [".py", { language: "python", command: ["pylsp"] }],
  [".go", { language: "go", command: ["gopls"] }],
  [".java", { language: "java", command: ["jdtls"] }],
  [".kt", { language: "kotlin", command: ["kotlin-language-server"] }],
  [".kts", { language: "kotlin", command: ["kotlin-language-server"] }],
  [".dart", { language: "dart/flutter", command: ["dart", "language-server", "--protocol=lsp"] }],
  [".yaml", { language: "yaml", command: ["yaml-language-server", "--stdio"] }],
  [".yml", { language: "yaml", command: ["yaml-language-server", "--stdio"] }],
  [".css", { language: "css", command: ["vscode-css-language-server", "--stdio"] }],
  [".scss", { language: "css", command: ["vscode-css-language-server", "--stdio"] }],
  [".html", { language: "html", command: ["vscode-html-language-server", "--stdio"] }],
]);

/** Reports whether a language server exists for a changed file so callers can validate with diagnostics when configured. */
export async function validateLspAvailability(path: string): Promise<LspValidation> {
  const spec = SERVER_BY_EXTENSION.get(extname(path).toLowerCase());
  if (spec === undefined) {
    return {
      language: "unknown",
      status: "unsupported",
      note: "No default LSP mapping for this file extension.",
    };
  }

  const available = await commandExists(spec.command[0]);
  if (!available) {
    return {
      language: spec.language,
      status: "server-missing",
      command: spec.command,
      note: `Install ${spec.command[0]} to enable ${spec.language} LSP diagnostics for changed files.`,
    };
  }

  return {
    language: spec.language,
    status: "server-available",
    command: spec.command,
    note: `${spec.language} language server is available on PATH; run diagnostics after related edits.`,
  };
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", () => resolve(true));
  });
}
