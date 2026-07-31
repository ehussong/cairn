import {
  LogseqSource,
  type LogseqBlockFilters,
  type LogseqPageFilters
} from "./adapters/logseq.js";
import type {
  CorpusItem,
  CorpusResult,
  LogseqBlock,
  CorpusSource,
  LogseqPage,
  LogseqPageSearchResult,
  SearchFilters,
  SourceName
} from "./types.js";

export class CorpusRouter {
  constructor(private readonly sources: CorpusSource[]) {}

  listSources() {
    return this.sources.map((source) => ({
      name: source.name,
      displayName: source.displayName,
      description: source.description
    }));
  }

  async searchCorpus(query: string, filters: SearchFilters): Promise<CorpusResult[]> {
    const limit = filters.limit ?? 20;
    const selected = this.selectSources(filters.sources);
    const results = await Promise.all(
      selected.map((source) => source.search(query, { ...filters, limit }))
    );

    return dedupe(results.flat())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchBySource(
    sourceName: SourceName,
    query: string,
    filters: SearchFilters
  ): Promise<CorpusResult[]> {
    const source = this.sources.find((candidate) => candidate.name === sourceName);
    if (!source) {
      return [];
    }
    return source.search(query, { ...filters, sources: [sourceName] });
  }

  async getItem(id: string): Promise<CorpusItem | null> {
    for (const source of this.sources) {
      const item = await source.getItem(id);
      if (item) {
        return item;
      }
    }
    return null;
  }

  async getRelated(id: string, limit: number): Promise<CorpusResult[]> {
    const item = await this.getItem(id);
    if (!item) {
      return [];
    }

    const query = relatedQuery(item);
    if (query.length === 0) {
      return [];
    }

    const results = await this.searchCorpus(query, { limit: limit + 1 });
    return results.filter((result) => result.id !== id).slice(0, limit);
  }

  async listLogseqPages(filters: LogseqPageFilters): Promise<LogseqPage[]> {
    const pages = await Promise.all(this.logseqSources().map((source) => source.listPages(filters)));
    return pages.flat().sort((a, b) => a.title.localeCompare(b.title));
  }

  async getLogseqPage(titleOrId: string): Promise<(LogseqPage & { content: string }) | null> {
    for (const source of this.logseqSources()) {
      const page = await source.getPage(titleOrId);
      if (page) {
        return page;
      }
    }
    return null;
  }

  async listLogseqTags(namespace?: string): Promise<{ tag: string; count: number }[]> {
    const tagGroups = await Promise.all(
      this.logseqSources().map((source) => source.listTags(namespace))
    );
    const counts = new Map<string, number>();
    for (const { tag, count } of tagGroups.flat()) {
      counts.set(tag, (counts.get(tag) ?? 0) + count);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async listLogseqNamespaces(): Promise<{ namespace: string; count: number }[]> {
    const namespaceGroups = await Promise.all(
      this.logseqSources().map((source) => source.listNamespaces())
    );
    const counts = new Map<string, number>();
    for (const { namespace, count } of namespaceGroups.flat()) {
      counts.set(namespace, (counts.get(namespace) ?? 0) + count);
    }
    return Array.from(counts.entries())
      .map(([namespace, count]) => ({ namespace, count }))
      .sort((a, b) => b.count - a.count || a.namespace.localeCompare(b.namespace));
  }

  async searchLogseqBlocks(query: string, filters: LogseqBlockFilters): Promise<LogseqBlock[]> {
    const blockGroups = await Promise.all(
      this.logseqSources().map((source) => source.searchBlocks(query, filters))
    );
    return blockGroups.flat().slice(0, filters.limit ?? 50);
  }

  async searchLogseqPages(
    query: string,
    filters: LogseqBlockFilters
  ): Promise<LogseqPageSearchResult[]> {
    const pageGroups = await Promise.all(
      this.logseqSources().map((source) => source.searchPages(query, filters))
    );
    return pageGroups
      .flat()
      .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
      .slice(0, filters.limit ?? 20);
  }

  private selectSources(names?: SourceName[]) {
    if (!names || names.length === 0) {
      return this.sources;
    }
    return this.sources.filter((source) => names.includes(source.name));
  }

  private logseqSources(): LogseqSource[] {
    return this.sources.filter((source): source is LogseqSource => source instanceof LogseqSource);
  }
}

function dedupe(results: CorpusResult[]): CorpusResult[] {
  const seen = new Set<string>();
  const unique: CorpusResult[] = [];

  for (const result of results) {
    const key = `${result.source}:${result.provenance.pathOrUrl}:${result.provenance.locator ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(result);
  }

  return unique;
}

function relatedQuery(item: CorpusItem): string {
  const titleTerms = item.title.split(/\s+/).filter((term) => term.length > 3);
  const tagTerms = Array.from(item.content.matchAll(/#[\p{L}\p{N}/_-]+/gu)).map(
    (match) => match[0]
  );
  const linkTerms = Array.from(item.content.matchAll(/\[\[([^\]]+)\]\]/g)).map(
    (match) => match[1]
  );

  return [...tagTerms, ...linkTerms, ...titleTerms].slice(0, 8).join(" ");
}
