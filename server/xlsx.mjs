import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false });
const list = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const nodeText = (value) => String(value && typeof value === 'object' ? value['#text'] || '' : value || '');
const columnNumber = (reference) => reference.match(/[A-Z]+/)[0].split('').reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
const indexedColors = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
  '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
  '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
  '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99',
  '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696',
  '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333',
];

function hexColor(value) {
  const text = String(value || '').toUpperCase();
  const hex = text.length === 8 ? text.slice(2) : text;
  return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : '';
}

function applyTint(color, value) {
  const tint = Number(value);
  if (!Number.isFinite(tint) || !tint) return color;
  return `#${color.slice(1).match(/.{2}/g).map((part) => {
    const channel = Number.parseInt(part, 16);
    const adjusted = tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint;
    return Math.max(0, Math.min(255, Math.round(adjusted))).toString(16).padStart(2, '0');
  }).join('')}`.toUpperCase();
}

function spreadsheetColor(color, theme) {
  if (!color) return '';
  const base = hexColor(color.rgb)
    || (color.indexed !== undefined ? indexedColors[Number(color.indexed)] || '' : '')
    || (color.theme !== undefined ? theme[Number(color.theme)] || '' : '');
  return base ? applyTint(base, color.tint) : '';
}

function workbookTheme(document) {
  const root = document?.['a:theme'] || document?.theme;
  const scheme = root?.['a:themeElements']?.['a:clrScheme'] || root?.themeElements?.clrScheme;
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((name) => {
    const entry = scheme?.[`a:${name}`] || scheme?.[name];
    return hexColor(entry?.['a:srgbClr']?.val || entry?.srgbClr?.val || entry?.['a:sysClr']?.lastClr || entry?.sysClr?.lastClr);
  });
}

class SheetRow {
  constructor(cells, columns, colors = new Map()) {
    this.cells = cells;
    this.columns = columns;
    this.colors = colors;
  }

  getCell(column) {
    return { value: this.cells.get(column) ?? null, color: this.colors.get(column) || '' };
  }

  get values() {
    return Array.from({ length: this.columns + 1 }, (_, column) => column === 0 ? undefined : this.cells.get(column));
  }
}

class Sheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows;
    this.rowCount = rows.size ? Math.max(...rows.keys()) : 0;
    this.columnCount = rows.size ? Math.max(...[...rows.values()].map((row) => row.columns)) : 0;
  }

  getRow(rowNumber) {
    return this.rows.get(rowNumber) || new SheetRow(new Map(), this.columnCount);
  }
}

export function parseWorkbook(buffer) {
  const archive = unzipSync(buffer);
  const xml = (name) => {
    if (!archive[name]) throw new Error(`Excel 文件缺少 ${name}`);
    return parser.parse(strFromU8(archive[name]));
  };
  const sharedStrings = archive['xl/sharedStrings.xml'] ? list(xml('xl/sharedStrings.xml').sst?.si).map((item) => {
    if (typeof item === 'string') return item;
    if (item.t !== undefined) return nodeText(item.t);
    return list(item.r).map((part) => nodeText(part.t)).join('');
  }) : [];
  const styles = archive['xl/styles.xml'] ? xml('xl/styles.xml').styleSheet : undefined;
  const theme = archive['xl/theme/theme1.xml'] ? workbookTheme(xml('xl/theme/theme1.xml')) : [];
  const fills = list(styles?.fills?.fill).map((fill) => {
    const pattern = fill.patternFill;
    return pattern && (!pattern.patternType || pattern.patternType === 'solid') ? spreadsheetColor(pattern.fgColor, theme) : '';
  });
  const cellFormats = list(styles?.cellXfs?.xf);
  const workbook = xml('xl/workbook.xml').workbook;
  const relationships = xml('xl/_rels/workbook.xml.rels').Relationships;
  const targets = new Map(list(relationships.Relationship).map((item) => [item.Id, item.Target]));
  const worksheets = list(workbook.sheets.sheet).map((sheet) => {
    const target = targets.get(sheet['r:id']);
    if (!target) throw new Error(`无法读取工作表 ${sheet.name}`);
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const sheetXml = xml(sheetPath).worksheet;
    const rows = new Map();
    for (const row of list(sheetXml.sheetData?.row)) {
      const cells = new Map();
      const colors = new Map();
      for (const cell of list(row.c)) {
        const column = columnNumber(cell.r);
        let value = cell.v ?? null;
        if (cell.t === 's' && value !== null) value = sharedStrings[Number(value)];
        if (cell.t === 'inlineStr') value = cell.is?.t !== undefined ? nodeText(cell.is.t) : list(cell.is?.r).map((part) => nodeText(part.t)).join('');
        cells.set(column, value);
        const format = cellFormats[Number(cell.s || 0)];
        const color = fills[Number(format?.fillId || 0)] || '';
        if (color) colors.set(column, color);
      }
      const rowNumber = Number(row.r);
      rows.set(rowNumber, new SheetRow(cells, Math.max(0, ...cells.keys()), colors));
    }
    for (const merged of list(sheetXml.mergeCells?.mergeCell)) {
      const [start, end] = merged.ref.split(':');
      const firstColumn = columnNumber(start);
      const lastColumn = columnNumber(end);
      const firstRow = Number(start.match(/\d+/)[0]);
      const lastRow = Number(end.match(/\d+/)[0]);
      const source = rows.get(firstRow)?.getCell(firstColumn);
      for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
        const row = rows.get(rowNumber) || new SheetRow(new Map(), lastColumn);
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          row.cells.set(column, source?.value ?? null);
          if (source?.color) row.colors.set(column, source.color);
        }
        rows.set(rowNumber, row);
      }
    }
    return new Sheet(sheet.name, rows);
  });
  return { worksheets, getWorksheet: (name) => worksheets.find((sheet) => sheet.name === name) };
}
