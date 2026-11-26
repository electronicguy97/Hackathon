'use strict';

// 우측 하단 챗봇: 문장 → { intent, 값 } 해석.
//
// - LLM_PROVIDER(anthropic | azure | openai)가 설정돼 있으면 LLM 으로 해석한다.
// - 미설정·실패·시간 초과·이상한 응답이면 규칙 기반으로 해석한다. (API 없이도 시연 가능)
// - LLM 은 "이해"만 담당한다. 잔여 연차, 결재 건수 같은 숫자는 server.js 가 DB 값으로 채운다.
// - 실제 신청·저장은 사용자가 챗봇 카드에서 확인 버튼을 눌러야 기존 API 로 실행된다.

const INTENTS = ['leave_request', 'weekly_report', 'check_in', 'check_out', 'status', 'approvals', 'navigate', 'question', 'help'];
const ROUTES = ['home', 'attendance', 'weekly', 'leave', 'approvals'];
const ROUTE_LABEL = { home: '홈', attendance: '출퇴근', weekly: '주간보고', leave: '연차', approvals: '승인' };
const ROUTE_WORDS = [
  ['weekly', /(주간\s*보고|위클리|주보|타임\s*시트)/],
  ['approvals', /(승인|결재|반려)/],
  ['attendance', /(출퇴근|근태|출근부|지각|출근\s*기록)/],
  ['leave', /(연차|휴가|반차|월차|캘린더|달력)/],
  ['home', /(홈|대시보드|메인|첫\s*화면|공지)/]
];
function routeByKeywords(text) {
  return ROUTE_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}
const LEAVE_TYPES = ['annual', 'half_am', 'half_pm'];
const WEEKDAY_CHARS = '일월화수목금토'; // getUTCDay() 순서
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
  return d.getUTCMonth() === month - 1 ? d : null;
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
  if (routeByKeywords(t) && /(열어|열기|이동|가\s*줘|가자|띄워|들어가|켜\s*줘|탭|메뉴|화면|페이지)/.test(t)) {
    return 'navigate';
  }
  const asking = /(남은|잔여|몇\s*일|며칠|얼마|상태|했(나|어|니)|됐(나|어|니)|알려|보여|언제|\?)/.test(t);

  if (/(출근|퇴근)/.test(t) && !asking) {
    return /퇴근/.test(t) ? 'check_out' : 'check_in';
  }
  if (/(주간\s*보고|위클리|주보)/.test(t) && !(asking && !/\d\s*(시간|h)/i.test(t))) {
    return 'weekly_report';
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
// 예) "주간보고: AICC 유지보수 16시간 로그 분석, 해커톤 8시간 챗봇 구현 / 차주 계획: 발표 준비 / 이슈: 없음"

function parseWeeklyByRules(text) {
  const body = text.replace(/^.*?(주간\s*보고|위클리|주보)\s*(를|을)?\s*(작성|써\s*줘|저장|제출)?\s*[:：]?/, '');
  const result = { items: [], nextPlan: '', issues: '' };

  const segments = body.split(/\n|[,;]|\s\/\s|·/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const plan = /^(차주\s*계획|다음\s*주\s*계획|차주|계획)\s*[:：]?\s*(.*)$/.exec(seg);
    if (plan) { result.nextPlan = [result.nextPlan, plan[2]].filter(Boolean).join(', '); continue; }
    const issue = /^(이슈|문제|리스크)\s*[:：]?\s*(.*)$/.exec(seg);
    if (issue) { result.issues = [result.issues, issue[2]].filter(Boolean).join(', '); continue; }

    const hours = /(\d+(?:\.\d+)?)\s*(시간|h\b|H\b)/.exec(seg);
    if (!hours) continue;
    const project = seg.slice(0, hours.index).replace(/[:：\-]\s*$/, '').trim();
    const content = seg.slice(hours.index + hours[0].length).replace(/^\s*[:：\-]?\s*/, '').trim();
    result.items.push({
      project: (project || '일반 업무').slice(0, 60),
      hours: Number(hours[1]),
      content: (content || project || '').slice(0, 200)
    });
  }
  return result;
}

// ---------- LLM ----------

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
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              project: { type: 'string' },
              hours: { type: 'number' },
              content: { type: 'string' }
            },
            required: ['project', 'hours', 'content'],
            additionalProperties: false
          }
        },
        nextPlan: { type: 'string' },
        issues: { type: 'string' }
      },
      required: ['items', 'nextPlan', 'issues'],
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
    '- weekly_report: 이번 주 주간보고를 작성·저장·제출하려는 문장 (업무 내용이 들어 있음)',
    '- check_in / check_out: 지금 출근 / 퇴근 처리 요청',
    '- status: 잔여 연차, 출근 여부, 주간보고 상태, 오늘 부재자, 공지 등 조회',
    '- approvals: 결재·승인 대기 건을 보거나 처리하려는 문장',
    '- navigate: 특정 화면·탭·메뉴를 열거나 이동하려는 문장',
    '- question: 위에 해당하지 않는 질문 (예: 지난달 지각 몇 번, 공지 내용, 내 연차 언제 썼지, 반려 사유)',
    '- help: 인사, 사용법 문의 등 그 외',
    '',
    'route: 문장과 관련된 화면. home(홈·공지) attendance(출퇴근·근태) weekly(주간보고) leave(연차·캘린더) approvals(승인·결재). 없으면 "none".',
    '',
    'leave (leave_request 일 때만 의미 있음, 아니면 기본값):',
    '- type: 종일 "annual", 오전 반차 "half_am", 오후 반차 "half_pm". 반차는 startDate = endDate.',
    '- 날짜는 YYYY-MM-DD. 여러 요일이면 첫날~마지막날. 날짜를 알 수 없으면 빈 문자열.',
    '- reason: 짧은 한국어 명사구, 없으면 "개인 사유".',
    '',
    'weekly (weekly_report 일 때만 의미 있음, 아니면 빈 값):',
    '- items: 업무 항목별 {project: 프로젝트·업무 분류, hours: 시간, content: 한 일}. 문장에 시간이 없으면 hours는 0 (지어내지 말 것).',
    '- nextPlan: 차주 계획, issues: 이슈. 없으면 빈 문자열.',
    '',
    'JSON 객체 하나만 출력: {"intent":...,"leave":{"type","startDate","endDate","reason"},"weekly":{"items":[...],"nextPlan","issues"},"route":...}'
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
function normalizeLlm(raw) {
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
  const w = raw.weekly ?? {};
  const weekly = {
    items: (Array.isArray(w.items) ? w.items : [])
      .filter((it) => it && typeof it.project === 'string')
      .map((it) => ({
        project: it.project.trim().slice(0, 60) || '일반 업무',
        hours: Number.isFinite(Number(it.hours)) && Number(it.hours) >= 0 ? Number(it.hours) : 0,
        content: String(it.content ?? '').trim().slice(0, 200)
      })),
    nextPlan: typeof w.nextPlan === 'string' ? w.nextPlan.trim() : '',
    issues: typeof w.issues === 'string' ? w.issues.trim() : ''
  };
  const route = ROUTES.includes(raw.route) ? raw.route : null;
  return { intent: raw.intent, leave, weekly, route };
}

// ---------- 진입점 ----------

async function interpret(text, today = localToday()) {
  const provider = providerName();
  let warning = null;

  // "주간보고 탭 열어줘" 같은 화면 이동은 규칙만으로 확실하므로 LLM 을 부르지 않는다 (빠르고 안정적)
  if (classifyByRules(text) === 'navigate') {
    return { intent: 'navigate', leave: null, weekly: { items: [], nextPlan: '', issues: '' },
      route: routeByKeywords(text), source: 'rule', warning };
  }

  if (provider) {
    try {
      const parsed = normalizeLlm(await callLlm(systemPrompt(today), text, OUTPUT_SCHEMA));
      if (parsed.intent === 'leave_request' && !parsed.leave) {
        parsed.leave = parseLeaveByRules(text, today);
      }
      return { ...parsed, source: 'llm', warning };
    } catch (error) {
      console.warn(`[assistant] ${provider} 실패 → 규칙 기반으로 대체: ${error.message}`);
      warning = 'AI 해석에 실패해 규칙 기반으로 처리했어요.';
    }
  }

  const intent = classifyByRules(text);
  return {
    intent,
    leave: intent === 'leave_request' ? parseLeaveByRules(text, today) : null,
    weekly: intent === 'weekly_report' ? parseWeeklyByRules(text) : { items: [], nextPlan: '', issues: '' },
    route: routeByKeywords(text),
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
// ctx: { user, home: () => /api/home 응답, pendingApprovals: () => /api/approvals 응답 }
// 반환: { reply, source, warning, action }
//   action.kind: leave | weekly | check_in | check_out | approvals  (실행은 화면에서 사용자 확인 후 기존 API 로)

const TYPE_LABEL = { annual: '연차', half_am: '오전 반차', half_pm: '오후 반차' };
const WEEKLY_LABEL = { none: '미작성', draft: '임시저장', submitted: '제출(결재 대기)', approved: '승인', rejected: '반려' };

const HELP = [
  '이런 걸 할 수 있어요.',
  '· "다음 주 월화 연차 쓸게요"',
  '· "주간보고: AICC 유지보수 16시간 로그 분석, 해커톤 8시간 챗봇 구현 / 차주 계획: 발표 준비"',
  '· "출근" / "퇴근"',
  '· "오늘 요약", "잔여 연차 알려줘"',
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
    '- 인사나 잡담에는 짧게 응대하고 할 수 있는 일(연차 신청, 주간보고, 출퇴근, 결재, 화면 이동)을 안내한다.',
    '- route: 답과 가장 관련된 화면. home(홈·공지) attendance(출퇴근·근태) weekly(주간보고) leave(연차·캘린더) approvals(승인·결재). 없으면 "none".',
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

function statusReply(h) {
  const a = h.attendance;
  const att = a.status === 'none' ? '아직 출근 전'
    : a.status === 'working' ? `${a.checkIn} 출근${a.late ? ' (지각)' : ''}, 근무 중`
      : `${a.checkIn} 출근 · ${a.checkOut} 퇴근`;
  const b = h.balance;
  const lines = [
    `${h.user.name} 님, ${h.today} 요약이에요.`,
    `· 근태: ${att}`,
    `· 연차: 잔여 ${b.remaining}일 (대기 ${b.pending}일, 사용 ${b.used}일 / 총 ${b.total}일)`,
    `· 이번 주 주간보고: ${WEEKLY_LABEL[h.weeklyReport.status] ?? h.weeklyReport.status}`,
    `· 내가 올린 결재 대기: ${h.myPendingCount}건`
  ];
  if (h.user.role === 'manager') lines.push(`· 내가 처리할 결재: ${h.approvalPendingCount}건`);
  const off = h.teamOnLeaveToday ?? [];
  lines.push(`· 오늘 팀 부재: ${off.length ? off.map((x) => `${x.userName}(${TYPE_LABEL[x.type] ?? x.type})`).join(', ') : '없음'}`);
  return lines.join('\n');
}

async function respond(text, ctx, today = localToday()) {
  const parsed = await interpret(text, today);
  const base = { source: parsed.source, warning: parsed.warning };
  const h = ctx.home();

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
      const status = h.weeklyReport.status;
      if (status === 'submitted' || status === 'approved') {
        return { ...base, reply: `이번 주 주간보고는 이미 ${WEEKLY_LABEL[status]} 상태라 수정할 수 없어요.` };
      }
      const { items, nextPlan, issues } = parsed.weekly;
      if (items.length === 0) {
        return {
          ...base,
          reply: '업무 항목을 "프로젝트 시간 내용" 형식으로 알려주세요.\n예: "주간보고: AICC 유지보수 16시간 로그 분석, 해커톤 8시간 챗봇 구현 / 차주 계획: 발표 준비 / 이슈: 없음"'
        };
      }
      const canSubmit = items.every((it) => it.hours > 0);
      let reply = `이번 주(${h.weeklyReport.weekStart}) 주간보고를 이렇게 정리했어요.`;
      if (status === 'draft' || status === 'rejected') reply += '\n저장하면 기존 내용을 덮어써요.';
      if (!canSubmit) reply += '\n시간이 빠진 항목이 있어 임시저장만 할 수 있어요. 주간보고 메뉴에서 시간을 채워 주세요.';
      return {
        ...base,
        reply,
        action: { kind: 'weekly', payload: { weekStart: h.weeklyReport.weekStart, items, nextPlan, issues }, canSubmit }
      };
    }

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
      const route = parsed.route ?? routeByKeywords(text);
      if (!route) return { ...base, reply: '어느 화면을 열까요? 홈, 출퇴근, 주간보고, 연차, 승인 중에서 말씀해 주세요.' };
      return { ...base, reply: `${ROUTE_LABEL[route]} 화면으로 이동할게요.`, action: openScreen(route, true) };
    }

    case 'status': {
      // 요약에 없는 걸 물었으면(예: 지난달 지각) 관련 화면 버튼을 같이 준다
      const route = parsed.route ?? routeByKeywords(text);
      return { ...base, reply: statusReply(h), action: route && route !== 'home' ? openScreen(route) : null };
    }

    default: {
      // question, help: API 가 있으면 내 데이터로 답하고, 없거나 실패하면 관련 화면을 안내
      if (providerName() && ctx.snapshot) {
        try {
          const { answer, route } = await answerQuestion(text, ctx.snapshot(), today);
          return { ...base, source: 'llm', reply: answer, action: openScreen(route) };
        } catch (error) {
          console.warn(`[assistant] 질문 답변 실패 → 안내로 대체: ${error.message}`);
          base.warning = 'AI 답변에 실패했어요.';
        }
      }
      const route = parsed.route ?? routeByKeywords(text);
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
