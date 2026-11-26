'use strict';

// 우측 하단 챗봇: 문장 → { intent, 값 } 해석.
//
// - LLM_PROVIDER(anthropic | azure | openai)가 설정돼 있으면 LLM 으로 해석한다.
// - 미설정·실패·시간 초과·이상한 응답이면 규칙 기반으로 해석한다. (API 없이도 시연 가능)
// - LLM 은 "이해"만 담당한다. 잔여 연차, 결재 건수 같은 숫자는 server.js 가 DB 값으로 채운다.
// - 실제 신청·저장은 사용자가 챗봇 카드에서 확인 버튼을 눌러야 기존 API 로 실행된다.

const INTENTS = ['leave_request', 'weekly_report', 'room_request', 'room_status', 'check_in', 'check_out',
  'status', 'approvals', 'navigate', 'question', 'help'];
const ROUTE_LABEL = {
  home: '홈', attendance: '출퇴근', weekly: '주간보고', leave: '연차', approvals: '승인', rooms: '회의실 예약'
};
const ROUTES = Object.keys(ROUTE_LABEL);
const WEEKLY_WORD = /(주간\s*보고|위클리|주보|타임\s*시트)/;
const ROOM_WORD = /회의실/;
const ROUTE_WORDS = [
  ['weekly', WEEKLY_WORD],
  ['rooms', ROOM_WORD],
  ['approvals', /(승인|결재|반려)/],
  ['attendance', /(출퇴근|근태|출근|퇴근|지각)/],
  ['leave', /(연차|휴가|반차|월차|캘린더|달력)/],
  ['home', /(홈|대시보드|메인|첫\s*화면|공지)/]
];
function routeByKeywords(text) {
  return ROUTE_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}
const LEAVE_TYPES = ['annual', 'half_am', 'half_pm'];
const WEEKDAY_CHARS = '일월화수목금토'; // getUTCDay() 순서
const WEEKLY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WORK_TYPES = ['회사', '재택', '출장', '외근', '휴가'];
const DAY_MS = 86_400_000;

// ---------- 날짜 유틸 (UTC 자정 Date 로 통일) ----------

function localToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
const isWeekday = (date) => date.getUTCDay() % 6 !== 0;

function mondayOf(date) {
  const dow = date.getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
function makeDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day ? d : null;
}
function monthDay(today, month, day) {
  let d = makeDate(today.getUTCFullYear(), month, day);
  if (d && d < today) d = makeDate(today.getUTCFullYear() + 1, month, day);
  return d;
}
function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}
function leaveDays(type, startDate, endDate) {
  if (type !== 'annual') return 0.5;
  let n = 0;
  for (let d = new Date(`${startDate}T00:00:00Z`); iso(d) <= endDate; d = addDays(d, 1)) {
    if (isWeekday(d)) n++;
  }
  return n;
}

// ---------- 규칙 기반: 의도 ----------

function classifyByRules(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  // "주간보고 탭 열어줘", "연차 화면으로 이동" → 화면 이동
  const weeklyForm = /^(?:주간\s*보고|위클리|주보|타임\s*시트)\s*[:：]/.test(t);
  const navigation = /(열어|열기|이동|가\s*줘|가자|띄워|들어가|켜\s*줘)|(?:탭|메뉴|화면|페이지)\s*$/.test(t);
  if (!weeklyForm && routeByKeywords(t) && navigation) {
    return 'navigate';
  }
  const asking = /(남은|잔여|몇\s*일|며칠|얼마|상태|했(나|어|니)|됐(나|어|니)|알려|보여|언제|\?)/.test(t);

  if (WEEKLY_WORD.test(t) && (!ROOM_WORD.test(t) || t.search(WEEKLY_WORD) < t.search(ROOM_WORD))) {
    const lookup = asking || /(현황|요약|어떻게)/.test(t);
    return lookup && !/[:：]|\d\s*(시간|h\b)/i.test(t) ? 'status' : 'weekly_report';
  }
  if (ROOM_WORD.test(t)) {
    const lookup = /(현황|목록|일정|예약\s*(?:상태|내역|확인|있|됐)|비어|알려|보여)/.test(t);
    const booking = /(예약|잡아|잡을|대관)/.test(t);
    return booking && (!lookup || /예약\s*(?:해|하|부탁)|잡아/.test(t)) ? 'room_request' : 'room_status';
  }
  if (/(출근|퇴근)/.test(t) && !asking) {
    return /퇴근/.test(t) ? 'check_out' : 'check_in';
  }
  if (/(연차|반차|휴가|월차)/.test(t) && !asking) return 'leave_request';
  if (/(결재|승인)/.test(t) && !/반려/.test(t)) return 'approvals';
  // 홈 요약으로 답할 수 있는 질문만 status, 나머지 질문은 question (API 가 있으면 AI 가 내 데이터로 답함)
  if (/(잔여|남은|요약|현황|오늘|누가|부재|상태|했(나|어|니|는지)|됐(나|어|니))/.test(t)) return 'status';
  if (asking || /(뭐|무엇|어디|왜|몇|어떻게)/.test(t)) return 'question';
  return 'help';
}

// ---------- 규칙 기반: 연차 ----------

function parseLeaveByRules(text, today) {
  const src = String(text).replace(/\s+/g, ' ').trim();
  let rest = src;
  const consume = (fragment) => { rest = rest.replace(fragment, ' '); };

  let type = 'annual';
  const half = /(오전|오후)?\s*반차/.exec(src);
  if (half) {
    type = half[1] === '오후' ? 'half_pm' : 'half_am';
    consume(half[0]);
  }

  const dates = [];
  for (const m of src.matchAll(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/g)) {
    const d = makeDate(+m[1], +m[2], +m[3]);
    if (d) { dates.push(d); consume(m[0]); }
  }
  let lastMonth = null;
  for (const m of rest.matchAll(/(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일(?!\s*(?:간|동안))/g)) {
    const month = m[1] ? +m[1] : lastMonth;
    if (!month) continue;
    lastMonth = month;
    const d = monthDay(today, month, +m[2]);
    if (d) { dates.push(d); consume(m[0]); }
  }
  for (const m of rest.matchAll(/(?<![\d.])(\d{1,2})[\/.](\d{1,2})(?![\d.])/g)) {
    const d = monthDay(today, +m[1], +m[2]);
    if (d) { dates.push(d); consume(m[0]); }
  }
  const relative = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 };
  for (const m of rest.matchAll(/오늘|내일|모레|글피/g)) {
    dates.push(addDays(today, relative[m[0]]));
    consume(m[0]);
  }

  // "다음 주 월화", "담주 월~수", "다음주 월요일부터 수요일까지", "금요일"
  const weekRe = /(다다음\s*주|다음\s*주|담주|차주|이번\s*주|금주)?\s*((?:[월화수목금토일](?:요일)?\s*(?:[~\-,·]|부터|에서|까지|와|과|랑|하고)?\s*)+)/g;
  for (const m of rest.matchAll(weekRe)) {
    const prefix = (m[1] || '').replace(/\s/g, '');
    const chunk = m[2];
    if (!prefix && !/요일/.test(chunk)) continue; // "월급", "화장실" 오인 방지
    const days = [...chunk.replace(/요일/g, '').matchAll(/[월화수목금토일]/g)]
      .map((x) => WEEKDAY_CHARS.indexOf(x[0]));
    if (days.length === 0) continue;
    const offset = { 다다음주: 14, 다음주: 7, 담주: 7, 차주: 7, 이번주: 0, 금주: 0 }[prefix];
    for (const dow of days) {
      const idx = dow === 0 ? 6 : dow - 1;
      let d = addDays(mondayOf(today), (offset ?? 0) + idx);
      if (offset === undefined && d < today) d = addDays(d, 7);
      dates.push(d);
    }
    consume(m[0]);
  }

  if (dates.length === 0) return null;
  dates.sort((a, b) => a - b);
  const start = dates[0];
  let end = dates[dates.length - 1];

  const span = /(\d+)\s*일\s*(?:간|동안)/.exec(src);
  if (span && dates.length === 1 && type === 'annual') {
    let left = +span[1] - 1;
    end = start;
    while (left > 0) {
      end = addDays(end, 1);
      if (isWeekday(end)) left--;
    }
    consume(span[0]);
  }
  if (type !== 'annual') end = start;

  return { type, startDate: iso(start), endDate: iso(end), reason: leaveReason(src, rest) };
}

function leaveReason(src, rest) {
  const explicit = /사유\s*[:은는]?\s*(.+)$/.exec(src);
  if (explicit) return explicit[1].trim().slice(0, 100);
  const cleaned = rest
    .replace(/(연차|휴가|반차|월차)\s*(를|을|좀)?/g, ' ')
    .replace(/부터|까지|동안/g, ' ')
    .replace(/[~\-,.·!?()]/g, ' ')
    .split(/\s+/)
    .map(reasonWord)
    .filter(Boolean)
    .join(' ')
    .replace(/\s*(때문에|으로)$/, '')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 100) : DEFAULT_REASON;
}

// 사유에서 동사·어미("써야하는데", "쓰려고요", "낼게", "가능할까요")는 버리고 명사("이사해야" → "이사")만 남긴다.
const LEAVE_VERB = /^(써|쓰|쓸|씁|쓴|씀|낼|내야|내려|내고|내요|내겠|냅|쉬|쉴|쉽|신청|부탁|주세|줘|가능|될|되|돼|있|싶|좀|그냥|혹시|제발|꼭|하루|이틀|사흘)/;
const VERB_ENDING = /(는데|어요|아요|게요|까요|래요|려고요?|려는데|야지|해요|하는데|할게|할래|습니다|니다|겠어|싶어|싶은데|네요|세요|해야|하려고|하러|해서|하고|할|이라서|라서|이라|이어서|가요|가야|가서|가려고|갈게)$/;
const PARTICLE = /^(으로|로|에|은|는|이|가|을|를|요|수|거|것|건|게)$/;

function reasonWord(word) {
  if (!word || PARTICLE.test(word) || LEAVE_VERB.test(word)) return '';
  if (VERB_ENDING.test(word)) {
    const noun = word.replace(VERB_ENDING, '');
    return noun.length >= 2 && !VERB_ENDING.test(noun) ? noun : '';
  }
  return word;
}

// ---------- 규칙 기반: 주간보고 ----------
const WEEKLY_EXAMPLE =
  '주간보고: 월 사내 그룹웨어 7시간 화면 설계, 운영 지원 1시간 서버 점검 / 차주: 화 AI 챗봇 PoC 8시간 / 이슈: 없음';
const WEEKLY_NOTES = {
  issues: /^(?:이슈(?:사항)?|문제|리스크)(?=\s|[:：]|$)\s*[:：]?\s*/,
  requests: /^(?:요청(?:사항)?|전달(?:사항)?)(?=\s|[:：]|$)\s*[:：]?\s*/,
  personalSchedule: /^개인\s*일정(?=\s|[:：]|$)\s*[:：]?\s*/
};
const defaultCurrentDay = (today) => WEEKLY_DAYS[today.getUTCDay() - 1] ?? 'fri';

function emptyWeekly() {
  return { current: { entries: [], issues: '', requests: '', personalSchedule: '' }, next: { entries: [] } };
}

function parseWeeklyByRules(text, today = localToday()) {
  const body = text.replace(/^.*?(?:주간\s*보고|위클리|주보|타임\s*시트)\s*(?:를|을)?\s*(?:(?:작성|저장|제출)(?:해\s*줘|해\s*주세요)?|써\s*줘)?\s*[:：]?/, '');
  const result = emptyWeekly();
  const days = { current: defaultCurrentDay(today), next: 'mon' };
  let part = 'current';

  for (let segment of body.split(/\n|[,;·]|\s+\/\s+/).map((s) => s.trim()).filter(Boolean)) {
    const header = /^(차주(?:\s*계획)?|다음\s*주(?:\s*계획)?|금주(?:\s*실적)?|이번\s*주(?:\s*실적)?)(?=\s|[:：]|$)\s*[:：]?\s*/.exec(segment);
    if (header) {
      part = /^(차주|다음)/.test(header[1]) ? 'next' : 'current';
      segment = segment.slice(header[0].length);
    }
    const note = Object.entries(WEEKLY_NOTES).find(([, re]) => re.test(segment));
    if (note) {
      const [key, re] = note;
      result.current[key] = [result.current[key], segment.replace(re, '')].filter(Boolean).join(', ');
      continue;
    }

    // 요일을 한 번 적으면 같은 구간의 다음 항목에도 적용한다.
    const day = /^([월화수목금])(?:요일)?(?=\s|[:：-]|$)\s*[:：-]?\s*/.exec(segment);
    if (day) {
      days[part] = WEEKLY_DAYS[WEEKDAY_CHARS.indexOf(day[1]) - 1];
      segment = segment.slice(day[0].length);
    }
    if (!segment) continue;
    const duration = /(-?\d+(?:\.\d+)?)\s*(?:시간|h\b)/i.exec(segment);
    let category = duration ? segment.slice(0, duration.index) : segment;
    let content = duration ? segment.slice(duration.index + duration[0].length).replace(/^[\s:：-]+/, '') : '';
    const workType = /(?:^|[\s(])(회사|재택|출장|외근|휴가)(?=$|[\s)])/u.exec(category);
    const contentType = workType ? null : /^\(?(회사|재택|출장|외근|휴가)\)?(?=\s|$)\s*/.exec(content);
    if (workType) category = category.replace(workType[0], ' ').replace(/\(\s*\)/g, '');
    if (contentType) content = content.slice(contentType[0].length);
    category = category.replace(/[:：-]\s*$/, '').trim();
    result[part].entries.push({
      day: days[part],
      category: (category || '일반 업무').slice(0, 60),
      workType: workType?.[1] ?? contentType?.[1] ?? '회사',
      content: content.trim().slice(0, 200),
      hours: Math.max(0, Number(duration?.[1] ?? 0))
    });
  }
  return result;
}

// ---------- 규칙 기반: 회의실 ----------

function roomDate(text, today, fallback = null) {
  const full = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (full) return makeDate(+full[1], +full[2], +full[3]);
  const short = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  if (short) return monthDay(today, +short[1], +short[2]);
  const relative = /오늘|내일|모레/.exec(text);
  if (relative) return addDays(today, { 오늘: 0, 내일: 1, 모레: 2 }[relative[0]]);
  if (/다음\s*평일/.test(text)) {
    let date = addDays(today, 1);
    while (!isWeekday(date)) date = addDays(date, 1);
    return date;
  }
  const weekday = /(?:(다다음\s*주|다음\s*주|담주|차주|이번\s*주|금주)\s*)?([월화수목금토일])요일/.exec(text);
  if (!weekday) return fallback;
  const prefix = (weekday[1] ?? '').replace(/\s/g, '');
  const offset = { 다다음주: 14, 다음주: 7, 담주: 7, 차주: 7, 이번주: 0, 금주: 0 }[prefix];
  const dow = WEEKDAY_CHARS.indexOf(weekday[2]);
  const date = addDays(mondayOf(today), (offset ?? 0) + (dow + 6) % 7);
  return offset === undefined && date < today ? addDays(date, 7) : date;
}

function parseRoomByRules(text, today) {
  const [request, ...fields] = text.split(/(?:\s*[,;]\s*|\s+)(제목|참석자)(?:은|는)?(?=\s|[:：]|$)\s*[:：]?\s*/);
  const extras = {};
  for (let i = 0; i < fields.length; i += 2) {
    extras[fields[i]] = fields[i + 1].replace(/[\s,;]+$/, '').trim();
  }
  const date = roomDate(request, today);
  const clock = /(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/.exec(request);
  const korean = clock ? null : /(?:(오전|오후)\s*)?(?<!\d)(\d{1,2})\s*시(?!간)(\s*반)?/.exec(request);
  const start = clock ?? korean;
  let minutes = null;
  if (clock && +clock[2] < 60) minutes = +clock[1] * 60 + +clock[2];
  if (korean && (!korean[1] || (+korean[2] >= 1 && +korean[2] <= 12))) {
    const hour = korean[1] ? +korean[2] % 12 + (korean[1] === '오후' ? 12 : 0) : +korean[2];
    minutes = hour * 60 + (korean[3] ? 30 : 0);
  }

  const rest = start ? request.replace(start[0], ' ') : request;
  const durations = [...rest.matchAll(/(-?\d+(?:\.\d+)?)\s*(시간|분)/g)];
  const duration = durations.length
    ? durations.reduce((sum, m) => sum + Number(m[1]) * (m[2] === '시간' ? 60 : 1), 0)
    : 60;
  return { request, date, start, minutes, duration, title: extras.제목 || '회의', attendees: extras.참석자 ?? '' };
}

const clockLabel = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// ---------- LLM ----------

const WEEKLY_ENTRIES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      day: { type: 'string', enum: WEEKLY_DAYS },
      category: { type: 'string' },
      workType: { type: 'string', enum: WORK_TYPES },
      content: { type: 'string' },
      hours: { type: 'number' }
    },
    required: ['day', 'category', 'workType', 'content', 'hours'],
    additionalProperties: false
  }
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    leave: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: LEAVE_TYPES },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['type', 'startDate', 'endDate', 'reason'],
      additionalProperties: false
    },
    weekly: {
      type: 'object',
      properties: {
        current: {
          type: 'object',
          properties: {
            entries: WEEKLY_ENTRIES_SCHEMA,
            issues: { type: 'string' },
            requests: { type: 'string' },
            personalSchedule: { type: 'string' }
          },
          required: ['entries', 'issues', 'requests', 'personalSchedule'],
          additionalProperties: false
        },
        next: {
          type: 'object',
          properties: { entries: WEEKLY_ENTRIES_SCHEMA },
          required: ['entries'],
          additionalProperties: false
        }
      },
      required: ['current', 'next'],
      additionalProperties: false
    },
    route: { type: 'string', enum: [...ROUTES, 'none'] }
  },
  required: ['intent', 'leave', 'weekly', 'route'],
  additionalProperties: false
};

function systemPrompt(today) {
  return [
    '너는 사내 그룹웨어 챗봇의 해석기다. 사용자 문장을 의도와 입력값으로 바꾼다. 답장은 쓰지 않는다.',
    `오늘은 ${iso(today)} (${WEEKDAY_CHARS[today.getUTCDay()]}요일). 한 주는 월요일 시작. "다음 주"는 다음 달력 주.`,
    '',
    'intent:',
    '- leave_request: 연차·반차·휴가를 신청하려는 문장',
    '- weekly_report: 주간보고 작성·저장·제출 또는 주간보고 요약 요청',
    '- room_request / room_status: 회의실 예약 / 회의실 예약 현황 조회',
    '- check_in / check_out: 지금 출근 / 퇴근 처리 요청',
    '- status: 잔여 연차, 출근 여부, 주간보고 상태, 오늘 부재자, 공지 등 조회',
    '- approvals: 결재·승인 대기 건을 보거나 처리하려는 문장',
    '- navigate: 특정 화면·탭·메뉴를 열거나 이동하려는 문장',
    '- question: 위에 해당하지 않는 질문 (예: 지난달 지각 몇 번, 공지 내용, 내 연차 언제 썼지, 반려 사유)',
    '- help: 인사, 사용법 문의 등 그 외',
    '',
    'route: home(홈·공지) attendance(출퇴근·근태) weekly(주간보고) leave(연차·캘린더) approvals(승인·결재) rooms(회의실 예약). 없으면 "none".',
    '',
    'leave (leave_request 일 때만 의미 있음, 아니면 기본값):',
    '- type: 종일 "annual", 오전 반차 "half_am", 오후 반차 "half_pm". 반차는 startDate = endDate.',
    '- 날짜는 YYYY-MM-DD. 여러 요일이면 첫날~마지막날. 날짜를 알 수 없으면 빈 문자열.',
    '- reason: 짧은 한국어 명사구, 없으면 "개인 사유".',
    '',
    'weekly (weekly_report 일 때만 의미 있음, 아니면 빈 값):',
    '- current는 금주 실적 {entries, issues, requests, personalSchedule}, next는 차주 계획 {entries}. 언급되지 않은 메모는 빈 문자열.',
    '- 각 entry: {day: mon|tue|wed|thu|fri, category: 프로젝트·업무 분류, workType: 회사|재택|출장|외근|휴가, content: 업무 내용, hours: 시간}.',
    `- 같은 구간에서 명시한 요일은 다음 요일이 나오기 전까지 적용. 요일이 없으면 금주는 ${defaultCurrentDay(today)}, 차주는 mon. 근무 형태가 없으면 회사, 시간이 없으면 0.`,
    `- 예: "${WEEKLY_EXAMPLE}"`,
    '',
    'JSON 객체 하나만 출력: {"intent":...,"leave":{"type","startDate","endDate","reason"},"weekly":{"current":{"entries":[...],"issues","requests","personalSchedule"},"next":{"entries":[...]}},"route":...}'
  ].join('\n');
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LLM 응답 시간 초과 (${ms}ms)`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

let anthropicClient;
async function callAnthropic(system, userText, schema) {
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
    Anthropic = Anthropic.default ?? Anthropic;
  } catch {
    throw new Error('@anthropic-ai/sdk 미설치: groupware 폴더에서 npm install @anthropic-ai/sdk');
  }
  anthropicClient ??= new Anthropic(); // ANTHROPIC_API_KEY
  const response = await anthropicClient.beta.messages.create({
    model: process.env.LLM_MODEL || 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: userText }]
  });
  if (response.stop_reason === 'refusal') throw new Error('모델이 요청을 거절했습니다.');
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('모델 응답에 텍스트가 없습니다.');
  return JSON.parse(block.text);
}

async function callChatCompletions(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${payload?.error?.message ?? '응답 오류'}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('모델 응답이 비어 있습니다.');
  return JSON.parse(content);
}

const chatMessages = (system, userText) => [
  { role: 'system', content: system },
  { role: 'user', content: userText }
];

async function callAzure(system, userText) {
  const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT } = process.env;
  if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_API_KEY || !AZURE_OPENAI_DEPLOYMENT) {
    throw new Error('AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT 필요');
  }
  const version = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
  const url = `${AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${version}`;
  // temperature 는 보내지 않음 (reasoning 계열 배포가 거부함)
  return callChatCompletions(url, { 'api-key': AZURE_OPENAI_API_KEY }, {
    messages: chatMessages(system, userText),
    response_format: { type: 'json_object' }
  });
}

async function callOpenAI(system, userText) {
  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 필요');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return callChatCompletions(`${base}/chat/completions`, { Authorization: `Bearer ${OPENAI_API_KEY}` }, {
    model: process.env.LLM_MODEL || 'gpt-4.1-mini',
    messages: chatMessages(system, userText),
    response_format: { type: 'json_object' }
  });
}

const PROVIDERS = { anthropic: callAnthropic, azure: callAzure, openai: callOpenAI };

async function callLlm(system, userText, schema) {
  const provider = providerName();
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 8000;
  return withTimeout(PROVIDERS[provider](system, userText, schema), timeoutMs);
}

function providerName() {
  const name = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  return PROVIDERS[name] ? name : null;
}

// LLM 응답 정리. 연차 날짜가 이상하면 null 로 두고, 뒤에서 규칙 파서로 보충한다.
function normalizeLlm(raw, today) {
  if (!raw || !INTENTS.includes(raw.intent)) throw new Error('모델 응답의 intent 가 올바르지 않습니다.');
  let leave = null;
  const l = raw.leave;
  if (l && LEAVE_TYPES.includes(l.type) && isIsoDate(l.startDate) && isIsoDate(l.endDate) &&
      l.endDate >= l.startDate) {
    leave = {
      type: l.type,
      startDate: l.startDate,
      endDate: l.type === 'annual' ? l.endDate : l.startDate,
      reason: (typeof l.reason === 'string' && l.reason.trim()) ? l.reason.trim().slice(0, 100) : '개인 사유'
    };
  }
  const weekly = emptyWeekly();
  const trim = (value) => typeof value === 'string' ? value.trim() : '';
  for (const part of ['current', 'next']) {
    const input = raw.weekly?.[part];
    const fallbackDay = part === 'current' ? defaultCurrentDay(today) : 'mon';
    if (!Array.isArray(input?.entries)) continue;
    weekly[part].entries = input.entries.filter((entry) => trim(entry?.category)).map((entry) => ({
      day: WEEKLY_DAYS.includes(entry.day) ? entry.day : fallbackDay,
      category: trim(entry.category).slice(0, 60),
      workType: WORK_TYPES.includes(entry.workType) ? entry.workType : '회사',
      content: trim(entry.content).slice(0, 200),
      hours: Number.isFinite(Number(entry.hours)) ? Math.max(0, Number(entry.hours)) : 0
    }));
  }
  for (const key of Object.keys(WEEKLY_NOTES)) weekly.current[key] = trim(raw.weekly?.current?.[key]);
  const route = ROUTES.includes(raw.route) ? raw.route : null;
  return { intent: raw.intent, leave, weekly, route };
}

// ---------- 진입점 ----------

async function interpret(text, today = localToday()) {
  const provider = providerName();
  const intent = classifyByRules(text);
  const route = routeByKeywords(text);
  let warning = null;

  // 화면 이동과 회의실 입력은 규칙만으로 처리한다.
  if (['navigate', 'room_request', 'room_status'].includes(intent)) {
    return { intent, leave: null, weekly: emptyWeekly(), route, source: 'rule', warning };
  }

  if (provider) {
    try {
      const parsed = normalizeLlm(await callLlm(systemPrompt(today), text, OUTPUT_SCHEMA), today);
      if (parsed.intent === 'leave_request' && !parsed.leave) {
        parsed.leave = parseLeaveByRules(text, today);
      }
      return { ...parsed, source: 'llm', warning };
    } catch (error) {
      console.warn(`[assistant] ${provider} 실패 → 규칙 기반으로 대체: ${error.message}`);
      warning = 'AI 해석에 실패해 규칙 기반으로 처리했어요.';
    }
  }

  return {
    intent,
    leave: intent === 'leave_request' ? parseLeaveByRules(text, today) : null,
    weekly: intent === 'weekly_report' ? parseWeeklyByRules(text, today) : emptyWeekly(),
    route,
    source: 'rule',
    warning
  };
}

// ---------- 기가 막힌 사연 (사유가 없을 때) ----------

const DEFAULT_REASON = '개인 사유';

// API 가 없거나 실패했을 때 쓰는 준비된 사연. 아프거나 다치는 이야기, 실존 인물·회사는 넣지 않는다.
const STORY_POOL = [
  '3년간 키운 몬스테라가 드디어 새 잎을 낸다고 해서, 그 역사적 순간을 곁에서 지켜보려 합니다.',
  '동네 고양이 연합 정기총회에 명예 위원으로 초대받아 도저히 불참할 수 없는 상황입니다.',
  '냉장고 속 반찬통들과 미뤄둔 진지한 면담이 있습니다. 더 미루면 그들이 먼저 움직일 것 같습니다.',
  '1000피스 퍼즐의 마지막 한 조각을 찾는 대규모 수색 작전을 지휘해야 합니다.',
  '침대가 요즘 부쩍 외로워해서, 하루 온전히 곁에 있어 주기로 굳게 약속했습니다.',
  '알람 없이 일어나는 삶이 실제로 가능한지 과학적으로 검증하는 실험을 진행합니다.',
  '세탁기가 3주째 저를 기다리고 있어, 더는 그 눈빛을 외면할 수 없게 되었습니다.',
  '미뤄둔 드라마 네 시즌이 이제는 결말을 보여주겠다며 간곡히 저를 부르고 있습니다.',
  '제 안의 배터리가 1%라, 하루 동안 충전기에 꽂혀 있어야 정상 출근이 가능합니다.',
  '모처럼 하늘이 맑을 예정이라, 미뤄왔던 광합성 일정을 잡았습니다.',
  '동네 붕어빵 가게가 올해 첫 영업을 시작해, 오픈런이 불가피하게 되었습니다.',
  '택배 기사님께서 "그날은 꼭 집에 계세요"라고 하셨습니다. 운명이라고 생각합니다.'
];

const STORY_SCHEMA = {
  type: 'object',
  properties: { story: { type: 'string' } },
  required: ['story'],
  additionalProperties: false
};

const STORY_SYSTEM = [
  '너는 사내 그룹웨어 연차 신청서의 사유 칸을 채우는 작가다.',
  '특별한 사유가 없는 연차에 "기가 막힌 사연"을 한국어 1~2문장, 80자 이내로 쓴다.',
  '- 과장되고 진지한 말투로 쓴 소소한 일상 이야기 (예: 반려식물, 밀린 빨래, 동네 붕어빵, 침대와의 약속)',
  '- 팀장이 읽고 웃을 수 있고 결재해도 문제없는 수준. 존댓말.',
  '- 질병, 부상, 사고, 장례, 가족 우환, 실존 인물·회사·브랜드, 정치·종교, 거짓 공적 사유(예비군, 법원 등)는 쓰지 않는다.',
  '- 매번 다른 소재를 쓴다.',
  'JSON 하나만 출력: {"story": "..."}'
].join('\n');

function pickStory(avoid) {
  const pool = STORY_POOL.filter((s) => s !== avoid);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function writeStory({ type, startDate, endDate }, avoid = '') {
  if (providerName()) {
    try {
      const kind = { annual: '연차', half_am: '오전 반차', half_pm: '오후 반차' }[type] ?? '연차';
      const ask = `${kind}, ${startDate}${endDate && endDate !== startDate ? ` ~ ${endDate}` : ''}.` +
        (avoid ? ` 직전 사연과 다른 소재로: "${avoid}"` : '');
      const { story } = await callLlm(STORY_SYSTEM, ask, STORY_SCHEMA);
      if (typeof story === 'string' && story.trim()) {
        return { story: story.trim().slice(0, 120), source: 'llm' };
      }
      throw new Error('사연이 비어 있습니다.');
    } catch (error) {
      console.warn(`[assistant] 사연 생성 실패 → 준비된 사연 사용: ${error.message}`);
    }
  }
  return { story: pickStory(avoid), source: 'rule' };
}

// ---------- 챗봇 응답 ----------
// 반환: { reply, source, warning, action }
// 실제 실행은 화면에서 사용자 확인 후 기존 API 로 한다.

const TYPE_LABEL = { annual: '연차', half_am: '오전 반차', half_pm: '오후 반차' };
const WEEKLY_LABEL = { none: '미작성', draft: '임시저장', submitted: '제출(결재 대기)', approved: '승인', rejected: '반려' };

const HELP = [
  '이런 걸 할 수 있어요.',
  '· "다음 주 월화 연차 쓸게요"',
  `· "${WEEKLY_EXAMPLE}"`,
  '· "출근" / "퇴근"',
  '· "내일 오후 3시 소회의실 A 1시간 예약, 제목 스프린트 회의"',
  '· "오늘 요약", "오늘 회의실 현황", "잔여 연차 알려줘"',
  '· (팀장) "결재 대기 보여줘"',
  '· "주간보고 탭 열어줘" 처럼 화면 이동',
  '· 그 밖의 질문 (예: "지난달 지각 몇 번이야?", "반려 사유가 뭐였지?")'
].join('\n');

// ---------- 그 밖의 질문: 내 데이터만 근거로 LLM 이 답함 ----------

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    route: { type: 'string', enum: [...ROUTES, 'none'] }
  },
  required: ['answer', 'route'],
  additionalProperties: false
};

function answerSystem(today) {
  return [
    '너는 사내 그룹웨어의 업무 도우미다. 사용자 질문에 한국어 존댓말로 3문장 이내로 답한다.',
    `오늘은 ${iso(today)}.`,
    '- 사용자 메시지에 들어 있는 [그룹웨어 데이터] JSON 만 근거로 답한다. 숫자·날짜·이름은 데이터에 있는 그대로 쓴다.',
    '- 데이터에 없는 내용(회사 규정, 급여, 다른 팀 정보 등)은 지어내지 말고 "그룹웨어 데이터에서는 확인할 수 없어요"라고 말한다.',
    '- 인사나 잡담에는 짧게 응대하고 할 수 있는 일(연차 신청, 주간보고, 출퇴근, 결재, 회의실 예약, 화면 이동)을 안내한다.',
    '- route: 답과 가장 관련된 화면. home(홈·공지) attendance(출퇴근·근태) weekly(주간보고) leave(연차·캘린더) approvals(승인·결재) rooms(회의실 예약). 없으면 "none".',
    'JSON 하나만 출력: {"answer": "...", "route": "..."}'
  ].join('\n');
}

async function answerQuestion(text, snapshot, today) {
  const ask = `[질문]\n${text}\n\n[그룹웨어 데이터]\n${JSON.stringify(snapshot)}`;
  const { answer, route } = await callLlm(answerSystem(today), ask, ANSWER_SCHEMA);
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('답변이 비어 있습니다.');
  return { answer: answer.trim(), route: ROUTES.includes(route) ? route : null };
}

const openScreen = (route, auto = false) =>
  (route ? { kind: 'navigate', route, label: ROUTE_LABEL[route], auto } : null);

const EXECUTIVE_ROUTES = new Set(['attendance', 'leave', 'approvals']);
const EXECUTIVE_RESTRICTION = '출퇴근·연차·승인은 임원 메뉴에서 지원하지 않는 기능이에요.';

function executiveWeeklyLines(ctx) {
  return ctx.executiveWeekly().teams.map(({ team, stats }) => {
    const { submittedCount, memberCount, totalHours } = stats;
    const rate = memberCount ? Math.round(submittedCount / memberCount * 100) : 0;
    return `· ${team}: 제출 ${submittedCount}/${memberCount}명 (${rate}%), 총 ${totalHours}시간`;
  });
}

function roleWeeklyReply(ctx, role) {
  if (role === 'manager') {
    const { team, stats } = ctx.teamWeekly();
    return `${team} 이번 주 주간보고는 제출 ${stats.submittedCount}/${stats.memberCount}명이에요. 주간보고 팀 종합 화면에서 확인해 보세요.`;
  }
  return ['이번 주 팀별 주간보고 현황이에요.', ...executiveWeeklyLines(ctx)].join('\n');
}

function statusReply(h, ctx) {
  const lines = [`${h.user.name} 님, ${h.today} 요약이에요.`];
  const meetings = h.myReservationsToday ?? [];
  const meetingSummary = meetings.map(({ title, roomName, startTime, endTime }) =>
    `${startTime}~${endTime} ${roomName} (${title})`).join(', ');
  const meetingLine = `· 오늘 내 회의: ${meetingSummary || '없음'}`;
  if (h.user.role === 'executive') {
    return [...lines, '이번 주 팀별 주간보고:', ...executiveWeeklyLines(ctx), meetingLine].join('\n');
  }
  const a = h.attendance;
  const att = a.status === 'none' ? '아직 출근 전'
    : a.status === 'working' ? `${a.checkIn} 출근${a.late ? ' (지각)' : ''}, 근무 중`
      : `${a.checkIn} 출근 · ${a.checkOut} 퇴근`;
  const b = h.balance;
  lines.push(
    `· 근태: ${att}`,
    `· 연차: 잔여 ${b.remaining}일 (대기 ${b.pending}일, 사용 ${b.used}일 / 총 ${b.total}일)`,
    `· 이번 주 주간보고: ${WEEKLY_LABEL[h.weeklyReport.status] ?? h.weeklyReport.status}`,
    `· 내가 올린 결재 대기: ${h.myPendingCount}건`
  );
  if (h.user.role === 'manager') lines.push(`· 내가 처리할 결재: ${h.approvalPendingCount}건`);
  const off = h.teamOnLeaveToday ?? [];
  lines.push(`· 오늘 팀 부재: ${off.length ? off.map((x) => `${x.userName}(${TYPE_LABEL[x.type] ?? x.type})`).join(', ') : '없음'}`);
  lines.push(meetingLine);
  return lines.join('\n');
}

function roomBookingReply(text, ctx, today) {
  const { request, date, start, minutes, duration, title, attendees } = parseRoomByRules(text, today);
  const rooms = ctx.rooms();
  const nameKey = (value) => value.replace(/\s+/g, '').toLowerCase();
  const room = rooms.find(({ name }) => nameKey(request).includes(nameKey(name)));
  if (!date || !start || !room) {
    return { reply: '예약 날짜와 시작 시각, 회의실 이름을 알려주세요.\n예: "내일 오후 3시 소회의실 A 1시간 예약, 제목 스프린트 회의"' };
  }
  if (date < today) return { reply: '지난 날짜는 예약할 수 없어요. 오늘 이후 날짜를 알려주세요.' };
  if (minutes === null || minutes < 480 || minutes % 30 !== 0 ||
      duration <= 0 || duration % 30 !== 0 || minutes + duration > 1200) {
    return { reply: '회의실은 08:00~20:00 사이에 30분 단위로 예약할 수 있어요.' };
  }

  const day = iso(date);
  const startTime = clockLabel(minutes);
  const endTime = clockLabel(minutes + duration);
  const occupied = new Set(ctx.reservations(day)
    .filter((row) => row.startTime < endTime && row.endTime > startTime)
    .map((row) => row.roomId));
  if (occupied.has(room.id)) {
    const free = rooms.filter(({ id }) => !occupied.has(id)).map(({ name }) => name);
    const suggestion = free.length ? `같은 시간에 이용할 수 있는 회의실은 ${free.join(', ')}예요.`
      : '같은 시간에 비어 있는 회의실이 없어요.';
    return { reply: `${room.name}은 ${day} ${startTime}~${endTime}에 이미 예약되어 있어요. ${suggestion}` };
  }
  return {
    reply: `${day} ${startTime}~${endTime}에 ${room.name}을 예약할까요?`,
    action: { kind: 'room', payload: { roomId: room.id, roomName: room.name, date: day, startTime, endTime, title, attendees } }
  };
}

function roomStatusReply(text, ctx, today) {
  const date = roomDate(text, today, today);
  if (!date) return '조회 날짜를 확인해 주세요.';
  const day = iso(date);
  const reservations = ctx.reservations(day);
  if (!reservations.length) return `${day} 회의실 예약이 없어요.`;
  const lines = reservations.slice(0, 8).map(({ roomName, startTime, endTime, title }) =>
    `· ${roomName} ${startTime}~${endTime} ${title}`);
  if (reservations.length > 8) lines.push(`· 외 ${reservations.length - 8}건`);
  return [`${day} 회의실 예약은 ${reservations.length}건이에요.`, ...lines].join('\n');
}

async function respond(text, ctx, today = localToday()) {
  const parsed = await interpret(text, today);
  const base = { source: parsed.source, warning: parsed.warning, action: null };
  const h = ctx.home();
  const role = h.user.role;
  const route = parsed.route ?? routeByKeywords(text);
  if (role === 'executive' && (
    ['check_in', 'check_out', 'leave_request', 'approvals'].includes(parsed.intent) ||
    (['navigate', 'status', 'question', 'help'].includes(parsed.intent) && EXECUTIVE_ROUTES.has(route))
  )) return { ...base, reply: EXECUTIVE_RESTRICTION };

  switch (parsed.intent) {
    case 'leave_request': {
      const leave = parsed.leave;
      if (!leave) {
        return { ...base, reply: '언제 쉬실지 알려주세요.\n예: "다음 주 월화 연차", "12월 3일 오후 반차"' };
      }
      const days = leaveDays(leave.type, leave.startDate, leave.endDate);
      if (days === 0) {
        return { ...base, reply: `${leave.startDate} ~ ${leave.endDate}는 주말뿐이라 차감할 평일이 없어요.` };
      }
      const action = { kind: 'leave', payload: { ...leave }, days, story: null };
      let reply = '이 내용으로 신청할까요?';
      if (leave.reason === DEFAULT_REASON) {
        const { story } = await writeStory(leave);
        action.payload.reason = story;
        action.story = { text: story, fallback: DEFAULT_REASON };
        reply = '사유가 따로 없으시길래, 기가 막힌 사연을 하나 준비했어요. 이대로 신청할까요?';
      }
      const available = h.balance.remaining - h.balance.pending;
      if (days > available) reply += `\n(신청 가능 일수가 ${available}일이라 신청이 거절될 수 있어요.)`;
      return { ...base, reply, action };
    }

    case 'weekly_report': {
      if (role !== 'employee') {
        return { ...base, reply: roleWeeklyReply(ctx, role), action: openScreen('weekly') };
      }
      const status = h.weeklyReport.status;
      if (status === 'submitted' || status === 'approved') {
        return { ...base, reply: `이번 주 주간보고는 이미 ${WEEKLY_LABEL[status]} 상태라 수정할 수 없어요.` };
      }
      const { current, next } = parsed.weekly;
      const entries = [...current.entries, ...next.entries];
      if (entries.length === 0 && !Object.keys(WEEKLY_NOTES).some((key) => current[key])) {
        return {
          ...base,
          reply: `업무 항목을 "요일 프로젝트 시간 내용" 형식으로 알려주세요.\n예: "${WEEKLY_EXAMPLE}"`
        };
      }
      const canSubmit = current.entries.length > 0 && entries.every(({ hours }) => hours > 0 && hours <= 24);
      let reply = `이번 주(${h.weeklyReport.weekStart}) 주간보고를 이렇게 정리했어요.`;
      if (status === 'draft' || status === 'rejected') reply += '\n저장하면 기존 보고서에 항목을 추가해요.';
      if (!canSubmit) reply += '\n제출하려면 금주 실적을 추가하고 각 항목의 업무 시간을 확인해 주세요.';
      return {
        ...base,
        reply,
        action: { kind: 'weekly', payload: { weekStart: h.weeklyReport.weekStart, current, next }, canSubmit }
      };
    }

    case 'room_request':
      return { ...base, ...roomBookingReply(text, ctx, today) };

    case 'room_status':
      return { ...base, reply: roomStatusReply(text, ctx, today), action: openScreen('rooms') };

    case 'check_in':
      if (h.attendance.status !== 'none') {
        return { ...base, reply: `이미 ${h.attendance.checkIn}에 출근 처리됐어요.` };
      }
      return { ...base, reply: '출근 처리할게요.', action: { kind: 'check_in' } };

    case 'check_out':
      if (h.attendance.status === 'none') return { ...base, reply: '오늘 출근 기록이 없어요. 먼저 "출근"이라고 말해 주세요.' };
      if (h.attendance.status === 'done') return { ...base, reply: `이미 ${h.attendance.checkOut}에 퇴근 처리됐어요.` };
      return { ...base, reply: '퇴근 처리할게요. 오늘도 고생 많으셨어요.', action: { kind: 'check_out' } };

    case 'approvals': {
      if (h.user.role !== 'manager') {
        return { ...base, reply: `내가 올린 결재 중 대기 건은 ${h.myPendingCount}건이에요. 자세한 내용은 승인 메뉴에서 볼 수 있어요.` };
      }
      const pending = ctx.pendingApprovals();
      if (pending.length === 0) return { ...base, reply: '처리할 결재가 없어요.' };
      const items = pending.slice(0, 5).map(({ kind, id, userName, title, detail }) => ({
        kind, id, userName, title, reason: kind === 'leave' ? detail.reason : ''
      }));
      const more = pending.length > 5 ? ` (최근 5건만 표시, 나머지는 승인 메뉴에서)` : '';
      return { ...base, reply: `결재 대기 ${pending.length}건이에요.${more}`, action: { kind: 'approvals', items } };
    }

    case 'navigate': {
      if (!route) return { ...base, reply: '어느 화면을 열까요? 홈, 출퇴근, 주간보고, 연차, 승인, 회의실 예약 중에서 말씀해 주세요.' };
      return { ...base, reply: `${ROUTE_LABEL[route]} 화면으로 이동할게요.`, action: openScreen(route, true) };
    }

    case 'status': {
      // 요약에 없는 걸 물었으면(예: 지난달 지각) 관련 화면 버튼을 같이 준다
      if (route === 'weekly' && role !== 'employee') {
        return { ...base, reply: roleWeeklyReply(ctx, role), action: openScreen('weekly') };
      }
      return { ...base, reply: statusReply(h, ctx), action: route && route !== 'home' ? openScreen(route) : null };
    }

    default: {
      // question, help: API 가 있으면 내 데이터로 답하고, 없거나 실패하면 관련 화면을 안내
      if (providerName() && ctx.snapshot) {
        try {
          const { answer, route } = await answerQuestion(text, ctx.snapshot(), today);
          if (role === 'executive' && EXECUTIVE_ROUTES.has(route)) {
            return { ...base, source: 'llm', reply: EXECUTIVE_RESTRICTION };
          }
          return { ...base, source: 'llm', reply: answer, action: openScreen(route) };
        } catch (error) {
          console.warn(`[assistant] 질문 답변 실패 → 안내로 대체: ${error.message}`);
          base.warning = 'AI 답변에 실패했어요.';
        }
      }
      if (route) {
        return {
          ...base,
          reply: `바로 답하기는 어려운 질문이에요. ${ROUTE_LABEL[route]} 화면에서 확인해 보시겠어요?`,
          action: openScreen(route)
        };
      }
      return { ...base, reply: HELP };
    }
  }
}

module.exports = {
  respond,
  writeStory,
  interpret,
  providerName,
  leaveDays,
  // 테스트용
  classifyByRules,
  parseLeaveByRules,
  parseWeeklyByRules
};
