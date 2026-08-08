import { isAbsolute, relative, resolve, sep } from "node:path";
import { ToolError } from "./tool.js";

/** Prevents tools from reading or writing outside the configured workspace. */
export class WorkspacePathPolicy {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public resolveInside(inputPath: string): string {
    const resolved = resolve(this.root, inputPath);
    const rel = relative(this.root, resolved);

    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ToolError("Path escapes workspace", "PATH_ESCAPE", { path: inputPath });
    }

    return resolved;
  }

  public relativeToRoot(absPath: string): string {
    return relative(this.root, absPath);
  }
}
