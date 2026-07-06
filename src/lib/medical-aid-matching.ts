export type MedicalAidSchemeLike = {
  id: string;
  company_id: string | null;
  name: string;
  normalized_name?: string | null;
};

export type MedicalAidOptionLike = {
  id: string;
  scheme_id: string;
  option_name: string;
  quality_score: number;
  category: string;
  medical_aid_schemes: MedicalAidSchemeLike | MedicalAidSchemeLike[] | null;
};

export type MedicalAidMatch<TOption extends MedicalAidOptionLike> = {
  option: TOption;
  scheme: MedicalAidSchemeLike;
  confidence: "exact" | "alias" | "embedded_scheme" | "option_contains" | "token_overlap";
  confidenceScore: number;
  reason: string;
};

export type MedicalAidScoringIndex<TOption extends MedicalAidOptionLike> = {
  option: TOption;
  scheme: MedicalAidSchemeLike;
  scope: string;
  schemeKeys: Set<string>;
  optionKey: string;
  optionTokens: Set<string>;
  combinedTokens: Set<string>;
};

const schemeAliasGroups = [
  ["1 life direct", "1life direct", "1 life", "1life"],
  ["aeci", "aeci medical aid society", "aeci medical aid"],
  ["anglo", "anglo medical scheme"],
  ["bankmed", "bankmed medical scheme"],
  ["bestmed", "bestmed medical scheme"],
  ["bmw", "bemas", "bmw employees medical aid society", "bmw medical aid"],
  ["bonitas", "bonitas medical fund", "bonitas denis", "bonitas disc", "bonitas icon", "bonitas medical scheme"],
  ["camaf", "chartered accountants sa medical aid fund", "chartered accountants sa medical aid fund camaf", "chartered accountants medical aid fund", "chartered accountants (sa) medical aid fund"],
  ["discovery", "discovery health", "discovery health medical scheme"],
  ["fedhealth", "fedhealth medical scheme"],
  ["gems", "government employees medical scheme", "government employees medical scheme gems", "government employees gems"],
  ["genesis", "genesis medical scheme"],
  ["glencore", "glencore medical scheme", "glencore medical"],
  ["keyhealth", "keyhealth medical scheme"],
  ["la health", "la-health medical scheme", "la health medical scheme"],
  ["makoti", "makoti medical scheme", "makoti denis"],
  ["medihelp", "medihelp medical scheme"],
  ["medipos", "medipos medical scheme"],
  ["medshield", "medshield medical scheme"],
  ["momentum", "momentum medical scheme", "momentum medical sch"],
  ["netcare", "netcare medical scheme", "netcare medical sch"],
  ["opmed", "opmed medical scheme"],
  ["pick n pay", "pick n pay medical scheme", "pick n pay"],
  ["platinum health", "platinum health medical scheme"],
  ["polmed", "south african police service medical scheme", "south african police service medical scheme polmed", "polmed denis", "polmed ppn"],
  ["profmed", "profmed medical scheme"],
  ["remedi", "remedi medical aid scheme", "remedi medical scheme", "remedi ppn"],
  ["sabmas", "sa breweries medical aid society", "sa breweries medical aid society sabmas", "sab medical scheme", "sabmas"],
  ["sabc", "sabc medical scheme"],
  ["sizwe hosmed", "sizwe hosmed medical fund", "sizwe hosmed medical scheme", "sizwe hosmed drc", "sizwe", "hosmed"],
  ["thebemed", "thebemed medical scheme"],
  ["umvuzo", "umvuzo health", "umvuzo medical scheme"],
];

const aliasLookup = new Map<string, string>();
for (const group of schemeAliasGroups) {
  const canonical = group[0];
  group.forEach((alias) => aliasLookup.set(cleanText(alias), canonical));
}

const genericSchemeWords = new Set([
  "medical",
  "aid",
  "scheme",
  "fund",
  "health",
  "denis",
  "disc",
  "drc",
  "icon",
]);

const genericOptionWords = new Set([
  "acute",
  "benefit",
  "benefits",
  "dental",
  "dentistry",
  "medical",
  "aid",
  "scheme",
  "fund",
  "health",
  "option",
  "plan",
  "network",
  "acute",
  "acu",
  "chr",
  "denis",
  "dentist",
  "disc",
  "drc",
  "elect",
  "icon",
  "oncology",
  "pha",
  "prim",
  "sec",
  "specialia",
  "specialist",
]);

const numberWords: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const optionPhraseReplacements: Array<[RegExp, string]> = [
  [/\bpace\s+one\b/g, "pace1"],
  [/\bpace\s+two\b/g, "pace2"],
  [/\bpace\s+three\b/g, "pace3"],
  [/\bpace\s+four\b/g, "pace4"],
  [/\bbeat\s+one\b/g, "beat1"],
  [/\bbeat\s+two\b/g, "beat2"],
  [/\bbeat\s+three\b/g, "beat3"],
  [/\bbeat\s+four\b/g, "beat4"],
  [/\btanzanite\s+one\b/g, "tanzanite1"],
  [/\btanzanite\s+1\b/g, "tanzanite1"],
  [/\bplatcomp\s+in\s+area\b/g, "comprehensive"],
  [/\bplatcomprehensive\b/g, "comprehensive"],
  [/\bplatcomp\s+out\s+area\b/g, "standard"],
  [/\bpaltcomp\s+out\s+area\b/g, "standard"],
  [/\bnetcare\s+savings\b/g, "core"],
  [/\bnetcare\b/g, "plus"],
  [/\bbasic\s+primary\b/g, "basic"],
  [/\bcomp\b/g, "comprehensive"],
  [/\bcomprehensive\s+option\b/g, "comprehensive"],
  [/\bcomprehensive\s+plan\b/g, "comprehensive"],
  [/\bstandard\s+option\b/g, "standard"],
  [/\bnetwork\s+option\b/g, "network"],
  [/\btraditional\s+plan\b/g, "traditional"],
  [/\bsavings\s+plan\b/g, "savings"],
  [/\bbasic\s+plan\b/g, "basic"],
  [/\bvalue\s+platinum\s+core\b/g, "value platinum"],
];

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: unknown) {
  return cleanText(value).split(" ").filter(Boolean);
}

function acronymKeys(value: unknown) {
  const raw = String(value ?? "");
  return Array.from(raw.matchAll(/\(([A-Z0-9]{2,})\)/g)).map((match) => cleanText(match[1])).filter(Boolean);
}

function stripGenericWords(value: unknown, genericWords: Set<string>) {
  return tokens(value).filter((token) => !genericWords.has(token)).join(" ");
}

function canonicalScheme(value: unknown) {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  if (aliasLookup.has(cleaned)) return aliasLookup.get(cleaned) ?? cleaned;
  for (const acronym of acronymKeys(value)) {
    if (aliasLookup.has(acronym)) return aliasLookup.get(acronym) ?? acronym;
  }
  const aliasCandidates = Array.from(aliasLookup.keys()).sort((a, b) => b.length - a.length);
  for (const alias of aliasCandidates) {
    if (alias && containsWholeTokenPhrase(cleaned, alias)) return aliasLookup.get(alias) ?? alias;
  }
  const stripped = stripGenericWords(cleaned, genericSchemeWords);
  if (aliasLookup.has(stripped)) return aliasLookup.get(stripped) ?? stripped;
  for (const alias of aliasCandidates) {
    if (alias && containsWholeTokenPhrase(stripped, alias)) return aliasLookup.get(alias) ?? alias;
  }
  return stripped;
}

function optionKey(value: unknown) {
  let cleaned = cleanText(value);
  for (const [pattern, replacement] of optionPhraseReplacements) cleaned = cleaned.replace(pattern, replacement);
  cleaned = cleaned.split(" ").map((token) => numberWords[token] ?? token).join(" ");
  return stripGenericWords(cleaned, genericOptionWords);
}

function tokenSet(value: unknown, genericWords = genericOptionWords) {
  return new Set(tokens(value).filter((token) => !genericWords.has(token)));
}

function withoutSchemeWords(value: unknown, schemeKeys: Set<string>) {
  const schemeTokens = new Set(Array.from(schemeKeys).flatMap((key) => tokens(key)));
  return tokens(value).filter((token) => !schemeTokens.has(token)).join(" ");
}

function containsWholeTokenPhrase(haystack: string, needle: string) {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  const overlap = Array.from(a).filter((token) => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}

export function buildMedicalAidScoringIndex<TOption extends MedicalAidOptionLike>(options: TOption[]) {
  const indexed: MedicalAidScoringIndex<TOption>[] = [];
  for (const option of options) {
    const scheme = firstRow(option.medical_aid_schemes);
    if (!scheme) continue;
    const schemeKeys = new Set<string>();
    [scheme.name, scheme.normalized_name].forEach((value) => {
      const canonical = canonicalScheme(value);
      if (canonical) schemeKeys.add(canonical);
      acronymKeys(value).forEach((key) => schemeKeys.add(key));
      const cleaned = cleanText(value);
      if (cleaned) schemeKeys.add(cleaned);
      const stripped = stripGenericWords(value, genericSchemeWords);
      if (stripped) schemeKeys.add(stripped);
    });

    const normalizedOption = optionKey(option.option_name);
    const optionTokens = tokenSet(normalizedOption);
    indexed.push({
      option,
      scheme,
      scope: scheme.company_id ?? "global",
      schemeKeys,
      optionKey: normalizedOption,
      optionTokens,
      combinedTokens: new Set([...schemeKeys].flatMap((key) => tokens(key)).concat(Array.from(optionTokens))),
    });
  }
  return indexed;
}

export function matchMedicalAidOption<TOption extends MedicalAidOptionLike>(
  index: MedicalAidScoringIndex<TOption>[],
  input: { companyId: string; schemeName?: string | null; optionName?: string | null },
): MedicalAidMatch<TOption> | null {
  const rawScheme = cleanText(input.schemeName);
  const rawOption = cleanText(input.optionName);
  if (!rawScheme && !rawOption) return null;

  const canonicalInputScheme = canonicalScheme(rawScheme);
  const inputSchemeKeys = new Set([canonicalInputScheme, rawScheme, stripGenericWords(rawScheme, genericSchemeWords)].filter(Boolean));
  const optionWithoutScheme = withoutSchemeWords(rawOption, inputSchemeKeys);
  const inputOptionKey = optionKey(optionWithoutScheme || rawOption);
  const inputOptionTokens = tokenSet(inputOptionKey);
  const combinedInputTokens = new Set([...tokens(rawScheme), ...Array.from(inputOptionTokens)]);

  let best: MedicalAidMatch<TOption> | null = null;

  for (const candidate of index) {
    if (candidate.scope !== "global" && candidate.scope !== input.companyId) continue;

    const schemeExact = Array.from(inputSchemeKeys).some((key) => candidate.schemeKeys.has(key));
    const schemeEmbedded = !schemeExact && Array.from(candidate.schemeKeys).some((key) => containsWholeTokenPhrase(rawOption, key));
    if (!schemeExact && !schemeEmbedded) continue;

    const optionExact = inputOptionKey && inputOptionKey === candidate.optionKey;
    const optionContains = inputOptionKey && (
      containsWholeTokenPhrase(inputOptionKey, candidate.optionKey)
      || containsWholeTokenPhrase(candidate.optionKey, inputOptionKey)
    );
    const overlap = overlapRatio(inputOptionTokens, candidate.optionTokens);
    const combinedOverlap = overlapRatio(combinedInputTokens, candidate.combinedTokens);

    let score = 0;
    let confidence: MedicalAidMatch<TOption>["confidence"] | null = null;
    let reason = "";

    if (schemeExact && optionExact) {
      score = 100;
      confidence = "exact";
      reason = "Exact scheme and option match after normalisation.";
    } else if (schemeExact && optionContains) {
      score = 92;
      confidence = "option_contains";
      reason = "Scheme matched and option text contains the configured option.";
    } else if (schemeEmbedded && optionExact) {
      score = 88;
      confidence = "embedded_scheme";
      reason = "Scheme was detected inside the uploaded option field.";
    } else if (schemeEmbedded && optionContains) {
      score = 84;
      confidence = "embedded_scheme";
      reason = "Scheme was detected inside the option field and option text overlaps strongly.";
    } else if (schemeExact && overlap >= 0.5 && inputOptionTokens.size > 0 && candidate.optionTokens.size > 0) {
      score = 72 + Math.round(overlap * 10);
      confidence = "token_overlap";
      reason = "Scheme matched and option tokens overlap.";
    } else if (schemeEmbedded && combinedOverlap >= 0.6) {
      score = 70 + Math.round(combinedOverlap * 10);
      confidence = "token_overlap";
      reason = "Uploaded scheme/option tokens overlap with the scoring row.";
    }

    if (!confidence || score < 70) continue;
    if (candidate.scope === input.companyId) score += 2;
    score = Math.min(score, 100);
    if (!best || score > best.confidenceScore || (score === best.confidenceScore && candidate.option.quality_score > best.option.quality_score)) {
      best = { option: candidate.option, scheme: candidate.scheme, confidence, confidenceScore: score, reason };
    }
  }

  return best;
}
