# Cairn Router

Cairn Router is a small, read-only MCP gateway prototype for querying a personal
corpus through one normalized interface.

This first version indexes local folders only:

- Logseq graphs via `CAIRN_LOGSEQ_DIRS`
- Generic local text/PDF folders via `CAIRN_LOCAL_DIRS`

It does not store, sync, mutate, OCR, or interpret content. It serves searchable
results to an LLM with stable provenance fields.

PDF search uses `pdftotext` when it is available on `PATH`.

## Run

```bash
npm install
npm run build
cp cairn.config.example.json cairn.config.json
npm start
```

You can also configure sources with environment variables:

```bash
CAIRN_LOGSEQ_DIRS="/path/to/logseq:/path/to/other-graph" \
CAIRN_LOCAL_DIRS="/path/to/docs" \
npm start
```

Multiple directories can be separated with `:`. Environment variables are merged
with `cairn.config.json`. Local `cairn.config.json` is ignored by git.

## CLI Smoke Tests

The same router can be queried without an MCP client:

```bash
npm run query -- sources
npm run query -- search "systems thinking" --source logseq --limit 5
npm run query -- get "<result-id>"
npm run query -- related "<result-id>"
npm run query -- logseq-pages --namespace Readwise --tag leadership
npm run query -- logseq-page "Readwise/Dealing With Difficult People (highlights)"
npm run query -- logseq-tags --namespace Readwise
npm run query -- logseq-namespaces
npm run query -- logseq-blocks "change management" --namespace Readwise --tag leadership
npm run query -- logseq-search-pages "change management" --namespace Readwise --tag leadership
```

## MCP Tools

- `list_sources`
- `search_corpus`
- `search_by_source`
- `get_item`
- `get_related`
- `list_logseq_pages`
- `get_logseq_page`
- `list_logseq_tags`
- `list_logseq_namespaces`
- `search_logseq_blocks`
- `search_logseq_pages`

## Result Shape

```json
{
  "id": "logseq:block:...",
  "source": "logseq",
  "type": "note",
  "title": "Page title",
  "date": "2026-07-30",
  "excerpt": "matching context",
  "uri": "/absolute/path.md#L12",
  "provenance": {
    "sourceName": "Logseq",
    "pathOrUrl": "/absolute/path.md",
    "locator": "line 12"
  }
}
```
