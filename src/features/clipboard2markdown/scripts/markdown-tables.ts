/**
 * markdown-tables.ts — GFM table normalization helpers.
 *
 * Prettier's markdown formatter aligns a table to its WIDEST row but only
 * re-pads the delimiter and body rows — it leaves the header row untouched.
 * So when a pasted table has body rows with MORE cells than the header (very
 * common with spreadsheet exports that use merged/two-level header cells),
 * Prettier emits a table whose header has fewer cells than its delimiter:
 *
 *     | A | B |            ← header, 2 cells
 *     | - | - | - |        ← delimiter, 3 cells   ← mismatch!
 *     | 1 | 2 | 3 |        ← body, 3 cells
 *
 * Per the GFM spec the header row must match the delimiter row in cell count,
 * otherwise the block is not recognized as a table — so the "pretty" output
 * renders as broken text or with phantom columns, even though the source
 * rendered fine (GFM silently ignores the excess body cells).
 *
 * This module pre-trims every table to the column count defined by its header
 * row. Because GFM already drops the excess body cells when rendering, the
 * normalized markdown renders identically to the source while giving Prettier a
 * consistent table to format.
 */

// A delimiter cell is only hyphens with an optional leading/trailing colon.
const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

/**
 * Split a table row into its inner cells, dropping the optional leading and
 * trailing pipes. A negative lookbehind keeps escaped pipes (`\|`) inside a
 * cell. `"| a | b |"` → `[" a ", " b "]`.
 */
function splitCells(line: string): string[] {
  const parts = line.trim().split(/(?<!\\)\|/);
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts;
}

/** A row whose every cell is a delimiter cell (`---`, `:--`, `--:`, `:-:`). */
function isDelimiterRow(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

/** Re-join cells into a pipe-delimited row. Empty cells become blank columns. */
function buildRow(cells: string[], indent: string): string {
  return `${indent}| ${cells.map((c) => c.trim()).join(' | ')} |`;
}

/**
 * Normalize each GFM table so its body rows have exactly as many cells as the
 * header row — truncating excess cells and padding short rows. Tables inside
 * fenced code blocks are left untouched.
 */
export function normalizeTableColumns(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  let fenceChar = '';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Track fenced code blocks so table-like content inside them is preserved.
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    // A table is a header line immediately followed by a delimiter line whose
    // cell count matches — the same condition GFM uses to recognize a table.
    const next = lines[i + 1];
    if (next === undefined || !trimmed.includes('|') || !isDelimiterRow(next)) {
      continue;
    }
    const colCount = splitCells(lines[i]).length;
    if (colCount !== splitCells(next).length) continue;

    // Normalize every body row to the header's column count until the table
    // ends (blank line or a line without a pipe).
    let j = i + 2;
    for (; j < lines.length; j++) {
      const bodyTrimmed = lines[j].trim();
      if (bodyTrimmed === '' || !bodyTrimmed.includes('|')) break;
      const indent = lines[j].match(/^\s*/)?.[0] ?? '';
      const cells = splitCells(lines[j]);
      const fixed = Array.from({ length: colCount }, (_, c) => cells[c] ?? '');
      lines[j] = buildRow(fixed, indent);
    }
    i = j - 1; // Skip the rows already processed.
  }

  return lines.join('\n');
}
