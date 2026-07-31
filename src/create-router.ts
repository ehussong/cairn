import { LogseqSource } from "./adapters/logseq.js";
import { LocalFolderSource } from "./adapters/local.js";
import { loadConfig, type RouterConfig } from "./config.js";
import { CorpusRouter } from "./router.js";

export function createRouter(config: RouterConfig = loadConfig()): CorpusRouter {
  return new CorpusRouter([
    ...(config.logseqDirs.length > 0 ? [new LogseqSource(config.logseqDirs)] : []),
    ...(config.localDirs.length > 0 ? [new LocalFolderSource(config.localDirs)] : [])
  ]);
}
