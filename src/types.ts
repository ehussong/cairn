export type SourceName = "logseq" | "local";

export type CorpusItemType =
  | "document"
  | "note"
  | "email"
  | "highlight"
  | "article"
  | "file";

export interface SearchFilters {
  sources?: SourceName[];
  types?: CorpusItemType[];
  limit?: number;
}

export interface CorpusResult {
  id: string;
  source: SourceName;
  type: CorpusItemType;
  title: string;
  date?: string;
  excerpt: string;
  uri: string;
  score: number;
  provenance: {
    sourceName: string;
    pathOrUrl: string;
    locator?: string;
  };
  stableRef?: Record<string, unknown>;
  locator?: Record<string, unknown>;
}

export interface CorpusItem extends CorpusResult {
  content: string;
  metadata: Record<string, unknown>;
}

export interface CorpusSource {
  name: SourceName;
  displayName: string;
  description: string;
  search(query: string, filters: SearchFilters): Promise<CorpusResult[]>;
  getItem(id: string): Promise<CorpusItem | null>;
}

export interface LogseqPage {
  id: string;
  title: string;
  filePath: string;
  graphPath?: string;
  uri: string;
  namespace?: string;
  tags: string[];
  properties: Record<string, string>;
  stableRef: {
    graphPath?: string;
    pageTitle: string;
  };
}

export interface LogseqBlock {
  id: string;
  pageId: string;
  pageTitle: string;
  filePath: string;
  graphPath?: string;
  line: number;
  text: string;
  tags: string[];
  links: string[];
  blockUuid?: string;
  contentHash: string;
  occurrence: number;
  stableRef: {
    graphPath?: string;
    pageTitle: string;
    blockUuid?: string;
    contentHash: string;
    occurrence: number;
  };
}

export interface LogseqPageSearchResult {
  page: LogseqPage;
  score: number;
  matchingBlocks: LogseqBlock[];
}
