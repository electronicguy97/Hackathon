'use strict';

const { posix } = require('node:path');
const { crc32, inflateRawSync } = require('node:zlib');

const MAX_XML_BYTES = 12 * 1024 * 1024;
const DAYS = ['월', '화', '수', '목', '금'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WORK_TYPES = new Set(['회사', '재택', '출장', '외근', '휴가']);

function zipEntries(bytes) {
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65535);
  while (end >= earliest && (bytes.readUInt32LE(end) !== 0x06054b50 ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  if (end < earliest || end < 0) throw new Error('xlsx ZIP 디렉터리를 찾을 수 없습니다.');

  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (start + size > end || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== count || count === 0xffff) {
    throw new Error('지원하지 않는 xlsx ZIP 디렉터리입니다.');
  }
  const entries = new Map();
  let offset = start;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > start + size || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('xlsx ZIP 항목이 손상되었습니다.');
    }
    const nameEnd = offset + 46 + bytes.readUInt16LE(offset + 28);
    const next = nameEnd + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > start + size) throw new Error('xlsx ZIP 항목 길이가 올바르지 않습니다.');
    const name = bytes.toString('utf8', offset + 46, nameEnd);
    if (entries.has(name)) throw new Error('xlsx ZIP에 중복 항목이 있습니다.');
    entries.set(name, {
      flags: bytes.readUInt16LE(offset + 8),
      method: bytes.readUInt16LE(offset + 10),
      crc: bytes.readUInt32LE(offset + 16),
      compressed: bytes.readUInt32LE(offset + 20),
      uncompressed: bytes.readUInt32LE(offset + 24),
      local: bytes.readUInt32LE(offset + 42)
    });
    offset = next;
  }
  return {
    has: (name) => entries.has(name),
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`${name} 항목이 없습니다.`);
      const { flags, method, crc, compressed, uncompressed, local } = entry;
      if (flags & 1 || ![0, 8].includes(method) || local + 30 > start ||
          bytes.readUInt32LE(local) !== 0x04034b50 || uncompressed > MAX_XML_BYTES) {
        throw new Error(`${name} 압축 형식 또는 크기가 올바르지 않습니다.`);
      }
      const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (dataStart + compressed > start) throw new Error(`${name} 압축 데이터가 손상되었습니다.`);
      const source = bytes.subarray(dataStart, dataStart + compressed);
      const data = method === 0 ? source : inflateRawSync(source, { maxOutputLength: Math.max(1, uncompressed) });
      if (data.length !== uncompressed || crc32(data) !== crc) {
        throw new Error(`${name} 압축 데이터가 손상되었습니다.`);
      }
      return data.toString('utf8');
    }
  };
}

const XML_ESCAPES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#x[\da-fA-F]+|#\d+);/g, (_, entity) => {
    if (!entity.startsWith('#')) return XML_ESCAPES[entity];
    const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return String.fromCodePoint(code);
  });
}

function parseXml(xml) {
  const root = { children: [], text: '' };
  const stack = [root];
  const tokens = /<!--[^]*?-->|<\?[^]*?\?>|<!\[CDATA\[([^]*?)\]\]>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gy;
  while (tokens.lastIndex < xml.length) {
    const token = tokens.exec(xml);
    if (!token) throw new Error('xlsx XML 형식이 올바르지 않습니다.');
    const [part, cdata] = token;
    const parent = stack.at(-1);
    if (part.startsWith('<!--') || part.startsWith('<?')) continue;
    if (cdata !== undefined || !part.startsWith('<')) {
      parent.text += cdata ?? decodeXml(part);
      continue;
    }
    if (part.startsWith('</')) {
      const name = part.slice(2, -1).trim();
      if (parent.fullName !== name) throw new Error('xlsx XML 태그가 올바르지 않습니다.');
      stack.pop();
      continue;
    }
    const fullName = /^<([\w:.-]+)/.exec(part)[1];
    const attrs = Object.create(null);
    for (const match of part.slice(fullName.length + 1).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[match[1]] = decodeXml(match[2] ?? match[3]);
    }
    const node = { fullName, name: fullName.split(':').at(-1), attrs, children: [], text: '' };
    parent.children.push(node);
    if (!part.endsWith('/>')) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error('xlsx XML 문서가 완전하지 않습니다.');
  return root.children[0];
}

const child = (node, name) => node?.children.find((element) => element.name === name);
const children = (node, name) => node?.children.filter((element) => element.name === name) ?? [];

function excelText(node) {
  return (node?.children ?? []).map((part) => {
    if (part.name === 't') return part.text;
    if (part.name === 'r') return child(part, 't')?.text ?? '';
    return '';
  }).join('');
}

function targetPath(relation) {
  if (!relation?.attrs.Target || relation.attrs.TargetMode === 'External') {
    throw new Error('첫 시트의 패키지 경로를 찾을 수 없습니다.');
  }
  const target = decodeURIComponent(relation.attrs.Target);
  const name = target.startsWith('/') ? posix.normalize(target.slice(1)) : posix.join('xl', target);
  if (name.startsWith('../') || name.includes('\\') || name.includes(':')) {
    throw new Error('xlsx 패키지 경로가 올바르지 않습니다.');
  }
  return name;
}

function workbookSheet(bytes) {
  const zip = zipEntries(bytes);
  const workbook = parseXml(zip.read('xl/workbook.xml'));
  const relationships = children(parseXml(zip.read('xl/_rels/workbook.xml.rels')), 'Relationship');
  const first = child(child(workbook, 'sheets'), 'sheet');
  if (!first) throw new Error('첫 번째 시트가 없습니다.');
  const relationId = Object.entries(first.attrs).find(([key]) => key.endsWith(':id'))?.[1] ?? first.attrs.id;
  const relation = relationships.find((entry) =>
    entry.attrs.Id === relationId && entry.attrs.Type?.endsWith('/worksheet'));
  const sharedRelation = relationships.find((entry) => entry.attrs.Type?.endsWith('/sharedStrings'));
  const sharedPath = sharedRelation ? targetPath(sharedRelation) : 'xl/sharedStrings.xml';
  const shared = zip.has(sharedPath) ? children(parseXml(zip.read(sharedPath)), 'si').map(excelText) : [];
  return { sheet: parseXml(zip.read(targetPath(relation))), shared };
}

function cellAddress(reference) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference ?? '');
  if (!match) throw new Error('셀 주소가 올바르지 않습니다.');
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (row > 1048576 || column > 16384) throw new Error('셀 주소가 올바르지 않습니다.');
  return { row, column: column - 1 };
}

function sheetCells(sheet, shared) {
  const rows = new Map();
  const data = child(sheet, 'sheetData');
  if (!data) throw new Error('첫 시트에 셀 데이터가 없습니다.');
  for (const rowNode of children(data, 'row')) {
    for (const cell of children(rowNode, 'c')) {
      const { row, column } = cellAddress(cell.attrs.r);
      if (column > 8) continue;
      if (!rows.has(row)) rows.set(row, []);
      const value = child(cell, 'v')?.text.trim() ?? '';
      let text = value;
      if (cell.attrs.t === 's') {
        if (!/^\d+$/.test(value) || shared[Number(value)] === undefined) {
          throw new Error('공유 문자열을 찾을 수 없습니다.');
        }
        text = shared[Number(value)];
      } else if (cell.attrs.t === 'inlineStr') {
        text = excelText(child(cell, 'is'));
      } else if (cell.attrs.t === 'e') {
        text = '';
      }
      rows.get(row)[column] = text.trim();
    }
  }

  const merges = Array.from({ length: 9 }, () => []);
  for (const merge of children(child(sheet, 'mergeCells'), 'mergeCell')) {
    const [left, right] = (merge.attrs.ref ?? '').split(':');
    const first = cellAddress(left);
    const last = cellAddress(right);
    if (first.row > last.row || first.column > last.column) throw new Error('병합 셀 범위가 올바르지 않습니다.');
    for (let column = first.column; column <= Math.min(last.column, 8); column++) {
      merges[column].push({ first, last });
    }
  }
  for (const ranges of merges) ranges.sort((a, b) => a.first.row - b.first.row);

  function mergeAt(row, column) {
    const ranges = merges[column];
    let left = 0;
    let right = ranges.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (ranges[middle].first.row <= row) left = middle + 1;
      else right = middle;
    }
    const match = ranges[left - 1];
    return match && row <= match.last.row ? match : null;
  }

  return {
    rows: [...rows.keys()].sort((a, b) => a - b),
    endingRow: (row) => mergeAt(row, 0)?.last.row ?? Infinity,
    get(row, column) {
      const value = rows.get(row)?.[column];
      if (value) return value;
      const range = mergeAt(row, column);
      return (range ? rows.get(range.first.row)?.[range.first.column] : value) ?? '';
    }
  };
}

function labelDate(label, today, address) {
  const match = /\(\s*(\d{1,2})\/(\d{1,2})(?!\d)/.exec(label);
  if (!match) throw new Error(`${address} 주차 라벨의 시작 날짜가 없습니다.`);
  const reference = new Date(`${today}T00:00:00Z`);
  const year = reference.getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((y) =>
    new Date(Date.UTC(y, Number(match[1]) - 1, Number(match[2]))))
    .filter((date) => date.getUTCMonth() + 1 === Number(match[1]) && date.getUTCDate() === Number(match[2]));
  candidates.sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference));
  const closest = candidates[0];
  if (!closest || closest.getUTCDay() !== 1) throw new Error(`${address} 주차 라벨에 월요일 날짜가 필요합니다.`);
  return closest.toISOString().slice(0, 10);
}

function weekPart() {
  return { personalSchedule: '', issues: '', requests: '', entries: [] };
}

function readWeeklyWorkbook(bytes, today) {
  const { sheet, shared } = workbookSheet(bytes);
  const cells = sheetCells(sheet, shared);
  const weekStart = labelDate(cells.get(1, 1), today, 'B1');
  labelDate(cells.get(1, 5), today, 'F1');
  const header = cells.rows.find((row) => cells.get(row, 0) === '요일');
  if (!header) throw new Error('요일 머리글을 찾을 수 없습니다.');
  const current = weekPart();
  const next = weekPart();
  const warnings = [];
  const parts = [[current, 1, '금주'], [next, 5, '차주']];
  const fields = [['개인일정', 'personalSchedule'], ['이슈', 'issues'], ['요청', 'requests']];
  for (const row of cells.rows) {
    if (row >= header) break;
    const label = cells.get(row, 0);
    const field = fields.find(([prefix]) => label.startsWith(prefix));
    if (field) for (const [part, column] of parts) part[field[1]] = cells.get(row, column);
  }

  let day = -1;
  let endingRow = 0;
  const totals = parts.map(() => new Map());
  for (const row of cells.rows) {
    if (row <= header) continue;
    const label = cells.get(row, 0);
    if (/^(?:총계|합\s*계|소계|계)$/.test(label)) break;
    if (label) {
      day = DAYS.indexOf(label);
      endingRow = cells.endingRow(row);
    }
    if (day < 0 || row > endingRow) continue;
    for (const [index, [part, column, name]] of parts.entries()) {
      const category = cells.get(row, column);
      const content = cells.get(row, column + 2);
      if (!category && !content) continue;
      let workType = cells.get(row, column + 1);
      if (!WORK_TYPES.has(workType)) {
        warnings.push(`${name} ${row}행: 업무 형태를 회사로 바꿨습니다.`);
        workType = '회사';
      }
      const raw = cells.get(row, column + 3);
      let hours = Number(raw);
      if (!raw || !Number.isFinite(hours)) {
        warnings.push(`${name} ${row}행: 시간을 읽을 수 없어 0시간으로 기록했습니다.`);
        hours = 0;
      }
      part.entries.push({ day: DAY_KEYS[day], category, workType, content, hours });
      const daily = totals[index];
      daily.set(day, (daily.get(day) ?? 0) + hours);
    }
  }
  for (const [index, [, , name]] of parts.entries()) {
    for (const [day, hours] of totals[index]) {
      if (hours > 24) warnings.push(`${name} ${DAYS[day]}요일: 하루 시간 합계가 24시간을 초과했습니다.`);
    }
  }
  return { weekStart, current, next, warnings };
}

module.exports = { readWeeklyWorkbook };
