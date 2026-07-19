import { existsSync } from "node:fs";
import path from "node:path";

export function findDirectory(p: string, maxDepth = 5) {
  let depth = 0;

  while (depth < maxDepth) {
    const rel = "../".repeat(depth) + p;
    const fullPath = path.join(import.meta.dirname, rel);
    if (existsSync(fullPath)) return fullPath;
    depth += 1;
  }

  throw new Error(`Dynamic Mapping - Directory not found: ${p}`);
}
