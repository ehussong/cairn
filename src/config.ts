import path from "node:path";
import { readFileSync } from "node:fs";

export interface RouterConfig {
  logseqDirs: string[];
  localDirs: string[];
}

export function loadConfig(env = process.env): RouterConfig {
  const fileConfig = loadConfigFile(env.CAIRN_CONFIG);
  return {
    logseqDirs: mergeDirs(fileConfig.logseqDirs, splitDirs(env.CAIRN_LOGSEQ_DIRS)),
    localDirs: mergeDirs(fileConfig.localDirs, splitDirs(env.CAIRN_LOCAL_DIRS))
  };
}

function loadConfigFile(configPath: string | undefined): RouterConfig {
  const resolvedPath = path.resolve(configPath ?? "cairn.config.json");
  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, "utf8")) as Partial<RouterConfig>;
    return {
      logseqDirs: normalizeDirs(parsed.logseqDirs ?? []),
      localDirs: normalizeDirs(parsed.localDirs ?? [])
    };
  } catch {
    return {
      logseqDirs: [],
      localDirs: []
    };
  }
}

function splitDirs(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return normalizeDirs(
    value
    .split(":")
    .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function normalizeDirs(dirs: string[]): string[] {
  return dirs.map((entry) => path.resolve(entry));
}

function mergeDirs(...dirGroups: string[][]): string[] {
  return Array.from(new Set(dirGroups.flat()));
}
