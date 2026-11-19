export const isTablePath = (path: string) => /\.(csv|tsv)$/i.test(path);

// The delimiter that splits the first line into the most fields, outside quotes.
export function sniffDelimiter(text: string, path = '') {
  if (/\.tsv$/i.test(path)) return '\t';
  const line = text.slice(0, text.indexOf('\n') + 1 || undefined);
  const count = (d: string) => line.replace(/"[^"]*"/g, '').split(d).length;
  return [',', ';', '\t', '|'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
}

// RFC 4180: quoted fields may hold the delimiter, newlines and "" for a quote.
export function parseCsv(text: string, delim = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field !== '' || row.length) row.push(field), rows.push(row);
  return rows;
}

const num = (s: string) => (s.trim() !== '' && !isNaN(Number(s)) ? Number(s) : null);

// Numbers sort as numbers and come before text; empty cells go last.
export function sortRows(rows: string[][], col: number, desc: boolean) {
  const cmp = (a: string, b: string) => {
    if (!a !== !b) return a ? -1 : 1;
    const x = num(a);
    const y = num(b);
    if (x !== null && y !== null) return desc ? y - x : x - y;
    if ((x === null) !== (y === null)) return x !== null ? -1 : 1;
    const r = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return desc ? -r : r;
  };
  return [...rows].sort((a, b) => cmp(a[col] ?? '', b[col] ?? ''));
}

export const isNumericColumn = (rows: string[][], col: number) => {
  const vals = rows.slice(0, 200).map((r) => r[col] ?? '').filter((v) => v.trim() !== '');
  return vals.length > 0 && vals.every((v) => num(v) !== null);
};
