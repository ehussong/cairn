import { createReadStream } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { readSearchableDocument } from "./searchable-file.js";

const DEFAULT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".org",
  ".csv",
  ".json",
  ".yaml",
  ".yml"
]);

export interface TextMatch {
  filePath: string;
  line: number;
  excerpt: string;
  score: number;
}

export async function listTextFiles(
  roots: string[],
  extensions = DEFAULT_EXTENSIONS
): Promise<string[]> {
  const files: string[] = [];

  for (const root of roots) {
    await walk(root, files, extensions);
  }

  return files;
}

async function walk(
  currentPath: string,
  files: string[],
  extensions: Set<string>
): Promise<void> {
  let info;
  try {
    info = await stat(currentPath);
  } catch {
    return;
  }

  if (info.isFile()) {
    if (extensions.has(path.extname(currentPath).toLowerCase())) {
      files.push(currentPath);
    }
    return;
  }

  if (!info.isDirectory()) {
    return;
  }

  let dir;
  try {
    dir = await opendir(currentPath);
  } catch {
    return;
  }

  for await (const entry of dir) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    await walk(path.join(currentPath, entry.name), files, extensions);
  }
}

export async function searchTextFiles(
  files: string[],
  query: string,
  limit: number
): Promise<TextMatch[]> {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }

  const matches: TextMatch[] = [];

  for (const filePath of files) {
    if (matches.length >= limit * 3) {
      break;
    }

    const stream = createReadStream(filePath, { encoding: "utf8" });
    const lines = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      const score = scoreLine(line, terms);
      if (score > 0) {
        matches.push({
          filePath,
          line: lineNumber,
          excerpt: line.trim().slice(0, 600),
          score
        });
      }
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function searchSearchableFiles(
  files: string[],
  query: string,
  limit: number
): Promise<TextMatch[]> {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }

  const matches: TextMatch[] = [];

  for (const filePath of files) {
    if (matches.length >= limit * 3) {
      break;
    }

    const document = await readSearchableDocument(filePath);
    if (!document) {
      continue;
    }

    const lines = document.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const score = scoreLine(lines[index], terms);
      if (score > 0) {
        matches.push({
          filePath,
          line: index + 1,
          excerpt: lines[index].trim().slice(0, 600),
          score
        });
      }
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export function tokenize(query: string): string[] {
  return Array.from(query.toLowerCase().matchAll(/[#\p{L}\p{N}_/\\-]+/gu))
    .map((match) => match[0].trim())
    .filter((term) => term.length >= 2);
}

function scoreLine(line: string, terms: string[]): number {
  const normalized = line.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (normalized.includes(term)) {
      score += term.length;
    }
  }

  return score;
}
