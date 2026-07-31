import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".org",
  ".csv",
  ".json",
  ".yaml",
  ".yml"
]);

export const DOCUMENT_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".pdf"]);

export interface SearchableDocument {
  content: string;
  extraction: {
    kind: "text" | "pdf";
    tool?: string;
    truncated: boolean;
  };
}

const MAX_CONTENT_CHARS = 80_000;

export async function readSearchableDocument(filePath: string): Promise<SearchableDocument | null> {
  const extension = path.extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    return readTextDocument(filePath);
  }

  if (extension === ".pdf") {
    return readPdfDocument(filePath);
  }

  return null;
}

function itemTypeForPath(filePath: string): "document" | "file" {
  return path.extname(filePath).toLowerCase() === ".pdf" ? "document" : "file";
}

export { itemTypeForPath };

async function readTextDocument(filePath: string): Promise<SearchableDocument | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return {
      content: truncate(content),
      extraction: {
        kind: "text",
        truncated: content.length > MAX_CONTENT_CHARS
      }
    };
  } catch {
    return null;
  }
}

async function readPdfDocument(filePath: string): Promise<SearchableDocument | null> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000
    });
    return {
      content: truncate(stdout),
      extraction: {
        kind: "pdf",
        tool: "pdftotext",
        truncated: stdout.length > MAX_CONTENT_CHARS
      }
    };
  } catch {
    return null;
  }
}

function truncate(content: string): string {
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) : content;
}
