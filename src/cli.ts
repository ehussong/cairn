import { createRouter } from "./create-router.js";
import type { SearchFilters, SourceName } from "./types.js";

const [command, ...args] = process.argv.slice(2);
const router = createRouter();

switch (command) {
  case "sources":
    print(router.listSources());
    break;
  case "search":
    await search(args);
    break;
  case "get":
    await get(args);
    break;
  case "related":
    await related(args);
    break;
  case "logseq-pages":
    await logseqPages(args);
    break;
  case "logseq-page":
    await logseqPage(args);
    break;
  case "logseq-tags":
    await logseqTags(args);
    break;
  case "logseq-namespaces":
    await logseqNamespaces();
    break;
  case "logseq-blocks":
    await logseqBlocks(args);
    break;
  case "logseq-search-pages":
    await logseqSearchPages(args);
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}

async function search(args: string[]) {
  const { query, filters } = parseSearchArgs(args);
  if (!query) {
    usage();
    process.exit(1);
  }

  print(await router.searchCorpus(query, filters));
}

async function get(args: string[]) {
  const [id] = args;
  if (!id) {
    usage();
    process.exit(1);
  }

  print(await router.getItem(id));
}

async function related(args: string[]) {
  const [id] = args;
  if (!id) {
    usage();
    process.exit(1);
  }

  print(await router.getRelated(id, 10));
}

async function logseqPages(args: string[]) {
  let namespace: string | undefined;
  let tag: string | undefined;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--namespace") {
      namespace = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--tag") {
      tag = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      limit = Number(args[index + 1]);
      index += 1;
    }
  }

  const pages = await router.listLogseqPages({ namespace, tag, limit });
  print({
    count: pages.length,
    pages
  });
}

async function logseqPage(args: string[]) {
  const titleOrId = args.join(" ");
  if (!titleOrId) {
    usage();
    process.exit(1);
  }

  print(await router.getLogseqPage(titleOrId));
}

async function logseqTags(args: string[]) {
  const namespace = valueAfter(args, "--namespace");
  const tags = await router.listLogseqTags(namespace);
  print({
    count: tags.length,
    tags
  });
}

async function logseqNamespaces() {
  const namespaces = await router.listLogseqNamespaces();
  print({
    count: namespaces.length,
    namespaces
  });
}

async function logseqBlocks(args: string[]) {
  const { query, namespace, tag, limit } = parseLogseqSearchArgs(args);
  if (!query) {
    usage();
    process.exit(1);
  }

  const blocks = await router.searchLogseqBlocks(query, { namespace, tag, limit });
  print({
    count: blocks.length,
    blocks
  });
}

async function logseqSearchPages(args: string[]) {
  const { query, namespace, tag, limit } = parseLogseqSearchArgs(args);
  if (!query) {
    usage();
    process.exit(1);
  }

  const pages = await router.searchLogseqPages(query, { namespace, tag, limit });
  print({
    count: pages.length,
    pages
  });
}

function parseLogseqSearchArgs(args: string[]): {
  query: string;
  namespace?: string;
  tag?: string;
  limit?: number;
} {
  let namespace: string | undefined;
  let tag: string | undefined;
  let limit: number | undefined;
  const queryParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--namespace") {
      namespace = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--tag") {
      tag = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      limit = Number(args[index + 1]);
      index += 1;
      continue;
    }
    queryParts.push(arg);
  }

  return {
    query: queryParts.join(" "),
    namespace,
    tag,
    limit
  };
}


function parseSearchArgs(args: string[]): { query: string; filters: SearchFilters } {
  const filters: SearchFilters = {};
  const queryParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source") {
      filters.sources = [...(filters.sources ?? []), args[index + 1] as SourceName];
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      filters.limit = Number(args[index + 1]);
      index += 1;
      continue;
    }
    queryParts.push(arg);
  }

  return {
    query: queryParts.join(" "),
    filters
  };
}

function valueAfter(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(`Cairn Router CLI

Usage:
  npm run query -- sources
  npm run query -- search "query terms" [--source logseq|local] [--limit 20]
  npm run query -- get <id>
  npm run query -- related <id>
  npm run query -- logseq-pages [--namespace Readwise] [--tag leadership] [--limit 100]
  npm run query -- logseq-page "Readwise/Dealing With Difficult People (highlights)"
  npm run query -- logseq-tags [--namespace Readwise]
  npm run query -- logseq-namespaces
  npm run query -- logseq-blocks "query terms" [--namespace Readwise] [--tag leadership]
  npm run query -- logseq-search-pages "query terms" [--namespace Readwise] [--tag leadership]

Config:
  Copy cairn.config.example.json to cairn.config.json, or set:
  CAIRN_CONFIG=/path/to/config.json
  CAIRN_LOGSEQ_DIRS="/path/to/graph:/path/to/other-graph"
  CAIRN_LOCAL_DIRS="/path/to/docs"
`);
}
