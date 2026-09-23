export interface LanguageExtensionInfo {
  languageName: string;
  query: string;
}

interface LanguageEntry extends LanguageExtensionInfo {
  extensions: string[];
}

/**
 * Languages whose call hierarchy comes from a separately installed extension. Queries are marketplace
 * keyword tags rather than extension IDs, so they work on both the VS Code Marketplace and Open VSX
 * and survive an extension being renamed or replaced.
 */
const LANGUAGES: LanguageEntry[] = [
  { languageName: "Go", extensions: ["go"], query: "tag:go" },
  { languageName: "Rust", extensions: ["rs"], query: "tag:rust" },
  { languageName: "Python", extensions: ["py"], query: "tag:python" },
  { languageName: "Java", extensions: ["java"], query: "tag:java" },
  { languageName: "C#", extensions: ["cs"], query: "tag:csharp" },
  { languageName: "C/C++", extensions: ["c", "cpp", "cc", "cxx", "h", "hpp"], query: "tag:c" },
  { languageName: "PHP", extensions: ["php"], query: "tag:php" },
  { languageName: "Kotlin", extensions: ["kt", "kts"], query: "tag:kotlin" },
  { languageName: "Dart", extensions: ["dart"], query: "tag:dart" },
  { languageName: "Ruby", extensions: ["rb"], query: "tag:ruby" },
  { languageName: "Swift", extensions: ["swift"], query: "tag:swift" },
  { languageName: "Scala", extensions: ["scala", "sc"], query: "tag:scala" },
  { languageName: "Zig", extensions: ["zig"], query: "tag:zig" },
  { languageName: "Lua", extensions: ["lua"], query: "tag:lua" },
];

/** Served by VS Code's built-in TypeScript support, so there is never an extension to suggest. */
const BUILT_IN_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

const BY_EXTENSION = new Map(
  LANGUAGES.flatMap((lang) => lang.extensions.map((ext) => [ext, lang] as const)),
);

/** Source files the graph knows how to read. */
export const CODE_FILE = new RegExp(
  `\\.(${[...BUILT_IN_EXTENSIONS, ...LANGUAGES.flatMap((lang) => lang.extensions)].join("|")})$`,
  "i",
);

/** The friendly language name and a marketplace search for its language servers. */
export function getLanguageExtensionInfo(filePath: string): LanguageExtensionInfo | undefined {
  const lang = BY_EXTENSION.get(/\.([^./\\]+)$/.exec(filePath)?.[1].toLowerCase() ?? "");
  return lang && { languageName: lang.languageName, query: lang.query };
}

/** The language most of `filePaths` are written in, for a graph that spans several files. */
export function dominantLanguage(filePaths: string[]): LanguageExtensionInfo | undefined {
  const counts = new Map<string, { info: LanguageExtensionInfo; count: number }>();
  for (const filePath of filePaths) {
    const info = getLanguageExtensionInfo(filePath);
    if (!info) continue;
    const entry = counts.get(info.languageName) ?? { info, count: 0 };
    entry.count++;
    counts.set(info.languageName, entry);
  }
  let best: { info: LanguageExtensionInfo; count: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.info;
}
