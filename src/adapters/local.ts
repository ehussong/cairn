import path from "node:path";
import { stat } from "node:fs/promises";
import { encodeId, decodeId } from "../id.js";
import { listTextFiles, searchSearchableFiles } from "../fs-search.js";
import {
  DOCUMENT_EXTENSIONS,
  itemTypeForPath,
  readSearchableDocument
} from "../searchable-file.js";
import type {
  CorpusItem,
  CorpusItemType,
  CorpusResult,
  CorpusSource,
  SearchFilters
} from "../types.js";

export class LocalFolderSource implements CorpusSource {
  readonly name = "local" as const;
  readonly displayName = "Local files";
  readonly description = "Read-only search over configured local text and PDF folders.";

  constructor(private readonly roots: string[]) {}

  async search(query: string, filters: SearchFilters): Promise<CorpusResult[]> {
    if (filters.sources && !filters.sources.includes(this.name)) {
      return [];
    }

    const limit = filters.limit ?? 20;
    const files = await listTextFiles(this.roots, DOCUMENT_EXTENSIONS);
    const matches = await searchSearchableFiles(files, query, limit);

    return matches
      .map((match) => {
        const type = itemTypeForPath(match.filePath);
        return {
          id: encodeId([this.name, "file", match.filePath, String(match.line)]),
          source: this.name,
          type,
          title: path.basename(match.filePath),
          excerpt: match.excerpt,
          uri: `${match.filePath}#L${match.line}`,
          score: match.score,
          provenance: {
            sourceName: this.displayName,
            pathOrUrl: match.filePath,
            locator: `line ${match.line}`
          },
          stableRef: {
            filePath: match.filePath
          },
          locator: {
            filePath: match.filePath,
            line: match.line
          }
        } satisfies CorpusResult;
      })
      .filter((result) => typeAllowed(result.type, filters.types));
  }

  async getItem(id: string): Promise<CorpusItem | null> {
    const [source, kind, filePath, line] = decodeId(id);
    if (source !== this.name || kind !== "file") {
      return null;
    }

    const document = await readSearchableDocument(filePath);
    if (document === null) {
      return null;
    }

    const info = await stat(filePath).catch(() => null);
    return {
      id,
      source: this.name,
      type: itemTypeForPath(filePath),
      title: path.basename(filePath),
      date: info?.mtime.toISOString(),
      excerpt: document.content.slice(0, 600),
      uri: line ? `${filePath}#L${line}` : filePath,
      score: 1,
      provenance: {
        sourceName: this.displayName,
        pathOrUrl: filePath,
        locator: line ? `line ${line}` : undefined
      },
      stableRef: {
        filePath
      },
      locator: {
        filePath,
        line: line ? Number(line) : undefined
      },
      content: document.content,
      metadata: {
        size: info?.size,
        modifiedAt: info?.mtime.toISOString(),
        extraction: document.extraction
      }
    };
  }
}

function typeAllowed(type: CorpusItemType, types: CorpusItemType[] | undefined): boolean {
  return !types || types.length === 0 || types.includes(type);
}
