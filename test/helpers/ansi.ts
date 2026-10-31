// Test-only ANSI inspection. It follows the SGR foreground state so tests can assert which
// color a visible character is drawn in without depending on the exact reset sequences a
// pi-tui version emits.

// oxlint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface StyledGrapheme {
  text: string;
  fg: string | undefined;
}

export function styledGraphemes(line: string): StyledGrapheme[] {
  const graphemes: StyledGrapheme[] = [];
  let fg: string | undefined;
  let plain = "";

  const flush = () => {
    for (const { segment } of segmenter.segment(plain)) graphemes.push({ text: segment, fg });
    plain = "";
  };

  let index = 0;
  while (index < line.length) {
    ESCAPE_PATTERN.lastIndex = index;
    const match = ESCAPE_PATTERN.exec(line);
    if (match) {
      flush();
      if (match[2] === "m") fg = applySgr(fg, match[1] ?? "");
      index = ESCAPE_PATTERN.lastIndex;
      continue;
    }
    plain += line[index];
    index += 1;
  }
  flush();
  return graphemes;
}

// Foreground colors of the graphemes forming the first occurrence of `text` in the visible line.
export function foregroundsOf(line: string, text: string): Set<string | undefined> {
  const graphemes = styledGraphemes(line);
  const plain = graphemes.map((grapheme) => grapheme.text).join("");
  const start = plain.indexOf(text);
  if (start === -1) throw new Error(`"${text}" is not visible in the line`);

  const colors = new Set<string | undefined>();
  let offset = 0;
  for (const grapheme of graphemes) {
    const end = offset + grapheme.text.length;
    if (end > start && offset < start + text.length) colors.add(grapheme.fg);
    offset = end;
  }
  return colors;
}

// True when every escape sequence in the line is complete, so nothing was cut mid-sequence.
export function hasOnlyCompleteEscapes(line: string): boolean {
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "\x1b") {
      index += 1;
      continue;
    }
    ESCAPE_PATTERN.lastIndex = index;
    if (!ESCAPE_PATTERN.exec(line)) return false;
    index = ESCAPE_PATTERN.lastIndex;
  }
  return true;
}

function applySgr(current: string | undefined, params: string): string | undefined {
  const codes = params === "" ? [0] : params.split(";").map(Number);
  let fg = current;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === 0 || code === 39) {
      fg = undefined;
    } else if (code !== undefined && ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))) {
      fg = String(code);
    } else if (code === 38 && codes[index + 1] === 5) {
      fg = `38;5;${codes[index + 2]}`;
      index += 2;
    } else if (code === 38 && codes[index + 1] === 2) {
      fg = `38;2;${codes.slice(index + 2, index + 5).join(";")}`;
      index += 4;
    } else if (code === 48 && (codes[index + 1] === 5 || codes[index + 1] === 2)) {
      index += codes[index + 1] === 5 ? 2 : 4;
    }
  }
  return fg;
}
