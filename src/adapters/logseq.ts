import path from "node:path";
import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import { encodeId, decodeId } from "../id.js";
import { listTextFiles, readTextFile, searchTextFiles } from "../fs-search.js";
import type {
  CorpusItem,
  CorpusResult,
  CorpusSource,
  LogseqBlock,
  LogseqPage,
  LogseqPageSearchResult,
  SearchFilters
} from "../types.js";

export interface LogseqPageFilters {
  namespace?: string;
  tag?: string;
  limit?: number;
}

export interface LogseqBlockFilters extends LogseqPageFilters {
  query?: string;
}

export class LogseqSource implements CorpusSource {
  readonly name = "logseq" as const;
  readonly displayName = "Logseq";
  readonly description = "Read-only search over configured Logseq graph folders.";

  constructor(private readonly roots: string[]) {}

  async listPages(filters: LogseqPageFilters = {}): Promise<LogseqPage[]> {
    const files = await this.userFiles();
    const pages: LogseqPage[] = [];

    for (const filePath of files) {
      const content = await readTextFile(filePath);
      if (content === null) {
        continue;
      }

      const page = parseLogseqPage(filePath, content, owningRoot(filePath, this.roots));
      if (filters.namespace && page.namespace !== normalizeNamespace(filters.namespace)) {
        continue;
      }
      if (filters.tag && !page.tags.includes(normalizeTag(filters.tag))) {
        continue;
      }

      pages.push(page);
    }

    return pages.sort((a, b) => a.title.localeCompare(b.title)).slice(0, filters.limit ?? 100);
  }

  async getPage(titleOrId: string): Promise<(LogseqPage & { content: string }) | null> {
    const page = await this.findPage(titleOrId);
    if (!page) {
      return null;
    }
    const content = await readTextFile(page.filePath);
    if (content === null) {
      return null;
    }
    return {
      ...page,
      content
    };
  }

  async listTags(namespace?: string): Promise<{ tag: string; count: number }[]> {
    const pages = await this.listPages({ namespace, limit: Number.MAX_SAFE_INTEGER });
    const counts = new Map<string, number>();
    for (const page of pages) {
      for (const tag of page.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async listNamespaces(): Promise<{ namespace: string; count: number }[]> {
    const pages = await this.listPages({ limit: Number.MAX_SAFE_INTEGER });
    const counts = new Map<string, number>();
    for (const page of pages) {
      if (!page.namespace) {
        continue;
      }
      counts.set(page.namespace, (counts.get(page.namespace) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([namespace, count]) => ({ namespace, count }))
      .sort((a, b) => b.count - a.count || a.namespace.localeCompare(b.namespace));
  }

  async searchBlocks(query: string, filters: LogseqBlockFilters = {}): Promise<LogseqBlock[]> {
    const scoredBlocks = await this.searchScoredBlocks(query, filters);
    return scoredBlocks
      .slice(0, filters.limit ?? 50)
      .map(({ score: _score, ...block }) => block);
  }

  async searchPages(
    query: string,
    filters: LogseqBlockFilters = {}
  ): Promise<LogseqPageSearchResult[]> {
    const scoredBlocks = await this.searchScoredBlocks(query, {
      ...filters,
      limit: Number.MAX_SAFE_INTEGER
    });
    const grouped = new Map<
      string,
      { page: LogseqPage; score: number; matchingBlocks: Array<LogseqBlock & { score: number }> }
    >();

    for (const block of scoredBlocks) {
      const group = grouped.get(block.pageId) ?? {
        page: {
          id: block.pageId,
          title: block.pageTitle,
          filePath: block.filePath,
          graphPath: block.graphPath,
          uri: block.filePath,
          namespace: namespaceFromTitle(block.pageTitle),
          tags: [],
          properties: {},
          stableRef: {
            graphPath: block.graphPath,
            pageTitle: block.pageTitle
          }
        },
        score: 0,
        matchingBlocks: []
      };
      group.score += block.score;
      group.matchingBlocks.push(block);
      grouped.set(block.pageId, group);
    }

    return Array.from(grouped.values())
      .map(({ page, score, matchingBlocks }) => ({
        page,
        score,
        matchingBlocks: matchingBlocks
          .sort((a, b) => b.score - a.score || a.line - b.line)
          .slice(0, 5)
          .map(({ score: _score, ...block }) => block)
      }))
      .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
      .slice(0, filters.limit ?? 20);
  }

  private async searchScoredBlocks(
    query: string,
    filters: LogseqBlockFilters = {}
  ): Promise<Array<LogseqBlock & { score: number }>> {
    const pages = await this.listPages({
      namespace: filters.namespace,
      tag: filters.tag,
      limit: Number.MAX_SAFE_INTEGER
    });
    const terms = tokenizeQuery(query);
    const blocks: Array<LogseqBlock & { score: number }> = [];

    for (const page of pages) {
      const content = await readTextFile(page.filePath);
      if (content === null) {
        continue;
      }
      for (const block of parseLogseqBlocks(page, content)) {
        const score = scoreText(block.text, terms);
        if (score > 0) {
          blocks.push({ ...block, score });
        }
      }
    }

    return blocks
      .sort((a, b) => b.score - a.score || a.pageTitle.localeCompare(b.pageTitle))
      .slice(0, filters.limit ?? 50);
  }

  async search(query: string, filters: SearchFilters): Promise<CorpusResult[]> {
    if (filters.sources && !filters.sources.includes(this.name)) {
      return [];
    }
    if (filters.types && !filters.types.includes("note")) {
      return [];
    }

    const limit = filters.limit ?? 20;
    const files = await this.userFiles();
    const matches = await searchTextFiles(files, query, limit);

    return Promise.all(matches.map(async (match) => {
      const content = await readTextFile(match.filePath);
      const page = parseLogseqPage(
        match.filePath,
        content ?? "",
        owningRoot(match.filePath, this.roots)
      );
      const block = content
        ? findBlockAtLine(parseLogseqBlocks(page, content), match.line)
        : undefined;
      const id = block?.id ?? encodeId([this.name, "line", match.filePath, String(match.line)]);
      return {
        id,
        source: this.name,
        type: "note",
        title: page.title,
        date: dateFromLogseqPath(match.filePath),
        excerpt: match.excerpt,
        uri: `${match.filePath}#L${match.line}`,
        score: match.score,
        provenance: {
          sourceName: this.displayName,
          pathOrUrl: match.filePath,
          locator: `line ${match.line}`
        },
        stableRef: block?.stableRef ?? page.stableRef,
        locator: {
          filePath: match.filePath,
          line: match.line,
          contentHash: block?.contentHash,
          blockUuid: block?.blockUuid
        }
      };
    }));
  }

  async getItem(id: string): Promise<CorpusItem | null> {
    const [source, kind, ...parts] = decodeId(id);
    if (source !== this.name) {
      return null;
    }

    const legacy = kind === "block" || kind === "line";
    const filePath = legacy ? parts[0] : undefined;
    const line = legacy ? parts[1] : undefined;

    if (!legacy) {
      const block = await this.findBlockByDecodedId(kind, parts);
      if (!block) {
        return null;
      }
      const content = await readTextFile(block.filePath);
      if (content === null) {
        return null;
      }
      const info = await stat(block.filePath).catch(() => null);
      return {
        id,
        source: this.name,
        type: "note",
        title: block.pageTitle,
        date: dateFromLogseqPath(block.filePath) ?? info?.mtime.toISOString(),
        excerpt: block.text,
        uri: `${block.filePath}#L${block.line}`,
        score: 1,
        provenance: {
          sourceName: this.displayName,
          pathOrUrl: block.filePath,
          locator: `line ${block.line}`
        },
        stableRef: block.stableRef,
        locator: {
          filePath: block.filePath,
          line: block.line,
          contentHash: block.contentHash,
          blockUuid: block.blockUuid
        },
        content,
        metadata: {
          graphPath: block.graphPath,
          modifiedAt: info?.mtime.toISOString(),
          size: info?.size
        }
      };
    }

    if (!filePath || !line) {
      return null;
    }
    const content = await readTextFile(filePath);
    if (content === null) {
      return null;
    }

    const page = parseLogseqPage(filePath, content, owningRoot(filePath, this.roots));
    const block = findBlockAtLine(parseLogseqBlocks(page, content), Number(line));
    const info = await stat(filePath).catch(() => null);
    return {
      id,
      source: this.name,
      type: "note",
      title: page.title,
      date: dateFromLogseqPath(filePath) ?? info?.mtime.toISOString(),
      excerpt: excerptAtLine(content, Number(line)),
      uri: `${filePath}#L${line}`,
      score: 1,
      provenance: {
        sourceName: this.displayName,
        pathOrUrl: filePath,
        locator: `line ${line}`
      },
      stableRef: block?.stableRef ?? page.stableRef,
      locator: {
        filePath,
        line: Number(line),
        contentHash: block?.contentHash,
        blockUuid: block?.blockUuid
      },
      content,
      metadata: {
        graphPath: owningRoot(filePath, this.roots),
        modifiedAt: info?.mtime.toISOString(),
        size: info?.size
      }
    };
  }

  private async userFiles(): Promise<string[]> {
    return (await listTextFiles(this.roots, new Set([".md", ".org"]))).filter(isUserLogseqFile);
  }

  private async findPage(titleOrId: string): Promise<LogseqPage | null> {
    const decoded = safeDecodeId(titleOrId);
    const title =
      decoded?.[0] === "logseq" && decoded[1] === "page" ? decoded[3] : titleOrId;
    const graphPath =
      decoded?.[0] === "logseq" && decoded[1] === "page" ? decoded[2] : undefined;

    const pages = await this.listPages({ limit: Number.MAX_SAFE_INTEGER });
    return (
      pages.find(
        (page) =>
          normalizePageTitle(page.title) === normalizePageTitle(title) &&
          (!graphPath || page.graphPath === graphPath)
      ) ?? null
    );
  }

  private async findBlockByDecodedId(kind: string, parts: string[]): Promise<LogseqBlock | null> {
    if (kind !== "block-uuid" && kind !== "block-hash") {
      return null;
    }
    const [graphPath, pageTitle, identity, occurrence] = parts;
    const page = await this.findPage(encodeId(["logseq", "page", graphPath, pageTitle]));
    if (!page) {
      return null;
    }
    const content = await readTextFile(page.filePath);
    if (content === null) {
      return null;
    }
    return (
      parseLogseqBlocks(page, content).find((block) =>
        kind === "block-uuid"
          ? block.blockUuid === identity
          : block.contentHash === identity && block.occurrence === Number(occurrence)
      ) ?? null
    );
  }
}

function logseqTitle(filePath: string): string {
  const parsed = path.parse(filePath);
  return decodeURIComponent(parsed.name).replace(/_/g, " ");
}

function isUserLogseqFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  if (normalized.includes("/logseq/version-files/")) {
    return false;
  }
  if (normalized.includes("/logseq/bak/")) {
    return false;
  }
  return normalized.includes("/pages/") || normalized.includes("/journals/");
}

function dateFromLogseqPath(filePath: string): string | undefined {
  const base = path.basename(filePath, path.extname(filePath));
  const match = base.match(/^(\d{4})_(\d{2})_(\d{2})$/);
  if (!match) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function excerptAtLine(content: string, lineNumber: number): string {
  const lines = content.split(/\r?\n/);
  const index = Math.max(0, lineNumber - 1);
  return lines.slice(Math.max(0, index - 2), index + 3).join("\n").slice(0, 1000);
}

function owningRoot(filePath: string, roots: string[]): string | undefined {
  return roots.find((root) => filePath.startsWith(root));
}

function parseLogseqPage(filePath: string, content: string, graphPath?: string): LogseqPage {
  const properties = parseProperties(content);
  const title = properties.title ?? logseqTitle(filePath);
  const namespace = namespaceFromTitle(title);
  const tags = Array.from(
    new Set([
      ...extractTags(properties.tags ?? ""),
      ...extractInlineTagsFromTopLevelTagLines(content)
    ])
  ).sort();

  return {
    id: encodeId(["logseq", "page", graphPath ?? "", title]),
    title,
    filePath,
    graphPath,
    uri: filePath,
    namespace,
    tags,
    properties,
    stableRef: {
      graphPath,
      pageTitle: title
    }
  };
}

function parseProperties(content: string): Record<string, string> {
  const properties: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    if (/^\s*-/.test(line)) {
      break;
    }

    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.*)$/);
    if (!match) {
      continue;
    }
    properties[match[1].toLowerCase()] = match[2].trim();
  }

  return properties;
}

function extractInlineTagsFromTopLevelTagLines(content: string): string[] {
  const tags: string[] = [];
  for (const line of content.split(/\r?\n/).slice(0, 20)) {
    if (!/^\s*-\s*\[\[Tags\]\]:/i.test(line)) {
      continue;
    }
    tags.push(...extractTags(line));
  }
  return tags;
}

function extractTags(value: string): string[] {
  const tags: string[] = [];
  for (const match of value.matchAll(/#(?:\[\[([^\]]+)\]\]|([\p{L}\p{N}/_-]+))/gu)) {
    tags.push(normalizeTag(match[1] ?? match[2]));
  }
  return tags;
}

function namespaceFromTitle(title: string): string | undefined {
  const [namespace] = title.split("/");
  if (!namespace || namespace === title) {
    return undefined;
  }
  return normalizeNamespace(namespace);
}

function normalizeNamespace(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function parseLogseqBlocks(page: LogseqPage, content: string): LogseqBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: LogseqBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)-\s+(.*)$/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const rawText = match[2].trim();
    const propertyLines: string[] = [];
    for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
      const line = lines[lookahead];
      const childMatch = line.match(/^(\s*)-\s+/);
      if (childMatch && childMatch[1].length <= indent) {
        break;
      }
      if (line.match(/^\s+[A-Za-z0-9_-]+::\s*/)) {
        propertyLines.push(line.trim());
      }
    }

    const blockUuid = propertyLines
      .map((line) => line.match(/^id::\s*(.+)$/)?.[1]?.trim())
      .find(Boolean);
    const contentHash = hashText(`${page.title}\n${rawText}`);
    const occurrence =
      blocks.filter((block) => block.pageTitle === page.title && block.contentHash === contentHash)
        .length + 1;
    const id = blockUuid
      ? encodeId(["logseq", "block-uuid", page.graphPath ?? "", page.title, blockUuid])
      : encodeId([
          "logseq",
          "block-hash",
          page.graphPath ?? "",
          page.title,
          contentHash,
          String(occurrence)
        ]);

    blocks.push({
      id,
      pageId: page.id,
      pageTitle: page.title,
      filePath: page.filePath,
      graphPath: page.graphPath,
      line: index + 1,
      text: rawText,
      tags: extractTags(rawText),
      links: extractLinks(rawText),
      blockUuid,
      contentHash,
      occurrence,
      stableRef: {
        graphPath: page.graphPath,
        pageTitle: page.title,
        blockUuid,
        contentHash,
        occurrence
      }
    });
  }

  return blocks;
}

function findBlockAtLine(blocks: LogseqBlock[], line: number): LogseqBlock | undefined {
  return blocks.find((block) => block.line === line);
}

function extractLinks(value: string): string[] {
  return Array.from(value.matchAll(/\[\[([^\]]+)\]\]/g)).map((match) => match[1].trim());
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function tokenizeQuery(query: string): string[] {
  return Array.from(query.toLowerCase().matchAll(/[#\p{L}\p{N}_/\\-]+/gu)).map(
    (match) => match[0]
  );
}

function scoreText(value: string, terms: string[]): number {
  const normalized = value.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? term.length : 0), 0);
}

function normalizePageTitle(value: string): string {
  return value.trim().toLowerCase();
}

function safeDecodeId(id: string): string[] | null {
  try {
    return decodeId(id);
  } catch {
    return null;
  }
}
