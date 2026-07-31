import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRouter } from "./create-router.js";
import type { SearchFilters, SourceName } from "./types.js";

const router = createRouter();
const server = new McpServer({
  name: "cairn-router",
  version: "0.1.0"
});

const sourceSchema = z.enum(["logseq", "local"]);
const typeSchema = z.enum(["document", "note", "email", "highlight", "article", "file"]);

const filtersSchema = z.object({
  sources: z.array(sourceSchema).optional(),
  types: z.array(typeSchema).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

server.registerTool(
  "list_sources",
  {
    title: "List corpus sources",
    description: "List configured read-only sources available through Cairn Router.",
    inputSchema: {}
  },
  async () => jsonResponse(router.listSources())
);

server.registerTool(
  "search_corpus",
  {
    title: "Search corpus",
    description: "Search all configured corpus sources and return normalized, provenance-rich results.",
    inputSchema: {
      query: z.string().min(1),
      filters: filtersSchema.optional()
    }
  },
  async ({ query, filters }) => {
    const results = await router.searchCorpus(query, normalizeFilters(filters));
    return jsonResponse(results);
  }
);

server.registerTool(
  "search_by_source",
  {
    title: "Search one source",
    description: "Search a single configured source by name.",
    inputSchema: {
      source: sourceSchema,
      query: z.string().min(1),
      filters: filtersSchema.optional()
    }
  },
  async ({ source, query, filters }) => {
    const results = await router.searchBySource(
      source as SourceName,
      query,
      normalizeFilters(filters)
    );
    return jsonResponse(results);
  }
);

server.registerTool(
  "get_item",
  {
    title: "Get corpus item",
    description: "Fetch a full item by normalized Cairn Router id.",
    inputSchema: {
      id: z.string().min(1)
    }
  },
  async ({ id }) => {
    const item = await router.getItem(id);
    return jsonResponse(item ?? { error: "Item not found", id });
  }
);

server.registerTool(
  "get_related",
  {
    title: "Get related items",
    description: "Find related items using explicit tags, wiki links, and title terms.",
    inputSchema: {
      id: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional()
    }
  },
  async ({ id, limit }) => {
    const results = await router.getRelated(id, limit ?? 10);
    return jsonResponse(results);
  }
);

server.registerTool(
  "list_logseq_pages",
  {
    title: "List Logseq pages",
    description:
      "List Logseq pages with structured filters such as namespace and page-level tag.",
    inputSchema: {
      namespace: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional()
    }
  },
  async ({ namespace, tag, limit }) => {
    const pages = await router.listLogseqPages({ namespace, tag, limit });
    return jsonResponse({
      count: pages.length,
      pages
    });
  }
);

server.registerTool(
  "get_logseq_page",
  {
    title: "Get Logseq page",
    description: "Fetch a Logseq page by title or Cairn page id.",
    inputSchema: {
      titleOrId: z.string().min(1)
    }
  },
  async ({ titleOrId }) => {
    const page = await router.getLogseqPage(titleOrId);
    return jsonResponse(page ?? { error: "Logseq page not found", titleOrId });
  }
);

server.registerTool(
  "list_logseq_tags",
  {
    title: "List Logseq tags",
    description: "List page-level Logseq tags, optionally scoped to a namespace.",
    inputSchema: {
      namespace: z.string().optional()
    }
  },
  async ({ namespace }) => {
    const tags = await router.listLogseqTags(namespace);
    return jsonResponse({
      count: tags.length,
      tags
    });
  }
);

server.registerTool(
  "list_logseq_namespaces",
  {
    title: "List Logseq namespaces",
    description: "List Logseq page namespaces and page counts.",
    inputSchema: {}
  },
  async () => {
    const namespaces = await router.listLogseqNamespaces();
    return jsonResponse({
      count: namespaces.length,
      namespaces
    });
  }
);

server.registerTool(
  "search_logseq_blocks",
  {
    title: "Search Logseq blocks",
    description:
      "Search Logseq bullet blocks with optional namespace and page-level tag filters.",
    inputSchema: {
      query: z.string().min(1),
      namespace: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional()
    }
  },
  async ({ query, namespace, tag, limit }) => {
    const blocks = await router.searchLogseqBlocks(query, { namespace, tag, limit });
    return jsonResponse({
      count: blocks.length,
      blocks
    });
  }
);

server.registerTool(
  "search_logseq_pages",
  {
    title: "Search Logseq pages",
    description:
      "Search Logseq pages and return ranked pages with matching evidence blocks/snippets.",
    inputSchema: {
      query: z.string().min(1),
      namespace: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    }
  },
  async ({ query, namespace, tag, limit }) => {
    const pages = await router.searchLogseqPages(query, { namespace, tag, limit });
    return jsonResponse({
      count: pages.length,
      pages
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

function normalizeFilters(filters: z.infer<typeof filtersSchema> | undefined): SearchFilters {
  return {
    sources: filters?.sources,
    types: filters?.types,
    limit: filters?.limit
  };
}

function jsonResponse(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
