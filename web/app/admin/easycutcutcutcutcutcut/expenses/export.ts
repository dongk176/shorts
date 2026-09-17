export type ExportValue = string | number | Date | null;
export type ExportTable = { name: string; headers: string[]; rows: ExportValue[][]; currencyColumns?: number[] };

export function csvText(table: ExportTable): string {
  function field(value: ExportValue): string {
    let text = value instanceof Date ? value.toISOString().slice(0, 10) : value === null ? '' : String(value);
    // Text from forms must never become a spreadsheet formula. Numeric negatives remain numbers.
    if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
  return '\uFEFF' + [table.headers, ...table.rows].map(row => row.map(field).join(',')).join('\r\n') + '\r\n';
}

const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function columnName(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}
function worksheet(table: ExportTable): string {
  const rows = [table.headers, ...table.rows];
  const data = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ''}>${row.map((value, column) => {
    const reference = `${columnName(column)}${rowIndex + 1}`;
    if (value === null) return `<c r="${reference}"/>`;
    if (value instanceof Date) return `<c r="${reference}" s="3"><v>${value.getTime() / 86400000 + 25569}</v></c>`;
    if (typeof value === 'number') return `<c r="${reference}" s="${table.currencyColumns?.includes(column) ? 2 : 0}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
    return `<c r="${reference}" s="${rowIndex === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const columns = table.headers.map((header, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(42, Math.max(16, header.length * 2 + 4, ...table.rows.map(row => typeof row[index] === 'string' ? Math.min(String(row[index]).length * 1.6 + 2, 42) : 16)))}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${columnName(table.headers.length - 1)}${Math.max(1, rows.length)}"/></worksheet>`;
}

// A small dependency-free OOXML writer: uncompressed ZIP entries containing typed cells.
// This local preview exports static data only; no formulas, macros or external links are emitted.
function zip(files: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const checksumTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let result = index;
    for (let bit = 0; bit < 8; bit++) result = (result & 1) ? 0xedb88320 ^ (result >>> 1) : result >>> 1;
    return result >>> 0;
  });
  function crc32(bytes: Uint8Array) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = checksumTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  for (const [path, contents] of files) {
    const name = encoder.encode(path), data = encoder.encode(contents), crc = crc32(data);
    const local = new Uint8Array(30 + name.length); const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); local.set(name, 30);
    const directory = new Uint8Array(46 + name.length); const entry = new DataView(directory.buffer);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(14, 33, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true); directory.set(name, 46);
    parts.push(local, data); central.push(directory); offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.length); let position = 0;
  for (const part of [...parts, ...central, end]) { result.set(part, position); position += part.length; }
  return result;
}

export function xlsxBytes(tables: ExportTable[]): Uint8Array {
  const namespace = 'http://schemas.openxmlformats.org';
  const types = `<?xml version="1.0"?><Types xmlns="${namespace}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRelationships = `<?xml version="1.0"?><Relationships xmlns="${namespace}/package/2006/relationships"><Relationship Id="rId1" Type="${namespace}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${namespace}/spreadsheetml/2006/main" xmlns:r="${namespace}/officeDocument/2006/relationships"><sheets>${tables.map((table, index) => `<sheet name="${xml(table.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
  const relationships = `<?xml version="1.0"?><Relationships xmlns="${namespace}/package/2006/relationships">${tables.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${namespace}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${tables.length + 1}" Type="${namespace}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0"?><styleSheet xmlns="${namespace}/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;;-#,##0&quot;원&quot;"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6348CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([['[Content_Types].xml', types], ['_rels/.rels', rootRelationships], ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', relationships], ['xl/styles.xml', styles], ...tables.map((table, index): [string, string] => [`xl/worksheets/sheet${index + 1}.xml`, worksheet(table)])]);
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
