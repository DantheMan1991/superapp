/**
 * CSV parsing for the preview.
 *
 * Hand-written rather than a dependency: the whole job is RFC 4180 quoting, it
 * is thirty lines, and it is pure so it can be tested exhaustively. A CSV
 * exported from Excel is the single most common "spreadsheet" a construction
 * business emails around, so it is worth getting the awkward cases right —
 * quoted commas, quoted newlines, and doubled quotes inside a quoted field.
 */

/**
 * Parse delimited text into a grid.
 *
 * Handles `\r\n` and `\n`, quoted fields containing the delimiter or a line
 * break, and `""` as an escaped quote. Never throws: malformed input degrades
 * to a best-effort grid, because a preview refusing to render is worse than a
 * preview with one odd row.
 */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  // A leading BOM survives every Excel CSV export and would otherwise become
  // part of the first header cell.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Swallow CRLF as one break; a lone CR is treated the same way.
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // A trailing newline should not produce a phantom final row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Guess the delimiter from the first line.
 *
 * European exports use `;` and some tools emit tab-separated data with a .csv
 * extension. Counting on the first line is crude but beats always assuming a
 * comma and rendering the whole file as one column.
 */
export function sniffDelimiter(text: string): string {
  const line = text.slice(0, 4000).split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    // Count only OUTSIDE quotes, or a quoted address like "Smith, John" wins
    // the vote for comma in a semicolon file.
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}
