'use strict';

// ════════════════════════════════════════════════════════════════════════════
//  Pure-JS XLSX Generator — minimal, valid, no external deps
// ════════════════════════════════════════════════════════════════════════════

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Binary helpers ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const toBytes = s => enc.encode(s);

function u16(n) {
  return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF]);
}
function u32(n) {
  n = n >>> 0;
  return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]);
}
function cat(...parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ── ZIP (STORED — no compression) ─────────────────────────────────────────────
function buildZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = toBytes(name);
    const crc     = crc32(data);
    const size    = data.length;

    // Local file header (30 bytes fixed + filename + data)
    const lfhFixed = cat(
      new Uint8Array([0x50,0x4B,0x03,0x04]),
      u16(20), u16(0), u16(0),
      u16(0),  u16(0),
      u32(crc), u32(size), u32(size),
      u16(nameBuf.length), u16(0)
    );
    const localEntry = cat(lfhFixed, nameBuf, data);
    locals.push(localEntry);

    // Central directory entry
    const cdEntry = cat(
      new Uint8Array([0x50,0x4B,0x01,0x02]),
      u16(20), u16(20),
      u16(0), u16(0), u16(0),
      u16(0),
      u32(crc), u32(size), u32(size),
      u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0),
      u32(offset),
      nameBuf
    );
    central.push(cdEntry);

    offset += localEntry.length;
  }

  const cdBuf = cat(...central);
  const eocd  = cat(
    new Uint8Array([0x50,0x4B,0x05,0x06]),
    u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(cdBuf.length), u32(offset),
    u16(0)
  );

  return cat(...locals, cdBuf, eocd);
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Column address ─────────────────────────────────────────────────────────────
function colName(idx) {  // 0-based → "A", "B", ..., "AA", etc.
  let name = '';
  let n = idx + 1;
  while (n > 0) {
    n--;
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26);
  }
  return name;
}
function cellAddr(col, row) { return colName(col) + row; }

// ── Shared Strings ────────────────────────────────────────────────────────────
function buildSST(strings) {
  const items = strings.map(s =>
    `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`;
}

// ── Styles ────────────────────────────────────────────────────────────────────
// xf index 0 = default, 1 = header (bold white on dark blue),
//           2 = integer, 3 = decimal
function buildStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
`<numFmts count="2">` +
  `<numFmt numFmtId="164" formatCode="#,##0"/>` +
  `<numFmt numFmtId="165" formatCode="#,##0.00"/>` +
`</numFmts>` +
`<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/><color rgb="FF000000"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>` +
`</fonts>` +
`<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>` +
`</fills>` +
`<borders count="1">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
`</borders>` +
`<cellStyleXfs count="1">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>` +
`</cellStyleXfs>` +
`<cellXfs count="4">` +
  `<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0"   fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="left" vertical="center"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
`</cellXfs>` +
`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
`</styleSheet>`;
}

// ── Worksheet ─────────────────────────────────────────────────────────────────
function buildWorksheet(headers, rowData, sstMap, tableRef) {
  const rowXmls = [];

  // Row 1: headers (xf=1: bold white on blue)
  const hdrCells = headers.map((h, ci) => {
    const si = sstMap.get(h);
    return `<c r="${cellAddr(ci,1)}" t="s" s="1"><v>${si}</v></c>`;
  }).join('');
  rowXmls.push(`<row r="1" customHeight="1" ht="18">${hdrCells}</row>`);

  // Data rows
  rowData.forEach((row, ri) => {
    const rowNum = ri + 2;
    const cells = row.map((val, ci) => {
      // Empty cell — self-closing, no <v> element
      if (val === null || val === undefined || val === '') {
        return `<c r="${cellAddr(ci, rowNum)}"/>`;
      }
      // Number
      if (typeof val === 'number') {
        const s = Number.isInteger(val) ? 2 : 3;
        return `<c r="${cellAddr(ci, rowNum)}" s="${s}"><v>${val}</v></c>`;
      }
      // String via shared strings
      const si = sstMap.get(String(val));
      if (si === undefined) {
        // Fallback: inline string (should not happen if SST is built correctly)
        return `<c r="${cellAddr(ci, rowNum)}" t="inlineStr"><is><t>${xmlEsc(val)}</t></is></c>`;
      }
      return `<c r="${cellAddr(ci, rowNum)}" t="s"><v>${si}</v></c>`;
    }).join('');
    rowXmls.push(`<row r="${rowNum}">${cells}</row>`);
  });

  // Column widths
  const colWidths = headers.map((h, i) => {
    const w = h.length > 25 ? 32 : h.length > 14 ? 22 : 15;
    return `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`;
  }).join('');

  // IMPORTANT: pane element must come BEFORE selection inside sheetView
  const sheetViews =
    `<sheetViews>` +
      `<sheetView tabSelected="1" workbookViewId="0">` +
        `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>` +
      `</sheetView>` +
    `</sheetViews>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet` +
    ` xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    sheetViews +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colWidths}</cols>` +
    `<sheetData>${rowXmls.join('')}</sheetData>` +
    `<autoFilter ref="${tableRef}"/>` +
    `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` +
    `</worksheet>`;
}

// ── Table ─────────────────────────────────────────────────────────────────────
function buildTable(headers, tableRef) {
  const cols = headers.map((h, i) =>
    `<tableColumn id="${i+1}" name="${xmlEsc(h)}"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` id="1" name="Produkty" displayName="Produkty" ref="${tableRef}" totalsRowShown="0">` +
    `<autoFilter ref="${tableRef}"/>` +
    `<tableColumns count="${headers.length}">${cols}</tableColumns>` +
    `<tableStyleInfo name="TableStyleMedium2"` +
    ` showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`;
}

// ── Fixed column definitions ──────────────────────────────────────────────────
const FIXED = [
  ['nazwa',             'Nazwa produktu'],
  ['link',              'Link do produktu'],
  ['id_oferty',         'ID oferty'],
  ['cena',              'Cena (PLN)'],
  ['ocena',             'Ocena produktu'],
  ['liczba_kupujacych', 'Liczba kupujących'],
  ['promowane',         'Promowane'],
  ['smart_monety',      'Smart monety'],
  ['smart',             'Smart'],
  ['raty',              'Raty'],
  ['darmowa_dostawa',   'Darmowa dostawa'],
  ['czas_dostawy',      'Czas dostawy (dni)'],
  ['gwarancja_ceny',    'Gwarancja najniższej ceny'],
  ['parametry_wpisane', 'Czy parametry są wpisane'],
];

// ── Main ──────────────────────────────────────────────────────────────────────
function generateXLSX(products, uniqueParams) {
  const sortedParams = uniqueParams.slice().sort();
  const headers = [
    ...FIXED.map(([, label]) => label),
    ...sortedParams,
  ];

  const numCols = headers.length;
  const numRows = products.length;
  const tableRef = `A1:${colName(numCols - 1)}${numRows + 1}`;

  // Build SST — collect every string that will appear in the sheet
  const sstStrings = [];
  const sstMap = new Map();

  function sst(s) {
    const key = String(s ?? '');
    if (!sstMap.has(key)) { sstMap.set(key, sstStrings.length); sstStrings.push(key); }
    return sstMap.get(key);
  }

  // Register all headers first
  headers.forEach(h => sst(h));

  // Build row data arrays and register all string values
  const rowData = products.map(p => {
    const row = new Array(numCols);
    // Fixed columns
    FIXED.forEach(([key], ci) => {
      const v = p[key];
      row[ci] = (v === undefined || v === null) ? null : v;
      if (row[ci] !== null && typeof row[ci] === 'string') sst(row[ci]);
    });
    // Dynamic param columns
    sortedParams.forEach((param, pi) => {
      const ci = FIXED.length + pi;
      const v = p[param];
      row[ci] = (v === undefined || v === null) ? null : v;
      if (row[ci] !== null && typeof row[ci] === 'string') sst(row[ci]);
    });
    return row;
  });

  // Build XML
  const sstXml    = buildSST(sstStrings);
  const stylesXml = buildStyles();
  const sheetXml  = buildWorksheet(headers, rowData, sstMap, tableRef);
  const tableXml  = buildTable(headers, tableRef);

  const sheetRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>` +
    `</Relationships>`;

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="10000"/></bookViews>` +
    `<sheets><sheet name="Produkty" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>` +
    `</Types>`;

  return buildZip([
    { name: '[Content_Types].xml',                data: toBytes(contentTypes) },
    { name: '_rels/.rels',                         data: toBytes(rootRels)     },
    { name: 'xl/workbook.xml',                     data: toBytes(workbook)     },
    { name: 'xl/_rels/workbook.xml.rels',          data: toBytes(wbRels)       },
    { name: 'xl/worksheets/sheet1.xml',            data: toBytes(sheetXml)     },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: toBytes(sheetRels)    },
    { name: 'xl/sharedStrings.xml',                data: toBytes(sstXml)       },
    { name: 'xl/styles.xml',                       data: toBytes(stylesXml)    },
    { name: 'xl/tables/table1.xml',                data: toBytes(tableXml)     },
  ]);
}

// ── Base64 without blowing the stack ─────────────────────────────────────────
function bufToBase64(buf) {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ═════════════════════════════════════════════════════════════════════════════
//  Service Worker message handler
// ═════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'exportXLSX') return;

  (async () => {
    try {
      const xlsxBuf = generateXLSX(msg.products || [], msg.uniqueParams || []);
      const dataUrl = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' +
                      bufToBase64(xlsxBuf);

      const now   = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}` +
                    `_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

      await chrome.downloads.download({
        url:      dataUrl,
        filename: `allegro_produkty_${stamp}.xlsx`,
        saveAs:   false,
      });

      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();

  return true;
});
