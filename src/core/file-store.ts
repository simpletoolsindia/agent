import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./hash.js";

export type TextFile = {
  readonly content: string;
  readonly hash: string;
};

export type DurabilityMode = "safe" | "fast";

/** File access boundary. Tools use this instead of calling fs directly. */
export class NodeFileStore {
  public async readText(absPath: string): Promise<TextFile> {
    const content = await readFile(absPath, "utf8");
    return { content, hash: sha256(content) };
  }

  public async writeTextAtomic(absPath: string, content: string, durability: DurabilityMode = "safe"): Promise<TextFile> {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFileAtomic(absPath, content, { encoding: "utf8", fsync: durability === "safe" });
    return { content, hash: sha256(content) };
  }

  public async exists(absPath: string): Promise<boolean> {
    try {
      await stat(absPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }
}
