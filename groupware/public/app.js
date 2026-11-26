(() => {
  'use strict';

  const STORAGE_KEY = 'groupware.selectedUserId';
  const ALL_ROUTES = ['home', 'attendance', 'weekly', 'leave', 'approvals', 'docs', 'rooms'];
  const EXEC_ROUTES = ['home', 'weekly', 'docs', 'rooms'];

  const DAYS = [
    { key: 'mon', label: '월' },
    { key: 'tue', label: '화' },
    { key: 'wed', label: '수' },
    { key: 'thu', label: '목' },
    { key: 'fri', label: '금' },
  ];

  const WORK_TYPES = ['회사', '재택', '출장', '외근', '휴가'];

  const LEAVE_TYPE_LABELS = {
    annual: '연차',
    half_am: '오전 반차',
    half_pm: '오후 반차',
  };

  const LEAVE_SHORT_LABELS = {
    annual: '연차',
    half_am: '오전',
    half_pm: '오후',
  };

  const STATUS_META = {
    none: { label: '미작성', className: 'badge badge-none' },
    working: { label: '근무 중', className: 'badge badge-working' },
    done: { label: '퇴근 완료', className: 'badge badge-done' },
    pending: { label: '대기', className: 'badge badge-pending' },
    draft: { label: '임시저장', className: 'badge badge-draft' },
    submitted: { label: '제출됨', className: 'badge badge-submitted' },
    approved: { label: '승인', className: 'badge badge-approved' },
    rejected: { label: '반려', className: 'badge badge-rejected' },
    cancelled: { label: '취소', className: 'badge badge-cancelled' },
  };

  const ATTENDANCE_STATUS_LABELS = {
    none: '미출근',
    working: '근무 중',
    done: '퇴근 완료',
  };

  const ROLE_META = {
    employee: { label: '구성원', className: 'role-badge role-badge-employee' },
    manager: { label: '팀장', className: 'role-badge role-badge-manager' },
    executive: { label: '임원', className: 'role-badge role-badge-executive' },
  };

  const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  const state = {
    users: [],
    currentUser: null,
    route: 'home',
    approvalKind: 'leave',
    docMode: 'view',
    docId: null,
    pendingDocHeading: '',
    docsSearchQuery: '',
    docsSearchResults: null,
    routeSeq: 0,
    attendanceMonth: '',
    leaveCalendarMonth: '',
    approvalsLeaveFilter: 'pending',
    approvalsWeeklyFilter: 'pending',
    empApprovalsLeaveFilter: 'all',
    empApprovalsWeeklyFilter: 'all',
    employeeWeekStart: '',
    lastUploadResult: null,
    managerWeekStart: '',
    execWeekStart: '',
    execSelectedTeam: null,
    roomsDate: '',
    toastTimer: null,
  };

  const dom = {
    userSelect: document.getElementById('user-select'),
    userAvatar: document.getElementById('user-avatar'),
    userDisplayName: document.getElementById('user-display-name'),
    userDisplayRole: document.getElementById('user-display-role'),
    roleBadge: document.getElementById('role-badge'),
    navLinks: Array.from(document.querySelectorAll('.sidebar-link[data-route]')),
    navSubLinks: Array.from(document.querySelectorAll('.sidebar-sublink[data-route]')),
    navApprovalGroup: document.querySelector('.sidebar-group[data-route-group="approvals"]'),
    navApprovalsBadge: document.getElementById('nav-approvals-badge'),
    navLeaveApprovalsBadge: document.getElementById('nav-leave-approvals-badge'),
    navWeeklyApprovalsBadge: document.getElementById('nav-weekly-approvals-badge'),
    globalError: document.getElementById('global-error'),
    globalErrorText: document.getElementById('global-error-text'),
    globalRetryBtn: document.getElementById('global-retry-btn'),
    routeView: document.getElementById('route-view'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modalDialog: document.getElementById('modal-dialog'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    toastCloseBtn: document.getElementById('toast-close-btn'),
  };

  /* ---------- Utilities ---------- */

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') {
        node.className = value;
      } else if (key === 'textContent') {
        node.textContent = value;
      } else if (key === 'checked' || key === 'disabled' || key === 'readOnly') {
        node[key] = Boolean(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === undefined || child === null || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function setVisible(element, visible) {
    element.hidden = !visible;
    element.classList.toggle('is-hidden', !visible);
  }

  function readStoredUserId() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function writeStoredUserId(userId) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(userId));
    } catch (_) {
      // Ignore storage failures in restricted contexts.
    }
  }

  function getLocalTodayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getLocalMonthISO() {
    return getLocalTodayISO().slice(0, 7);
  }

  function parseDateUTC(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcMs = Date.UTC(y, m - 1, d);
    const dt = new Date(utcMs);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return utcMs;
  }

  function shiftDateISO(dateStr, deltaDays) {
    const ms = parseDateUTC(dateStr);
    if (ms === null) return dateStr;
    const dt = new Date(ms + deltaDays * 86400000);
    return dt.toISOString().slice(0, 10);
  }

  function getMondayISO(dateStr) {
    const ms = parseDateUTC(dateStr);
    if (ms === null) return dateStr;
    const dow = new Date(ms).getUTCDay();
    const offset = -((dow + 6) % 7);
    return shiftDateISO(dateStr, offset);
  }

  function formatWeekLabel(weekStart) {
    const monMs = parseDateUTC(weekStart);
    if (monMs === null) return weekStart || '-';
    const thurs = new Date(monMs + 3 * 86400000);
    const fri = new Date(monMs + 4 * 86400000);
    const mon = new Date(monMs);
    const thursMonth = thurs.getUTCMonth() + 1;
    const thursWeek = Math.ceil(thurs.getUTCDate() / 7);
    const mmdd = (dt) => `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`;
    return `${thursMonth}월 ${thursWeek}주차(${mmdd(mon)} ~ ${mmdd(fri)})`;
  }

  function formatDays(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `${Math.round(num * 10) / 10}일`;
  }

  function formatHours(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0시간';
    return `${Math.round(num * 10) / 10}시간`;
  }

  function formatMinutes(minutes) {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return '0분';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h === 0) return `${m}분`;
    if (m === 0) return `${h}시간`;
    return `${h}시간 ${m}분`;
  }

  function formatPeriod(startDate, endDate) {
    if (!startDate) return '-';
    if (!endDate || startDate === endDate) return startDate;
    return `${startDate} ~ ${endDate}`;
  }

  function formatIsoDate(isoStr) {
    if (!isoStr) return '-';
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 10);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDotDate(isoStr) {
    if (!isoStr) return '-';
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoStr));
      return m ? `${m[1]}. ${m[2]}. ${m[3]}.` : String(isoStr).slice(0, 10);
    }
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}. ${m}. ${d}.`;
  }

  function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr).slice(0, 16);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}. ${m}. ${d}. ${hh}:${mm}`;
  }

  const SVG_ICONS = {
    clock: [
      { tag: 'circle', cx: '12', cy: '12', r: '9' },
      { tag: 'polyline', points: '12 7 12 12 15.5 14' },
    ],
    check: [
      { tag: 'circle', cx: '12', cy: '12', r: '9' },
      { tag: 'polyline', points: '8.5 12.5 11 15 16 9.5' },
    ],
    x: [
      { tag: 'circle', cx: '12', cy: '12', r: '9' },
      { tag: 'line', x1: '15', y1: '9', x2: '9', y2: '15' },
      { tag: 'line', x1: '9', y1: '9', x2: '15', y2: '15' },
    ],
    calendar: [
      { tag: 'rect', x: '3', y: '4', width: '18', height: '18', rx: '2' },
      { tag: 'line', x1: '16', y1: '2', x2: '16', y2: '6' },
      { tag: 'line', x1: '8', y1: '2', x2: '8', y2: '6' },
      { tag: 'line', x1: '3', y1: '10', x2: '21', y2: '10' },
    ],
    book: [
      { tag: 'path', d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' },
      { tag: 'path', d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' },
    ],
    folder: [
      { tag: 'path', d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' },
    ],
    search: [
      { tag: 'circle', cx: '11', cy: '11', r: '8' },
      { tag: 'line', x1: '21', y1: '21', x2: '16.65', y2: '16.65' },
    ],
    plus: [
      { tag: 'line', x1: '12', y1: '5', x2: '12', y2: '19' },
      { tag: 'line', x1: '5', y1: '12', x2: '19', y2: '12' },
    ],
    edit: [
      { tag: 'path', d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' },
      { tag: 'path', d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' },
    ],
    upload: [
      { tag: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
      { tag: 'polyline', points: '17 8 12 3 7 8' },
      { tag: 'line', x1: '12', y1: '3', x2: '12', y2: '15' },
    ],
    download: [
      { tag: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
      { tag: 'polyline', points: '7 10 12 15 17 10' },
      { tag: 'line', x1: '12', y1: '15', x2: '12', y2: '3' },
    ],
    paperclip: [
      { tag: 'path', d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' },
    ],
    file: [
      { tag: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
      { tag: 'polyline', points: '14 2 14 8 20 8' },
      { tag: 'line', x1: '8', y1: '13', x2: '16', y2: '13' },
      { tag: 'line', x1: '8', y1: '17', x2: '13', y2: '17' },
    ],
    users: [
      { tag: 'path', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
      { tag: 'circle', cx: '9', cy: '7', r: '4' },
      { tag: 'path', d: 'M23 21v-2a4 4 0 0 0-3-3.87' },
      { tag: 'path', d: 'M16 3.13a4 4 0 0 1 0 7.75' },
    ],
  };

  function makeSvgIcon(name, { size = 18, className = '' } = {}) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);
    const shapes = SVG_ICONS[name] || SVG_ICONS.file;
    for (const shape of shapes) {
      const node = document.createElementNS(ns, shape.tag);
      for (const [k, v] of Object.entries(shape)) {
        if (k !== 'tag') node.setAttribute(k, String(v));
      }
      svg.appendChild(node);
    }
    return svg;
  }

  function buildStatCard({ label, count, unit = '건', valueText, hint, tone = 'indigo', icon = 'file', highlight = false }) {
    const valNode = count !== undefined
      ? el('div', { className: 'stat-value-row' }, [
        el('span', { className: 'stat-value', textContent: String(count) }),
        unit ? el('span', { className: 'stat-unit', textContent: unit }) : null,
      ])
      : el('div', { className: 'stat-value-row' }, [
        el('span', { className: 'stat-value', textContent: valueText || '-' }),
      ]);

    return el('div', { className: `stat-card${highlight ? ' stat-card-primary' : ''}` }, [
      el('div', { className: 'stat-card-top' }, [
        el('span', { className: `stat-icon-chip is-${tone}` }, [makeSvgIcon(icon, { size: 18 })]),
        el('span', { className: 'stat-label', textContent: label }),
      ]),
      valNode,
      hint ? el('div', { className: 'stat-hint', textContent: hint }) : null,
    ]);
  }

  function buildWeeklyDownloadLink(reportId, viewerId, { compact = false, label = '원본 다운로드' } = {}) {
    return el('a', {
      href: `/api/weekly-reports/${encodeURIComponent(reportId)}/file?viewerId=${encodeURIComponent(viewerId)}`,
      download: '',
      className: `btn ${compact ? 'btn-sm' : ''} btn-outline btn-icon-label`.trim(),
    }, [
      makeSvgIcon('download', { size: 15 }),
      el('span', { textContent: label }),
    ]);
  }

  async function uploadWeeklyReportFile(userId, file) {
    const url = `/api/weekly-reports/upload?userId=${encodeURIComponent(userId)}&fileName=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: file,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_err) {
        data = null;
      }
    }
    if (!response.ok) {
      const msg = (data && data.error) || `요청 처리 중 오류가 발생했습니다. (${response.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function formatWorkDateWithDay(dateStr) {
    const utcMs = parseDateUTC(dateStr);
    if (utcMs === null) return dateStr || '-';
    return `${dateStr} (${WEEKDAY_NAMES[new Date(utcMs).getUTCDay()]})`;
  }

  function makeBadge(text, className) {
    return el('span', { className, textContent: text });
  }

  function makeStatusBadge(status, customLabel) {
    const meta = STATUS_META[status] || { label: status || '-', className: 'badge badge-neutral' };
    return makeBadge(customLabel || meta.label, meta.className);
  }

  function calculatePreviewDays(type, startDateStr, endDateStr) {
    const startMs = parseDateUTC(startDateStr);
    if (type === 'half_am' || type === 'half_pm') {
      if (startMs === null) return { valid: false, text: '시작일을 선택하세요' };
      const dow = new Date(startMs).getUTCDay();
      if (dow === 0 || dow === 6) return { valid: false, text: '0일 (주말 선택 불가)' };
      return { valid: true, text: '0.5일 (반차)' };
    }
    if (startMs === null) return { valid: false, text: '시작일을 선택하세요' };
    const endMs = parseDateUTC(endDateStr);
    if (endMs === null) return { valid: false, text: '종료일을 선택하세요' };
    if (endMs < startMs) return { valid: false, text: '종료일이 시작일보다 빠릅니다' };

    let total = 0;
    let weekdays = 0;
    for (let cur = startMs; cur <= endMs; cur += 86400000) {
      total += 1;
      const dow = new Date(cur).getUTCDay();
      if (dow !== 0 && dow !== 6) weekdays += 1;
    }
    if (weekdays === 0) return { valid: false, text: '0일 (주말만 포함됨)' };
    if (total > weekdays) return { valid: true, text: `${weekdays}일 (주말 제외)` };
    return { valid: true, text: `${weekdays}일` };
  }

  function buildWeekNav(weekStart, weekLabel, onChange) {
    const currentWeekStart = getMondayISO(getLocalTodayISO());
    return el('div', { className: 'week-nav' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '< 이전 주',
        onClick: () => onChange(shiftDateISO(weekStart, -7)),
      }),
      el('span', { className: 'week-nav-label', textContent: weekLabel || formatWeekLabel(weekStart) }),
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '다음 주 >',
        onClick: () => onChange(shiftDateISO(weekStart, 7)),
      }),
      weekStart !== currentWeekStart
        ? el('button', {
          type: 'button',
          className: 'btn btn-sm btn-outline',
          textContent: '이번 주',
          onClick: () => onChange(currentWeekStart),
        })
        : null,
    ]);
  }

  /* ---------- API & Feedback ---------- */

  async function apiFetch(url, options = {}) {
    const fetchOptions = {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    };

    let response;
    try {
      response = await window.fetch(url, fetchOptions);
    } catch (_) {
      throw new Error('서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');
    }

    const rawText = await response.text();
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch (_) {
        payload = null;
      }
    }

    if (!response.ok) {
      const msg =
        payload && typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : `요청 처리에 실패했습니다. (HTTP ${response.status})`;
      const err = new Error(msg);
      err.status = response.status;
      throw err;
    }

    return payload;
  }

  function showToast(message) {
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    dom.toastText.textContent = message;
    setVisible(dom.toast, true);
    state.toastTimer = window.setTimeout(() => setVisible(dom.toast, false), 3500);
  }

  function showGlobalError(message) {
    dom.globalErrorText.textContent = message || '';
    setVisible(dom.globalError, Boolean(message));
  }

  function setInlineAlert(box, message) {
    box.textContent = message || '';
    setVisible(box, Boolean(message));
  }

  function openModal(title, contentNodes, opts = {}) {
    dom.modalTitle.textContent = title;
    dom.modalDialog.classList.toggle('modal-dialog-wide', Boolean(opts.wide));
    const nodes = Array.isArray(contentNodes) ? contentNodes : [contentNodes];
    dom.modalBody.replaceChildren(...nodes);
    setVisible(dom.modalBackdrop, true);
  }

  function closeModal() {
    setVisible(dom.modalBackdrop, false);
    dom.modalDialog.classList.remove('modal-dialog-wide');
    dom.modalBody.replaceChildren();
  }

  function updateNavApprovalsBadge(counts) {
    const isManager = state.currentUser && state.currentUser.role === 'manager';
    let leaveCount = 0;
    let weeklyCount = 0;
    let total = 0;
    if (counts && typeof counts === 'object') {
      leaveCount = Number(counts.leave) || 0;
      weeklyCount = Number(counts.weekly) || 0;
      total = leaveCount + weeklyCount;
    } else {
      total = Number(counts) || 0;
    }

    const applyBadge = (node, num) => {
      if (!node) return;
      if (!isManager || num <= 0) {
        node.textContent = '0';
        setVisible(node, false);
      } else {
        node.textContent = String(num);
        setVisible(node, true);
      }
    };

    applyBadge(dom.navApprovalsBadge, total);
    applyBadge(dom.navLeaveApprovalsBadge, leaveCount);
    applyBadge(dom.navWeeklyApprovalsBadge, weeklyCount);
  }

  async function syncNavBadgeFromServer(seq) {
    if (!state.currentUser || state.currentUser.role !== 'manager') {
      updateNavApprovalsBadge({ leave: 0, weekly: 0 });
      return;
    }
    try {
      const pendingList = await apiFetch(`/api/approvals?approverId=${encodeURIComponent(state.currentUser.id)}`);
      if (seq !== undefined && seq !== state.routeSeq) return;
      const list = Array.isArray(pendingList) ? pendingList : [];
      const leave = list.filter((x) => x.kind === 'leave').length;
      const weekly = list.filter((x) => x.kind === 'weekly').length;
      updateNavApprovalsBadge({ leave, weekly });
    } catch (_) {
      // Ignore background nav badge errors.
    }
  }

  /* ---------- Routing & Header ---------- */

  function allowedRoutesForUser(user) {
    return user && user.role === 'executive' ? EXEC_ROUTES : ALL_ROUTES;
  }

  function parseHashState() {
    const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
    const segments = raw ? raw.split('/').filter(Boolean) : [];
    const base = (segments[0] || '').toLowerCase();
    const allowed = allowedRoutesForUser(state.currentUser);
    const route = allowed.includes(base) ? base : 'home';

    let approvalKind = 'leave';
    if (route === 'approvals') {
      const sub = (segments[1] || '').toLowerCase();
      approvalKind = sub === 'weekly' ? 'weekly' : 'leave';
    }

    let docMode = 'view';
    let docId = null;
    if (route === 'docs') {
      const seg1 = segments[1] || '';
      const seg2 = (segments[2] || '').toLowerCase();
      if (seg1.toLowerCase() === 'new') {
        docMode = 'new';
      } else if (seg1) {
        docId = decodeURIComponent(seg1);
        docMode = seg2 === 'edit' ? 'edit' : 'view';
      }
    }

    return { route, approvalKind, docMode, docId };
  }

  function parseRouteFromHash() {
    return parseHashState().route;
  }

  function syncSidebarForUser(user) {
    const allowed = allowedRoutesForUser(user);
    if (dom.navApprovalGroup) {
      setVisible(dom.navApprovalGroup, allowed.includes('approvals'));
    }
    for (const link of dom.navLinks) {
      const route = link.dataset.route;
      const visible = allowed.includes(route);
      setVisible(link, visible);
      const active = visible && route === state.route && route !== 'approvals';
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }
    for (const sublink of dom.navSubLinks) {
      const route = sublink.dataset.route;
      const sub = sublink.dataset.subroute;
      const visible = allowed.includes(route);
      setVisible(sublink, visible);
      const active = visible && route === state.route && sub === state.approvalKind;
      sublink.classList.toggle('is-active', active);
      if (active) {
        sublink.setAttribute('aria-current', 'page');
      } else {
        sublink.removeAttribute('aria-current');
      }
    }
  }

  function renderHeaderForUser(user) {
    if (!user) {
      if (dom.userAvatar) dom.userAvatar.textContent = '-';
      if (dom.userDisplayName) dom.userDisplayName.textContent = '-';
      if (dom.userDisplayRole) dom.userDisplayRole.textContent = '-';
      setVisible(dom.roleBadge, false);
      updateNavApprovalsBadge({ leave: 0, weekly: 0 });
      syncSidebarForUser(null);
      return;
    }
    const roleInfo = ROLE_META[user.role] || {
      label: user.role,
      className: 'role-badge role-badge-employee',
    };
    if (dom.userAvatar) dom.userAvatar.textContent = (user.name || '?').slice(0, 1);
    if (dom.userDisplayName) dom.userDisplayName.textContent = user.name || '-';
    if (dom.userDisplayRole) dom.userDisplayRole.textContent = `${roleInfo.label} · ${user.team || '-'}`;
    dom.roleBadge.textContent = roleInfo.label;
    dom.roleBadge.className = `${roleInfo.className} sr-only`;
    setVisible(dom.roleBadge, false);
    if (user.role !== 'manager') updateNavApprovalsBadge({ leave: 0, weekly: 0 });
    syncSidebarForUser(user);
  }

  function renderLoadingState(text = '데이터를 불러오는 중입니다...') {
    dom.routeView.replaceChildren(el('div', { className: 'card state-box', textContent: text }));
  }

  /* ---------- Notices Modal ---------- */

  function buildNoticeComposeModal(onSuccess) {
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const titleInput = el('input', {
      type: 'text',
      className: 'form-control',
      placeholder: '공지 제목을 입력하세요',
    });
    const bodyInput = el('textarea', {
      className: 'form-control',
      rows: 4,
      placeholder: '공지 내용을 입력하세요',
    });
    const pinnedCheck = el('input', { type: 'checkbox' });
    const submitBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: '공지 등록' });

    const form = el('form', {
      className: 'form-stack',
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        setInlineAlert(errBox, '');
        submitBtn.disabled = true;
        submitBtn.textContent = '등록 중...';
        try {
          await apiFetch('/api/notices', {
            method: 'POST',
            body: JSON.stringify({
              userId: state.currentUser.id,
              title: titleInput.value.trim(),
              body: bodyInput.value.trim(),
              pinned: pinnedCheck.checked,
            }),
          });
          closeModal();
          showToast('공지사항이 등록되었습니다.');
          await onSuccess();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = '공지 등록';
        }
      },
    }, [
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '제목' }),
        titleInput,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '내용' }),
        bodyInput,
      ]),
      el('label', { className: 'checkbox-row' }, [
        pinnedCheck,
        el('span', { textContent: '상단 고정 공지로 등록' }),
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-outline',
          textContent: '취소',
          onClick: closeModal,
        }),
        submitBtn,
      ]),
    ]);

    openModal('공지사항 작성', form);
    titleInput.focus();
  }

  function noticeAttachments(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    return el('div', { className: 'notice-attachments' }, list.map((a) =>
      el('a', { className: 'notice-attachment', href: a.url, target: '_blank', rel: 'noopener' }, [
        el('span', { className: 'notice-clip' }, [makeSvgIcon('paperclip', { size: 13 })]),
        a.name,
      ])
    ));
  }

  async function openNoticeDetailModal(targetNoticeId) {
    openModal('공지사항', el('div', { className: 'state-box', textContent: '공지 내용을 불러오는 중입니다...' }));
    try {
      const notices = await apiFetch('/api/notices');
      const list = Array.isArray(notices) ? notices : [];
      if (targetNoticeId != null) {
        const notice = list.find((n) => n.id === targetNoticeId);
        if (!notice) {
          openModal('공지사항', el('div', { className: 'state-box', textContent: '해당 공지를 찾을 수 없습니다.' }));
          return;
        }
        openModal(notice.title, el('div', { className: 'stack-md' }, [
          el('div', { className: 'approval-summary-left' }, [
            notice.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
            el('span', {
              className: 'page-subtitle',
              textContent: `${notice.authorName || '관리자'} · ${formatIsoDate(notice.createdAt)}`,
            }),
          ]),
          el('div', { className: 'notice-full-body', textContent: notice.body || '' }),
          noticeAttachments(notice.attachments),
        ]));
        return;
      }

      if (list.length === 0) {
        openModal('전체 공지사항', el('div', { className: 'state-box', textContent: '등록된 공지사항이 없습니다.' }));
        return;
      }
      openModal('전체 공지사항', el('div', { className: 'stack-md' }, list.map((n) =>
        el('div', { className: 'approval-detail-box' }, [
          el('div', { className: 'approval-summary-left' }, [
            n.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
            el('strong', { textContent: n.title }),
            el('span', {
              className: 'notice-date',
              textContent: `${n.authorName || ''} · ${formatIsoDate(n.createdAt)}`,
            }),
          ]),
          el('div', { className: 'notice-full-body', textContent: n.body || '' }),
          noticeAttachments(n.attachments),
        ])
      )));
    } catch (err) {
      openModal('공지사항 오류', el('div', { className: 'alert alert-error', textContent: err.message }));
    }
  }

  function buildNoticesCard(notices, allowCompose) {
    const list = Array.isArray(notices) ? notices : [];
    return el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '공지사항' }),
        el('div', { className: 'approval-summary-left' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline',
            textContent: '전체 보기',
            onClick: () => openNoticeDetailModal(null),
          }),
          allowCompose
            ? el('button', {
              type: 'button',
              className: 'btn btn-sm btn-primary',
              textContent: '+ 공지 작성',
              onClick: () => buildNoticeComposeModal(() => renderCurrentRoute()),
            })
            : null,
        ]),
      ]),
      list.length === 0
        ? el('div', { className: 'state-box', textContent: '등록된 공지사항이 없습니다.' })
        : el('ul', { className: 'list-clean' }, list.map((n) =>
          el('li', {}, [
            el('button', {
              type: 'button',
              className: 'list-item-row notice-btn-item',
              onClick: () => openNoticeDetailModal(n.id),
            }, [
              el('div', { className: 'notice-title-wrap' }, [
                n.pinned ? makeBadge('고정', 'badge badge-pinned') : null,
                el('span', { className: 'notice-title-text', textContent: n.title }),
              ]),
              el('span', { className: 'notice-date', textContent: formatIsoDate(n.createdAt) }),
            ]),
          ])
        )),
    ]);
  }

  /* ---------- Screen 1: Home (#/home) ---------- */

  function buildExecutiveTeamCards(teams, onSelectTeam) {
    const list = Array.isArray(teams) ? teams : [];
    if (list.length === 0) {
      return el('div', { className: 'card state-box', textContent: '조회할 팀 주간보고 데이터가 없습니다.' });
    }

    return el('div', { className: 'exec-team-grid' }, list.map((team) => {
      const stats = team.stats || { memberCount: 0, submittedCount: 0, approvedCount: 0, totalHours: 0 };
      const pct = stats.memberCount > 0 ? Math.round((stats.submittedCount / stats.memberCount) * 100) : 0;
      const topProjects = Array.isArray(team.projectHours) ? team.projectHours.slice(0, 3) : [];
      const issuesCount = Array.isArray(team.issues) ? team.issues.length : 0;
      const requestsCount = Array.isArray(team.requests) ? team.requests.length : 0;

      const fill = el('div', { className: 'exec-progress-fill' });
      fill.style.width = `${pct}%`;

      return el('article', { className: 'card card-clickable exec-team-card' }, [
        el('div', { className: 'card-header' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('h3', { className: 'card-title', textContent: team.team }),
            makeBadge(`팀장: ${team.managerName || '-'}`, 'badge badge-neutral'),
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline',
            textContent: '팀 상세 보기 →',
            onClick: () => onSelectTeam(team.team),
          }),
        ]),
        el('div', { className: 'stack-sm' }, [
          el('div', { className: 'bar-label-row' }, [
            el('span', { textContent: `제출률 ${pct}% (${stats.submittedCount}/${stats.memberCount}명 · 승인 ${stats.approvedCount}명)` }),
            el('span', { textContent: `총 ${formatHours(stats.totalHours)}` }),
          ]),
          el('div', { className: 'exec-progress-track' }, [fill]),
        ]),
        el('div', { className: 'exec-chip-row' }, [
          ...(topProjects.length > 0
            ? topProjects.map((p) => makeBadge(`${p.category || '미지정'} ${formatHours(p.hours)}`, 'badge badge-submitted'))
            : [makeBadge('집계된 프로젝트 시간 없음', 'badge badge-none')]),
          makeBadge(`이슈 ${issuesCount}건`, issuesCount > 0 ? 'badge badge-pending' : 'badge badge-neutral'),
          makeBadge(`요청 ${requestsCount}건`, requestsCount > 0 ? 'badge badge-working' : 'badge badge-neutral'),
        ]),
        el('div', {
          className: 'exec-summary-box',
          textContent: team.teamSummary?.summary
            ? `팀장 종합 의견: ${team.teamSummary.summary}`
            : '등록된 팀장 종합 의견이 없습니다.',
        }),
      ]);
    }));
  }

  function buildMyMeetingsCard(reservations) {
    const list = Array.isArray(reservations) ? reservations : [];
    return el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '오늘 내 회의' }),
        el('a', { href: '#/rooms', className: 'card-link', textContent: '회의실 예약 →' }),
      ]),
      list.length === 0
        ? el('div', { className: 'state-box stack-sm' }, [
          el('div', { textContent: '오늘 예정된 회의가 없습니다.' }),
          el('div', {}, [
            el('a', { href: '#/rooms', className: 'btn btn-sm btn-outline', textContent: '회의실 예약하기 →' }),
          ]),
        ])
        : el('ul', { className: 'list-clean' }, list.map((m) =>
          el('li', { className: 'list-item-row' }, [
            el('div', { className: 'approval-summary-left' }, [
              el('span', { className: 'meeting-time-pill', textContent: `${m.startTime}~${m.endTime}` }),
              el('strong', { textContent: m.title }),
            ]),
            makeBadge(m.roomName, 'badge badge-neutral'),
          ])
        )),
    ]);
  }

  async function renderExecutiveHomeRoute(seq) {
    const user = state.currentUser;
    const weekQuery = state.execWeekStart ? `&weekStart=${encodeURIComponent(state.execWeekStart)}` : '';
    const [home, execData] = await Promise.all([
      apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/executive/weekly?executiveId=${encodeURIComponent(user.id)}${weekQuery}`),
    ]);
    if (seq !== state.routeSeq) return;

    state.execWeekStart = execData.weekStart;
    updateNavApprovalsBadge(0);

    const weekNav = buildWeekNav(execData.weekStart, execData.weekLabel, async (nextWeek) => {
      state.execWeekStart = nextWeek;
      await renderCurrentRoute();
    });

    const teamGrid = buildExecutiveTeamCards(execData.teams, (teamName) => {
      state.execSelectedTeam = teamName;
      state.execWeekStart = execData.weekStart;
      window.location.hash = '#/weekly';
    });

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '임원 대시보드' }),
            el('p', { className: 'page-subtitle', textContent: `${home.today} · ${user.name} (${user.team})` }),
          ]),
          weekNav,
        ]),
        el('div', { className: 'stack-md' }, [
          el('div', { className: 'page-header' }, [
            el('h3', { className: 'card-title', textContent: '팀별 주간보고 요약' }),
            el('a', { href: '#/weekly', className: 'card-link', textContent: '주간보고 전체 보기 →' }),
          ]),
          teamGrid,
        ]),
        el('div', { className: 'home-grid' }, [
          buildMyMeetingsCard(home.myReservationsToday),
          buildNoticesCard(home.notices, false),
        ]),
      ])
    );
  }

  async function renderHomeRoute(seq) {
    const user = state.currentUser;
    if (user.role === 'executive') {
      await renderExecutiveHomeRoute(seq);
      return;
    }

    const isManager = user.role === 'manager';
    const [home, pendingApprovals, historyApprovals] = await Promise.all([
      apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`),
      isManager ? apiFetch(`/api/approvals?approverId=${encodeURIComponent(user.id)}`) : Promise.resolve([]),
      isManager ? apiFetch(`/api/approvals/history?approverId=${encodeURIComponent(user.id)}`) : Promise.resolve([]),
    ]);
    if (seq !== state.routeSeq) return;

    updateNavApprovalsBadge(home.approvalPendingCount);

    const att = home.attendance || { status: 'none', checkIn: null, checkOut: null, late: false };
    const attErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const attStatusText = ATTENDANCE_STATUS_LABELS[att.status] || att.status;

    const handleHomeAttendance = async (action, btn) => {
      setInlineAlert(attErrBox, '');
      btn.disabled = true;
      try {
        await apiFetch(`/api/attendance/${action}`, {
          method: 'POST',
          body: JSON.stringify({ userId: user.id }),
        });
        showToast(action === 'check-in' ? '출근이 기록되었습니다.' : '퇴근이 기록되었습니다.');
        await renderCurrentRoute();
      } catch (err) {
        setInlineAlert(attErrBox, err.message);
        btn.disabled = false;
      }
    };

    const attActionEl = att.status === 'none'
      ? el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '출근하기',
        onClick: (e) => handleHomeAttendance('check-in', e.currentTarget),
      })
      : att.status === 'working'
        ? el('button', {
          type: 'button',
          className: 'btn btn-approve',
          textContent: '퇴근하기',
          onClick: (e) => handleHomeAttendance('check-out', e.currentTarget),
        })
        : makeBadge('오늘 근무 완료', 'badge badge-done');

    const attCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '오늘 출퇴근' }),
        el('a', { href: '#/attendance', className: 'card-link', textContent: '상세 보기 →' }),
      ]),
      el('div', { className: 'home-att-row' }, [
        el('div', { className: 'approval-summary-left' }, [
          makeStatusBadge(att.status, attStatusText),
          att.status !== 'none'
            ? makeBadge(att.late ? '지각' : '정상 출근', att.late ? 'badge badge-late' : 'badge badge-normal')
            : null,
        ]),
        attActionEl,
      ]),
      el('div', { className: 'home-att-times' }, [
        el('span', {}, ['출근 ', el('strong', { textContent: att.checkIn || '-' })]),
        el('span', {}, ['퇴근 ', el('strong', { textContent: att.checkOut || '-' })]),
      ]),
      attErrBox,
    ]);

    const bal = home.balance || { total: 0, used: 0, pending: 0, remaining: 0 };
    const leaveCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '잔여 연차' }),
        el('a', { href: '#/leave', className: 'card-link', textContent: '신청 · 내역 →' }),
      ]),
      el('div', { className: 'kpi-value kpi-value-primary', textContent: formatDays(bal.remaining) }),
      el('div', {
        className: 'kpi-meta',
        textContent: `대기 ${formatDays(bal.pending)} · 사용 ${formatDays(bal.used)} / 총 ${formatDays(bal.total)}`,
      }),
    ]);

    const approvalsCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: isManager ? '결재 대기' : '내 결재 현황' }),
        el('a', { href: '#/approvals/leave', className: 'card-link', textContent: '결재 관리 →' }),
      ]),
      el('div', {
        className: `kpi-value${isManager && home.approvalPendingCount > 0 ? ' kpi-value-primary' : ''}`,
        textContent: isManager ? `${home.approvalPendingCount}건` : `${home.myPendingCount}건`,
      }),
      el('div', {
        className: 'kpi-meta',
        textContent: isManager
          ? `팀 결재 대기 ${home.approvalPendingCount}건 · 내가 올린 대기 ${home.myPendingCount}건`
          : '내가 올린 연차 · 주간보고 결재 대기 건수',
      }),
    ]);

    const wr = home.weeklyReport || { weekStart: '-', status: 'none' };
    const wrEditable = !isManager && (wr.status === 'none' || wr.status === 'draft' || wr.status === 'rejected');
    const weeklyCard = el('section', { className: 'card card-clickable' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: isManager ? '팀 주간보고 종합' : '이번 주 주간보고' }),
        el('a', {
          href: '#/weekly',
          className: 'card-link',
          textContent: isManager ? '팀 종합 보기 →' : (wrEditable ? '엑셀 업로드 →' : '확인하기 →'),
        }),
      ]),
      isManager
        ? el('div', {
          className: 'kpi-meta',
          textContent: `${user.team} 팀원 주간보고 현황 및 팀 종합 의견을 관리합니다.`,
        })
        : el('div', { className: 'stack-sm' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('strong', { textContent: formatWeekLabel(wr.weekStart) }),
            makeStatusBadge(wr.status),
          ]),
          el('div', {
            className: 'kpi-meta',
            textContent: wr.status === 'rejected'
              ? '반려된 보고서입니다. 보완한 엑셀(.xlsx) 파일을 다시 업로드해 주세요.'
              : wr.status === 'none'
                ? '사내 주간보고 엑셀(.xlsx) 파일을 업로드해 제출하세요.'
                : '주간보고 화면에서 업로드된 양식과 원본 파일을 확인할 수 있습니다.',
          }),
        ]),
    ]);

    const absentList = Array.isArray(home.teamOnLeaveToday) ? home.teamOnLeaveToday : [];
    const absentCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '오늘 팀 부재자' }),
        el('a', { href: '#/leave', className: 'card-link', textContent: '팀 캘린더 →' }),
      ]),
      absentList.length === 0
        ? el('div', { className: 'state-box', textContent: '오늘 부재 중인 팀원이 없습니다.' })
        : el('ul', { className: 'list-clean' }, absentList.map((item) =>
          el('li', { className: 'list-item-row' }, [
            el('strong', { textContent: item.userName }),
            makeBadge(LEAVE_TYPE_LABELS[item.type] || item.type, 'badge badge-pending'),
          ])
        )),
    ]);

    let managerSummarySection = null;
    if (isManager) {
      const pendingItems = Array.isArray(pendingApprovals) ? pendingApprovals : [];
      const historyItems = Array.isArray(historyApprovals) ? historyApprovals : [];
      const leavePendingCount = pendingItems.filter((x) => x.kind === 'leave').length;
      const weeklyPendingCount = pendingItems.filter((x) => x.kind === 'weekly').length;
      updateNavApprovalsBadge({ leave: leavePendingCount, weekly: weeklyPendingCount });

      const approvedCount = historyItems.filter((x) => x.status === 'approved').length;
      const rejectedCount = historyItems.filter((x) => x.status === 'rejected').length;
      const recentItems = [...pendingItems, ...historyItems].slice(0, 5);
      const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

      const leavePendingCard = el('a', { href: '#/approvals/leave', className: 'card-clickable', style: 'display:block;border-radius:12px;' }, [
        buildStatCard({
          label: '연차 결재 대기',
          count: leavePendingCount,
          tone: 'amber',
          icon: 'calendar',
          hint: '연차 · 반차 승인 대기 (클릭 시 이동)',
        }),
      ]);
      const weeklyPendingCard = el('a', { href: '#/approvals/weekly', className: 'card-clickable', style: 'display:block;border-radius:12px;' }, [
        buildStatCard({
          label: '주간보고 결재 대기',
          count: weeklyPendingCount,
          tone: 'indigo',
          icon: 'file',
          hint: '주간보고 승인 대기 (클릭 시 이동)',
        }),
      ]);

      managerSummarySection = el('div', { className: 'stack-md' }, [
        el('div', { className: 'stats-grid-4' }, [
          leavePendingCard,
          weeklyPendingCard,
          buildStatCard({
            label: '승인 완료',
            count: approvedCount,
            tone: 'green',
            icon: 'check',
            hint: '연차 · 주간보고 승인 건수',
          }),
          buildStatCard({
            label: '반려',
            count: rejectedCount,
            tone: 'red',
            icon: 'x',
            hint: '보완 요청 및 반려 건수',
          }),
        ]),
        el('section', { className: 'card stack-md' }, [
          el('div', { className: 'card-header' }, [
            el('h3', { className: 'card-title', textContent: '최근 결재 요청' }),
            el('div', { className: 'table-actions' }, [
              el('a', { href: '#/approvals/leave', className: 'btn btn-sm btn-outline', textContent: '연차 결재 보기' }),
              el('a', { href: '#/approvals/weekly', className: 'btn btn-sm btn-outline', textContent: '주간보고 결재 보기' }),
            ]),
          ]),
          errBox,
          recentItems.length === 0
            ? el('div', { className: 'state-box', textContent: '접수된 결재 요청이 없습니다.' })
            : buildApprovalsTable(recentItems, {
              tableKind: 'recent',
              showInlineActions: false,
              onAfterAction: () => renderCurrentRoute(),
              errBox,
            }),
        ]),
      ]);
    }

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '대시보드' }),
            el('p', {
              className: 'page-subtitle',
              textContent: `${home.today} · ${user.name} (${user.team})`,
            }),
          ]),
        ]),
        managerSummarySection,
        el('div', { className: 'home-grid' }, [
          attCard,
          leaveCard,
          isManager ? null : approvalsCard,
          weeklyCard,
          buildMyMeetingsCard(home.myReservationsToday),
          absentCard,
          buildNoticesCard(home.notices, isManager),
        ]),
      ])
    );
  }

  /* ---------- Screen 2: Attendance (#/attendance) ---------- */

  async function renderAttendanceRoute(seq) {
    const user = state.currentUser;
    if (!state.attendanceMonth) state.attendanceMonth = getLocalMonthISO();
    const isManager = user.role === 'manager';

    const [home, monthly, teamRows] = await Promise.all([
      apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/attendance?userId=${encodeURIComponent(user.id)}&month=${encodeURIComponent(state.attendanceMonth)}`),
      isManager
        ? apiFetch(`/api/attendance/team?managerId=${encodeURIComponent(user.id)}`)
        : Promise.resolve([]),
    ]);
    if (seq !== state.routeSeq) return;

    updateNavApprovalsBadge(home.approvalPendingCount);

    const att = home.attendance || { status: 'none', checkIn: null, checkOut: null, late: false };
    const todayErr = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    const doAttendance = async (action, btn) => {
      setInlineAlert(todayErr, '');
      btn.disabled = true;
      try {
        await apiFetch(`/api/attendance/${action}`, {
          method: 'POST',
          body: JSON.stringify({ userId: user.id }),
        });
        showToast(action === 'check-in' ? '출근이 기록되었습니다.' : '퇴근이 기록되었습니다.');
        await renderCurrentRoute();
      } catch (err) {
        setInlineAlert(todayErr, err.message);
        btn.disabled = false;
      }
    };

    const todayAction = att.status === 'none'
      ? el('button', {
        type: 'button',
        className: 'btn btn-primary',
        textContent: '출근하기',
        onClick: (e) => doAttendance('check-in', e.currentTarget),
      })
      : att.status === 'working'
        ? el('button', {
          type: 'button',
          className: 'btn btn-approve',
          textContent: '퇴근하기',
          onClick: (e) => doAttendance('check-out', e.currentTarget),
        })
        : makeBadge('오늘 근무 완료', 'badge badge-done');

    const todayCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: `오늘 출퇴근 (${home.today})` }),
        el('span', { className: 'page-subtitle', textContent: '지각 기준 09:00' }),
      ]),
      el('div', { className: 'home-att-row' }, [
        el('div', { className: 'approval-summary-left' }, [
          makeStatusBadge(att.status, ATTENDANCE_STATUS_LABELS[att.status] || att.status),
          att.status !== 'none'
            ? makeBadge(att.late ? '지각' : '정상 출근', att.late ? 'badge badge-late' : 'badge badge-normal')
            : null,
          el('span', { className: 'page-subtitle', textContent: `출근: ${att.checkIn || '-'} / 퇴근: ${att.checkOut || '-'}` }),
        ]),
        todayAction,
      ]),
      todayErr,
    ]);

    const teamCard = isManager
      ? el('section', { className: 'card' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: `오늘 팀 근태 현황 (${user.team})` }),
          makeBadge(`${teamRows.length}명`, 'badge badge-neutral'),
        ]),
        teamRows.length === 0
          ? el('div', { className: 'state-box', textContent: '팀원 근태 정보가 없습니다.' })
          : el('div', { className: 'table-wrap' }, [
            el('table', { className: 'data-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { scope: 'col', textContent: '이름' }),
                  el('th', { scope: 'col', textContent: '상태' }),
                  el('th', { scope: 'col', textContent: '출근 시각' }),
                  el('th', { scope: 'col', textContent: '퇴근 시각' }),
                  el('th', { scope: 'col', textContent: '지각 여부' }),
                ]),
              ]),
              el('tbody', {}, teamRows.map((m) => {
                const leaveLabel = typeof m.onLeave === 'string'
                  ? (LEAVE_TYPE_LABELS[m.onLeave] || '휴가')
                  : '휴가';
                return el('tr', {}, [
                  el('td', {}, [el('strong', { textContent: m.userName })]),
                  el('td', {}, [
                    el('div', { className: 'approval-summary-left' }, [
                      makeStatusBadge(m.status, ATTENDANCE_STATUS_LABELS[m.status] || m.status),
                      m.onLeave ? makeBadge(`휴가 (${leaveLabel})`, 'badge badge-pending') : null,
                    ]),
                  ]),
                  el('td', { textContent: m.checkIn || '-' }),
                  el('td', { textContent: m.checkOut || '-' }),
                  el('td', {}, [
                    m.status === 'none'
                      ? el('span', { textContent: '-' })
                      : makeBadge(m.late ? '지각' : '정상', m.late ? 'badge badge-late' : 'badge badge-normal'),
                  ]),
                ]);
              })),
            ]),
          ]),
      ])
      : null;

    const summary = monthly.summary || { days: 0, totalMinutes: 0, lateCount: 0 };
    const records = Array.isArray(monthly.records) ? monthly.records : [];

    const monthInput = el('input', {
      type: 'month',
      className: 'form-control',
      value: state.attendanceMonth,
      'aria-label': '조회 월 선택',
      onChange: async (e) => {
        if (!e.target.value) return;
        state.attendanceMonth = e.target.value;
        await renderCurrentRoute();
      },
    });
    monthInput.style.width = 'auto';

    const monthlyCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '월별 근태 기록 및 합계' }),
        monthInput,
      ]),
      el('div', { className: 'stats-grid-3' }, [
        el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-label', textContent: '출근 일수' }),
          el('div', { className: 'stat-value', textContent: `${summary.days}일` }),
        ]),
        el('div', { className: 'stat-card stat-card-primary' }, [
          el('div', { className: 'stat-label', textContent: '총 근무 시간' }),
          el('div', { className: 'stat-value', textContent: formatMinutes(summary.totalMinutes) }),
        ]),
        el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-label', textContent: '지각 횟수' }),
          el('div', { className: 'stat-value', textContent: `${summary.lateCount}회` }),
        ]),
      ]),
      records.length === 0
        ? el('div', { className: 'state-box', textContent: '선택한 월의 출퇴근 기록이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col', textContent: '근무일' }),
                el('th', { scope: 'col', textContent: '출근 시각' }),
                el('th', { scope: 'col', textContent: '퇴근 시각' }),
                el('th', { scope: 'col', textContent: '근무 시간' }),
                el('th', { scope: 'col', textContent: '지각' }),
              ]),
            ]),
            el('tbody', {}, records.map((rec) =>
              el('tr', {}, [
                el('td', { textContent: formatWorkDateWithDay(rec.workDate) }),
                el('td', { textContent: rec.checkIn || '-' }),
                el('td', { textContent: rec.checkOut || '-' }),
                el('td', { textContent: rec.checkOut ? formatMinutes(rec.workMinutes) : '-' }),
                el('td', {}, [
                  makeBadge(rec.late ? '지각' : '정상', rec.late ? 'badge badge-late' : 'badge badge-normal'),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '출퇴근 관리' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team}` }),
          ]),
        ]),
        todayCard,
        teamCard,
        monthlyCard,
      ])
    );
  }

  /* ---------- Screen 3: Weekly Report (Excel Form Component) ---------- */

  function cloneWeekPart(part) {
    const src = part || {};
    return {
      personalSchedule: typeof src.personalSchedule === 'string' ? src.personalSchedule : '',
      issues: typeof src.issues === 'string' ? src.issues : '',
      requests: typeof src.requests === 'string' ? src.requests : '',
      entries: Array.isArray(src.entries)
        ? src.entries.map((e) => ({
          day: DAYS.some((d) => d.key === e.day) ? e.day : 'mon',
          category: typeof e.category === 'string' ? e.category : '',
          workType: WORK_TYPES.includes(e.workType) ? e.workType : '회사',
          content: typeof e.content === 'string' ? e.content : '',
          hours: e.hours !== undefined && e.hours !== null ? String(e.hours) : '',
        }))
        : [],
    };
  }

  function sumEntriesHours(entries, dayKey = null) {
    return entries.reduce((sum, e) => {
      if (dayKey && e.day !== dayKey) return sum;
      const num = Number(e.hours);
      return sum + (Number.isFinite(num) && num > 0 ? num : 0);
    }, 0);
  }

  function serializeWeekPart(part) {
    const entries = [];
    for (const e of part.entries) {
      const category = e.category.trim();
      const content = e.content.trim();
      const rawHours = String(e.hours ?? '').trim();
      if (!category && !content && !rawHours) continue;
      entries.push({
        day: e.day,
        category,
        workType: e.workType,
        content,
        hours: rawHours === '' ? 0 : Number(rawHours),
      });
    }
    return {
      personalSchedule: part.personalSchedule.trim(),
      issues: part.issues.trim(),
      requests: part.requests.trim(),
      entries,
    };
  }

  function buildExcelWeeklyForm(report, { editable = false, onSaveSuccess = null } = {}) {
    const draft = {
      current: cloneWeekPart(report.current),
      next: cloneWeekPart(report.next),
    };
    const weekStart = report.weekStart;
    const curLabel = report.weekLabel || formatWeekLabel(weekStart);
    const nextLabel = report.nextWeekLabel || formatWeekLabel(shiftDateISO(weekStart, 7));

    let activeMobileSide = 'current';
    const narrowMq = window.matchMedia('(max-width: 1100px)');

    const container = el('div', { className: 'stack-md' });
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const tableWrap = el('div', { className: 'excel-table-wrap' });
    const table = el('table', { className: 'excel-table' });
    tableWrap.appendChild(table);

    const curTotalSpan = el('span', { textContent: formatHours(sumEntriesHours(draft.current.entries)) });
    const nextTotalSpan = el('span', { textContent: formatHours(sumEntriesHours(draft.next.entries)) });
    const dayHourSpans = { current: {}, next: {}, merged: {} };
    DAYS.forEach((d) => {
      dayHourSpans.current[d.key] = el('span');
      dayHourSpans.next[d.key] = el('span');
      dayHourSpans.merged[d.key] = el('div', { className: 'excel-day-hours' });
    });

    const refreshAllTotals = () => {
      const curTotal = sumEntriesHours(draft.current.entries);
      const nextTotal = sumEntriesHours(draft.next.entries);
      curTotalSpan.textContent = formatHours(curTotal);
      nextTotalSpan.textContent = formatHours(nextTotal);
      DAYS.forEach((d) => {
        const cH = sumEntriesHours(draft.current.entries, d.key);
        const nH = sumEntriesHours(draft.next.entries, d.key);
        dayHourSpans.current[d.key].textContent = `일 합계 ${formatHours(cH)}`;
        dayHourSpans.next[d.key].textContent = `일 합계 ${formatHours(nH)}`;
        dayHourSpans.merged[d.key].textContent = `${cH}h / ${nH}h`;
      });
    };

    const tabCurBtn = el('button', { type: 'button', className: 'subtab-btn is-active', textContent: `금주 실적 (${curLabel})` });
    const tabNextBtn = el('button', { type: 'button', className: 'subtab-btn', textContent: `차주 계획 (${nextLabel})` });
    const mobileTabs = el('div', { className: 'subtabs excel-mobile-tabs' }, [tabCurBtn, tabNextBtn]);

    const renderEntryCells = (sideKey, entry) => {
      if (!editable) {
        return [
          el('td', {}, [el('div', { className: 'excel-readonly-text', textContent: entry.category || '-' })]),
          el('td', { style: 'text-align:center;' }, [makeBadge(entry.workType || '-', 'badge badge-neutral')]),
          el('td', {}, [el('div', { className: 'excel-readonly-text', textContent: entry.content || '-' })]),
          el('td', { style: 'text-align:right;font-weight:700;' }, [formatHours(entry.hours)]),
        ];
      }

      const catInput = el('input', {
        type: 'text',
        className: 'excel-input',
        placeholder: '프로젝트명',
        value: entry.category,
        onInput: (e) => { entry.category = e.target.value; },
      });

      const typeSelect = el('select', {
        className: 'excel-input',
        onChange: (e) => { entry.workType = e.target.value; },
      }, WORK_TYPES.map((wt) => el('option', { value: wt, textContent: wt })));
      typeSelect.value = entry.workType;

      const contentArea = el('textarea', {
        className: 'excel-input excel-textarea',
        rows: 2,
        placeholder: '업무 내용 (여러 줄 입력 가능)',
        onInput: (e) => { entry.content = e.target.value; },
      });
      contentArea.value = entry.content;

      const hoursInput = el('input', {
        type: 'number',
        className: 'excel-input excel-hours-input',
        min: '0.5',
        max: '24',
        step: '0.5',
        placeholder: '0',
        value: entry.hours,
        onInput: (e) => {
          entry.hours = e.target.value;
          refreshAllTotals();
        },
      });

      const delBtn = el('button', {
        type: 'button',
        className: 'excel-del-btn',
        title: '행 삭제',
        textContent: '×',
        onClick: () => {
          const list = draft[sideKey].entries;
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
          renderTable();
        },
      });

      return [
        el('td', {}, [catInput]),
        el('td', {}, [typeSelect]),
        el('td', {}, [contentArea]),
        el('td', {}, [el('div', { className: 'excel-hours-wrap' }, [hoursInput, delBtn])]),
      ];
    };

    const renderMetaCells = (sideKey, fieldKey, placeholder) => {
      if (!editable) {
        return el('td', { colspan: '4' }, [
          el('div', { className: 'excel-readonly-text', textContent: draft[sideKey][fieldKey] || '-' }),
        ]);
      }
      const area = el('textarea', {
        className: 'excel-input excel-textarea',
        rows: 2,
        placeholder,
        onInput: (e) => { draft[sideKey][fieldKey] = e.target.value; },
      });
      area.value = draft[sideKey][fieldKey];
      return el('td', { colspan: '4' }, [area]);
    };

    const renderTable = () => {
      const isNarrow = narrowMq.matches;
      const showCur = !isNarrow || activeMobileSide === 'current';
      const showNext = !isNarrow || activeMobileSide === 'next';

      table.classList.toggle('is-narrow-mode', isNarrow);
      tabCurBtn.classList.toggle('is-active', activeMobileSide === 'current');
      tabNextBtn.classList.toggle('is-active', activeMobileSide === 'next');

      const colgroup = el('colgroup', {}, [
        el('col', { style: 'width: 78px;' }),
        ...(showCur ? [
          el('col', { style: 'width: 112px;' }),
          el('col', { style: 'width: 82px;' }),
          el('col'),
          el('col', { style: 'width: 102px;' }),
        ] : []),
        ...(showNext ? [
          el('col', { style: 'width: 112px;' }),
          el('col', { style: 'width: 82px;' }),
          el('col'),
          el('col', { style: 'width: 102px;' }),
        ] : []),
      ]);

      const thead = el('thead', {}, [
        el('tr', {}, [
          el('th', { rowspan: '2', className: 'excel-corner-head', textContent: '구분' }),
          showCur ? el('th', { colspan: '4', className: 'excel-top-week-cur', textContent: `금주 실적 · ${curLabel}` }) : null,
          showNext ? el('th', { colspan: '4', className: 'excel-top-week-next', textContent: `차주 계획 · ${nextLabel}` }) : null,
        ]),
        el('tr', {}, [
          ...(showCur ? [
            el('th', { className: 'excel-col-head', textContent: '구분' }),
            el('th', { className: 'excel-col-head', textContent: '형태' }),
            el('th', { className: 'excel-col-head', textContent: '진행 계획(내용)' }),
            el('th', { className: 'excel-col-head', textContent: '예상 소요시간' }),
          ] : []),
          ...(showNext ? [
            el('th', { className: 'excel-col-head', textContent: '구분' }),
            el('th', { className: 'excel-col-head', textContent: '형태' }),
            el('th', { className: 'excel-col-head', textContent: '진행 계획' }),
            el('th', { className: 'excel-col-head', textContent: '예상 소요시간' }),
          ] : []),
        ]),
      ]);

      const tbody = el('tbody');

      const metaRows = [
        ['personalSchedule', '개인일정', '휴가·외출·개인일정 (없으면 없음 또는 비움)'],
        ['issues', '이슈사항', '업무 이슈나 지연 사항을 입력하세요'],
        ['requests', '요청/전달', '팀장·팀원에게 요청 또는 전달할 사항'],
      ];
      for (const [key, label, ph] of metaRows) {
        tbody.appendChild(el('tr', {}, [
          el('th', { scope: 'row', className: 'excel-meta-label', textContent: label }),
          showCur ? renderMetaCells('current', key, ph) : null,
          showNext ? renderMetaCells('next', key, ph) : null,
        ]));
      }

      for (const d of DAYS) {
        const curList = draft.current.entries.filter((e) => e.day === d.key);
        const nextList = draft.next.entries.filter((e) => e.day === d.key);
        const dataRows = Math.max(showCur ? curList.length : 0, showNext ? nextList.length : 0, 1);
        const totalDayRows = dataRows + (editable ? 1 : 0);

        for (let i = 0; i < dataRows; i++) {
          const tr = el('tr');
          if (i === 0) {
            tr.appendChild(el('th', {
              scope: 'rowgroup',
              rowspan: String(totalDayRows),
              className: 'excel-day-cell',
            }, [
              el('div', { className: 'excel-day-name', textContent: d.label }),
              dayHourSpans.merged[d.key],
            ]));
          }

          if (showCur) {
            if (i < curList.length) {
              renderEntryCells('current', curList[i]).forEach((td) => tr.appendChild(td));
            } else {
              tr.appendChild(el('td', {
                colspan: '4',
                className: 'excel-filler-cell',
                textContent: i === 0 && curList.length === 0 ? '등록된 항목 없음' : '',
              }));
            }
          }

          if (showNext) {
            if (i < nextList.length) {
              renderEntryCells('next', nextList[i]).forEach((td) => tr.appendChild(td));
            } else {
              tr.appendChild(el('td', {
                colspan: '4',
                className: 'excel-filler-cell',
                textContent: i === 0 && nextList.length === 0 ? '등록된 항목 없음' : '',
              }));
            }
          }

          tbody.appendChild(tr);
        }

        if (editable) {
          const addRowBtn = (sideKey) => el('button', {
            type: 'button',
            className: 'btn btn-xs btn-outline',
            textContent: `+ ${d.label}요일 추가`,
            onClick: () => {
              draft[sideKey].entries.push({
                day: d.key,
                category: '',
                workType: '회사',
                content: '',
                hours: '',
              });
              renderTable();
            },
          });

          tbody.appendChild(el('tr', { className: 'excel-day-footer' }, [
            showCur ? el('td', { colspan: '4' }, [
              el('div', { className: 'excel-day-footer-inner' }, [
                addRowBtn('current'),
                dayHourSpans.current[d.key],
              ]),
            ]) : null,
            showNext ? el('td', { colspan: '4' }, [
              el('div', { className: 'excel-day-footer-inner' }, [
                addRowBtn('next'),
                dayHourSpans.next[d.key],
              ]),
            ]) : null,
          ]));
        }
      }

      tbody.appendChild(el('tr', { className: 'excel-total-row' }, [
        el('th', { scope: 'row', className: 'excel-meta-label', textContent: '합계' }),
        ...(showCur ? [
          el('td', { colspan: '3', textContent: '금주 총 투입 시간' }),
          el('td', { className: 'excel-total-val' }, [curTotalSpan]),
        ] : []),
        ...(showNext ? [
          el('td', { colspan: '3', textContent: '차주 예상 시간' }),
          el('td', { className: 'excel-total-val' }, [nextTotalSpan]),
        ] : []),
      ]));

      table.replaceChildren(colgroup, thead, tbody);
      refreshAllTotals();
    };

    tabCurBtn.addEventListener('click', () => {
      activeMobileSide = 'current';
      renderTable();
    });
    tabNextBtn.addEventListener('click', () => {
      activeMobileSide = 'next';
      renderTable();
    });

    const onMediaChange = () => {
      if (!table.isConnected) {
        narrowMq.removeEventListener('change', onMediaChange);
        return;
      }
      renderTable();
    };
    narrowMq.addEventListener('change', onMediaChange);

    renderTable();
    container.append(mobileTabs, tableWrap, errBox);

    if (editable) {
      const draftBtn = el('button', { type: 'button', className: 'btn btn-outline', textContent: '임시저장' });
      const submitBtn = el('button', { type: 'button', className: 'btn btn-primary', textContent: '제출하기' });

      const save = async (submit) => {
        setInlineAlert(errBox, '');
        draftBtn.disabled = true;
        submitBtn.disabled = true;
        try {
          await apiFetch('/api/weekly-reports', {
            method: 'PUT',
            body: JSON.stringify({
              userId: state.currentUser.id,
              weekStart,
              current: serializeWeekPart(draft.current),
              next: serializeWeekPart(draft.next),
              submit,
            }),
          });
          showToast(submit ? '주간보고가 제출되었습니다.' : '주간보고가 임시저장되었습니다.');
          if (onSaveSuccess) await onSaveSuccess();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          draftBtn.disabled = false;
          submitBtn.disabled = false;
        }
      };

      draftBtn.addEventListener('click', () => save(false));
      submitBtn.addEventListener('click', () => save(true));
      container.appendChild(el('div', { className: 'form-actions' }, [draftBtn, submitBtn]));
    }

    return container;
  }

  /* ---------- Screen 3-A: Employee Weekly (#/weekly) ---------- */

  async function renderEmployeeWeeklyRoute(seq) {
    const user = state.currentUser;
    const [currentTemplate, allReports] = await Promise.all([
      apiFetch(`/api/weekly-reports/current?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/weekly-reports?userId=${encodeURIComponent(user.id)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const reports = Array.isArray(allReports) ? allReports : [];
    const thisWeekStart = currentTemplate.weekStart;
    if (!state.employeeWeekStart) state.employeeWeekStart = thisWeekStart;
    const activeWeek = state.employeeWeekStart;

    let activeReport = null;
    if (activeWeek === thisWeekStart) {
      activeReport = currentTemplate;
    } else {
      activeReport = reports.find((r) => r.weekStart === activeWeek) || null;
    }

    const weekNav = buildWeekNav(
      activeWeek,
      activeReport?.weekLabel || formatWeekLabel(activeWeek),
      async (nextWeek) => {
        state.employeeWeekStart = nextWeek;
        await renderCurrentRoute();
      }
    );

    const uploadErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const fileInput = el('input', {
      type: 'file',
      accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      className: 'sr-only',
    });
    const selectedFileInfo = el('div', { className: 'upload-file-meta is-hidden', hidden: true });
    const progressWrap = el('div', { className: 'stack-sm is-hidden', hidden: true }, [
      el('div', { className: 'page-subtitle', textContent: '엑셀 파일을 분석하여 주간보고로 변환하는 중...' }),
      el('div', { className: 'upload-progress-track' }, [
        el('div', { className: 'upload-progress-fill' }),
      ]),
    ]);
    const pickBtn = el('button', {
      type: 'button',
      className: 'btn btn-primary btn-sm',
      textContent: '엑셀(.xlsx) 파일 선택',
      onClick: (e) => {
        e.stopPropagation();
        fileInput.click();
      },
    });
    const dropzone = el('div', {
      className: 'upload-dropzone',
      role: 'button',
      tabIndex: 0,
      'aria-label': '주간보고 엑셀 파일 업로드 영역',
    }, [
      el('span', { className: 'upload-icon-chip' }, [makeSvgIcon('upload', { size: 22 })]),
      el('p', { className: 'upload-title', textContent: '사내 주간보고 엑셀(.xlsx) 파일을 드래그하거나 클릭하여 업로드하세요' }),
      el('p', {
        className: 'upload-desc',
        textContent: '최대 2MB · 임시저장 또는 반려 상태에서는 새 파일 업로드 시 기존 내용이 덮어쓰기됩니다.',
      }),
      el('div', { style: 'margin-top:0.35rem;' }, [pickBtn]),
      fileInput,
    ]);

    let isUploading = false;
    const handleFileUpload = async (file) => {
      if (!file || isUploading) return;
      setInlineAlert(uploadErrBox, '');
      if (!/\.xlsx$/i.test(file.name)) {
        setInlineAlert(uploadErrBox, '확장자가 .xlsx인 엑셀 파일만 업로드할 수 있습니다.');
        return;
      }
      if (file.size === 0 || file.size > 2 * 1024 * 1024) {
        setInlineAlert(uploadErrBox, '파일 크기는 1바이트 이상 2MB 이하만 업로드할 수 있습니다.');
        return;
      }

      isUploading = true;
      dropzone.classList.add('is-uploading');
      pickBtn.disabled = true;
      selectedFileInfo.replaceChildren(
        el('span', { className: 'upload-file-name' }, [
          makeSvgIcon('file', { size: 16 }),
          el('span', { textContent: file.name }),
        ]),
        el('span', { className: 'page-subtitle', textContent: formatFileSize(file.size) })
      );
      setVisible(selectedFileInfo, true);
      setVisible(progressWrap, true);

      try {
        const result = await uploadWeeklyReportFile(user.id, file);
        const uploadedReport = result && result.report ? result.report : result;
        const warnings = result && Array.isArray(result.warnings) ? result.warnings : [];
        state.lastUploadResult = {
          reportId: uploadedReport?.id,
          weekStart: uploadedReport?.weekStart,
          fileName: uploadedReport?.fileName || file.name,
          warnings,
        };
        if (uploadedReport?.weekStart) {
          state.employeeWeekStart = uploadedReport.weekStart;
        }
        showToast('주간보고 엑셀 파일이 업로드되었습니다.');
        await renderCurrentRoute();
      } catch (err) {
        setInlineAlert(uploadErrBox, err.message);
      } finally {
        isUploading = false;
        dropzone.classList.remove('is-uploading');
        pickBtn.disabled = false;
        setVisible(progressWrap, false);
        fileInput.value = '';
      }
    };

    dropzone.addEventListener('click', () => {
      if (!isUploading) fileInput.click();
    });
    dropzone.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) handleFileUpload(f);
    });
    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', (e) => {
      if (!dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove('is-dragover');
      }
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFileUpload(f);
    });

    const uploadCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('div', { className: 'approval-summary-left' }, [
          el('h3', { className: 'card-title', textContent: '주간보고 엑셀 업로드' }),
          makeBadge('.xlsx 전용 · 최대 2MB', 'badge badge-neutral'),
        ]),
        activeReport && activeReport.fileName
          ? buildWeeklyDownloadLink(activeReport.id, user.id, { compact: true, label: `현재 파일: ${activeReport.fileName}` })
          : null,
      ]),
      dropzone,
      selectedFileInfo,
      progressWrap,
      uploadErrBox,
    ]);

    const uploadWarnings = (
      state.lastUploadResult &&
      activeReport &&
      (state.lastUploadResult.reportId === activeReport.id || state.lastUploadResult.weekStart === activeReport.weekStart)
    )
      ? state.lastUploadResult.warnings
      : [];

    let mainSection = null;
    if (!activeReport || activeReport.status === 'none') {
      mainSection = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('h3', { className: 'card-title', textContent: activeReport?.weekLabel || formatWeekLabel(activeWeek) }),
            makeStatusBadge('none'),
          ]),
        ]),
        el('div', {
          className: 'state-box',
          textContent: `${formatWeekLabel(activeWeek)}에 업로드된 주간보고가 없습니다. 위 영역에 .xlsx 파일을 업로드하면 2단 미리보기가 표시됩니다.`,
        }),
        activeWeek !== thisWeekStart
          ? el('div', { className: 'form-actions' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-outline',
              textContent: '이번 주 보고서로 이동',
              onClick: () => {
                state.employeeWeekStart = thisWeekStart;
                renderCurrentRoute();
              },
            }),
          ])
          : null,
      ]);
    } else {
      const canSubmit = activeReport.status === 'draft' || activeReport.status === 'rejected';
      const warningBanner = uploadWarnings.length > 0
        ? el('div', { className: 'alert alert-warning' }, [
          el('div', { className: 'stack-sm' }, [
            el('strong', { textContent: `파싱 경고 (${uploadWarnings.length}건)` }),
            el('ul', { className: 'list-clean' }, uploadWarnings.map((w) => el('li', { textContent: `· ${w}` }))),
          ]),
        ])
        : null;
      const rejectionBanner = activeReport.status === 'rejected'
        ? el('div', {
          className: 'alert alert-warning',
          textContent: `반려 의견 (${activeReport.approverName || '팀장'}): ${activeReport.comment || '보완한 엑셀 파일을 다시 업로드해 제출해 주세요.'}`,
        })
        : null;
      const approvedBanner = activeReport.status === 'approved' && activeReport.comment
        ? el('div', {
          className: 'alert alert-info',
          textContent: `승인 의견 (${activeReport.approverName || '팀장'}): ${activeReport.comment}`,
        })
        : null;
      const lockedBanner = !canSubmit
        ? el('div', {
          className: 'alert alert-info',
          textContent: '제출 또는 승인 완료된 보고서는 읽기 전용이며 재업로드할 수 없습니다.',
        })
        : null;

      const submitErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
      const actionNodes = [];
      if (activeReport.fileName && activeReport.id) {
        actionNodes.push(buildWeeklyDownloadLink(activeReport.id, user.id));
      }
      if (canSubmit && activeReport.id) {
        const submitBtn = el('button', {
          type: 'button',
          className: 'btn btn-primary',
          textContent: activeReport.status === 'rejected' ? '수정 파일 제출하기' : '제출하기',
        });
        submitBtn.addEventListener('click', async () => {
          setInlineAlert(submitErrBox, '');
          submitBtn.disabled = true;
          submitBtn.textContent = '제출 중...';
          try {
            await apiFetch(`/api/weekly-reports/${encodeURIComponent(activeReport.id)}/submit`, {
              method: 'POST',
              body: JSON.stringify({ userId: user.id }),
            });
            state.lastUploadResult = null;
            showToast('주간보고가 제출되었습니다.');
            await renderCurrentRoute();
          } catch (err) {
            setInlineAlert(submitErrBox, err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = activeReport.status === 'rejected' ? '수정 파일 제출하기' : '제출하기';
          }
        });
        actionNodes.push(submitBtn);
      }

      mainSection = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          el('div', { className: 'approval-summary-left' }, [
            el('h3', { className: 'card-title', textContent: activeReport.weekLabel || formatWeekLabel(activeReport.weekStart) }),
            makeStatusBadge(activeReport.status),
            activeReport.fileName
              ? makeBadge(activeReport.fileName, 'badge badge-neutral')
              : null,
          ]),
          el('span', {
            className: 'page-subtitle',
            textContent: activeReport.updatedAt ? `업데이트: ${formatIsoDate(activeReport.updatedAt)}` : '',
          }),
        ]),
        warningBanner,
        rejectionBanner,
        approvedBanner,
        lockedBanner,
        buildExcelWeeklyForm(activeReport, { editable: false }),
        submitErrBox,
        actionNodes.length > 0 ? el('div', { className: 'form-actions' }, actionNodes) : null,
      ]);
    }

    const pastCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '지난 주간보고 목록' }),
        makeBadge(`총 ${reports.length}건`, 'badge badge-neutral'),
      ]),
      reports.length === 0
        ? el('div', { className: 'state-box', textContent: '업로드된 주간보고 내역이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '주차' }),
                el('th', { textContent: '파일명' }),
                el('th', { textContent: '금주 시간' }),
                el('th', { textContent: '차주 시간' }),
                el('th', { textContent: '상태' }),
                el('th', { textContent: '결재 의견' }),
                el('th', { textContent: '열람 · 파일' }),
              ]),
            ]),
            el('tbody', {}, reports.map((rep) =>
              el('tr', {}, [
                el('td', {}, [el('strong', { textContent: rep.weekLabel || formatWeekLabel(rep.weekStart) })]),
                el('td', { textContent: rep.fileName || '-' }),
                el('td', { textContent: formatHours(rep.totalHours) }),
                el('td', { textContent: formatHours(rep.nextTotalHours) }),
                el('td', {}, [makeStatusBadge(rep.status)]),
                el('td', { textContent: rep.comment || '-' }),
                el('td', {}, [
                  el('div', { className: 'table-actions' }, [
                    el('button', {
                      type: 'button',
                      className: 'btn btn-sm btn-outline',
                      textContent: '양식 보기',
                      onClick: () => openModal(
                        `${rep.userName || user.name} · ${rep.weekLabel || formatWeekLabel(rep.weekStart)}`,
                        el('div', { className: 'stack-md' }, [
                          rep.fileName && rep.id
                            ? el('div', { className: 'approval-summary-left' }, [
                              buildWeeklyDownloadLink(rep.id, user.id, { compact: true }),
                            ])
                            : null,
                          buildExcelWeeklyForm(rep, { editable: false }),
                        ]),
                        { wide: true }
                      ),
                    }),
                    rep.fileName && rep.id
                      ? buildWeeklyDownloadLink(rep.id, user.id, { compact: true, label: '다운로드' })
                      : null,
                  ]),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '주간보고' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team} · 엑셀(.xlsx) 업로드 및 제출` }),
          ]),
          weekNav,
        ]),
        uploadCard,
        mainSection,
        pastCard,
      ])
    );
  }

  /* ---------- Screen 3-B & 3-C: Team Roll-up (Manager & Executive Drill-down) ---------- */

  function openMemberReportModal(member, { canDecide, onAfterDecide }) {
    const rep = member.report;
    if (!rep) return;

    const nodes = [
      el('div', { className: 'approval-summary-left' }, [
        makeStatusBadge(rep.status),
        el('span', { className: 'page-subtitle', textContent: `금주 ${formatHours(rep.totalHours)} · 차주 ${formatHours(rep.nextTotalHours)}` }),
        rep.fileName && rep.id && state.currentUser
          ? buildWeeklyDownloadLink(rep.id, state.currentUser.id, { compact: true })
          : null,
        rep.comment ? el('span', { className: 'page-subtitle', textContent: `결재 의견: ${rep.comment}` }) : null,
      ]),
      buildExcelWeeklyForm(rep, { editable: false }),
    ];

    if (canDecide && rep.status === 'submitted') {
      const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
      const commentInput = el('input', {
        type: 'text',
        className: 'form-control approval-comment-input',
        placeholder: '결재 의견 입력 (반려 시 필수)',
      });
      const rejectBtn = el('button', { type: 'button', className: 'btn btn-reject', textContent: '반려' });
      const approveBtn = el('button', { type: 'button', className: 'btn btn-approve', textContent: '승인' });

      const decide = async (action) => {
        setInlineAlert(errBox, '');
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        commentInput.disabled = true;
        try {
          await apiFetch(`/api/weekly-reports/${encodeURIComponent(rep.id)}/${action}`, {
            method: 'POST',
            body: JSON.stringify({
              approverId: state.currentUser.id,
              comment: commentInput.value.trim(),
            }),
          });
          closeModal();
          showToast(action === 'approve' ? '주간보고가 승인되었습니다.' : '주간보고가 반려되었습니다.');
          await onAfterDecide();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          commentInput.disabled = false;
        }
      };

      approveBtn.addEventListener('click', () => decide('approve'));
      rejectBtn.addEventListener('click', () => decide('reject'));

      nodes.push(
        errBox,
        el('div', { className: 'approval-actions-row' }, [commentInput, rejectBtn, approveBtn])
      );
    }

    openModal(
      `${member.userName} · ${rep.weekLabel || formatWeekLabel(rep.weekStart)}`,
      nodes,
      { wide: true }
    );
  }

  function renderTeamRollupContent(teamData, { readOnly, onRefresh }) {
    const stats = teamData.stats || { memberCount: 0, submittedCount: 0, approvedCount: 0, totalHours: 0 };
    const members = Array.isArray(teamData.members) ? teamData.members : [];
    const projectHours = Array.isArray(teamData.projectHours) ? teamData.projectHours : [];
    const issues = Array.isArray(teamData.issues) ? teamData.issues : [];
    const requests = Array.isArray(teamData.requests) ? teamData.requests : [];
    const schedules = Array.isArray(teamData.personalSchedules) ? teamData.personalSchedules : [];

    const statsRow = el('div', { className: readOnly ? 'stats-grid-3' : 'stats-grid-4' }, [
      buildStatCard({
        label: '대상 팀원',
        count: stats.memberCount,
        unit: '명',
        tone: 'indigo',
        icon: 'users',
        hint: `팀장: ${teamData.managerName || '-'}`,
      }),
      buildStatCard({
        label: '제출 · 승인',
        valueText: `${stats.submittedCount} / ${stats.memberCount}명`,
        unit: '',
        tone: 'green',
        icon: 'check',
        hint: `승인 완료: ${stats.approvedCount}명`,
        highlight: true,
      }),
      buildStatCard({
        label: '팀 총 투입 시간',
        valueText: formatHours(stats.totalHours),
        unit: '',
        tone: 'amber',
        icon: 'clock',
        hint: '제출·승인 보고 기준',
      }),
      !readOnly
        ? el('div', { className: 'stat-card' }, [
          el('div', { className: 'stat-label', textContent: '결재함 이동' }),
          el('div', { style: 'margin-top:0.7rem;' }, [
            el('a', { href: '#/approvals/weekly', className: 'btn btn-sm btn-primary', textContent: '주간보고 결재 바로가기 →' }),
          ]),
          el('div', { className: 'stat-hint', textContent: '주간보고 승인·반려 화면' }),
        ])
        : null,
    ]);

    const membersCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '팀원 제출 현황' }),
        makeBadge(`${members.length}명`, 'badge badge-neutral'),
      ]),
      members.length === 0
        ? el('div', { className: 'state-box', textContent: '팀원이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '이름' }),
                el('th', { textContent: '상태' }),
                el('th', { textContent: '금주 시간' }),
                el('th', { textContent: '열람' }),
              ]),
            ]),
            el('tbody', {}, members.map((m) =>
              el('tr', {}, [
                el('td', {}, [el('strong', { textContent: m.userName })]),
                el('td', {}, [makeStatusBadge(m.status)]),
                el('td', { textContent: formatHours(m.totalHours) }),
                el('td', {}, [
                  m.report
                    ? el('button', {
                      type: 'button',
                      className: 'btn btn-sm btn-outline',
                      textContent: !readOnly && m.report.status === 'submitted' ? '열람 · 결재' : '보고 열람',
                      onClick: () => openMemberReportModal(m, {
                        canDecide: !readOnly,
                        onAfterDecide: onRefresh,
                      }),
                    })
                    : el('span', {
                      className: 'page-subtitle',
                      textContent: m.status === 'draft' ? '미제출(임시저장)' : '미작성',
                    }),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    const maxProjHours = projectHours.reduce((max, p) => Math.max(max, Number(p.hours) || 0), 0);
    const projectCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '프로젝트별 투입 시간' }),
        el('span', { className: 'page-subtitle', textContent: '제출·승인 실적 기준' }),
      ]),
      projectHours.length === 0
        ? el('div', { className: 'state-box', textContent: '집계된 프로젝트 시간이 없습니다.' })
        : el('div', { className: 'bar-list' }, projectHours.map((p) => {
          const pct = maxProjHours > 0 ? Math.round(((Number(p.hours) || 0) / maxProjHours) * 100) : 0;
          const fill = el('div', { className: 'bar-fill' });
          fill.style.width = `${pct}%`;
          return el('div', { className: 'bar-row' }, [
            el('div', { className: 'bar-label-row' }, [
              el('span', { textContent: p.category || '미지정' }),
              el('span', { textContent: formatHours(p.hours) }),
            ]),
            el('div', { className: 'bar-track' }, [fill]),
          ]);
        })),
    ]);

    const buildQuoteCard = (title, items, emptyMsg) => el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: title }),
        makeBadge(`${items.length}건`, 'badge badge-neutral'),
      ]),
      items.length === 0
        ? el('div', { className: 'state-box', textContent: emptyMsg })
        : el('ul', { className: 'rollup-quote-list' }, items.map((it) =>
          el('li', { className: 'rollup-quote-item' }, [
            el('span', { className: 'rollup-quote-author', textContent: `[${it.userName}]` }),
            el('span', { className: 'rollup-quote-text', textContent: it.text }),
          ])
        )),
    ]);

    const quoteGrid = el('div', { className: 'rollup-grid-3' }, [
      buildQuoteCard('이슈사항 모음', issues, '보고된 이슈사항이 없습니다.'),
      buildQuoteCard('요청 / 전달사항', requests, '요청·전달사항이 없습니다.'),
      buildQuoteCard('개인일정 모음', schedules, '등록된 개인일정이 없습니다.'),
    ]);

    const summaryErr = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const summaryData = teamData.teamSummary;
    let summaryCard = null;
    if (readOnly) {
      summaryCard = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: `팀 종합 의견 (${teamData.managerName || '팀장'})` }),
          summaryData?.updatedAt
            ? el('span', { className: 'page-subtitle', textContent: `수정: ${formatIsoDate(summaryData.updatedAt)}` })
            : null,
        ]),
        el('div', {
          className: 'exec-summary-box',
          textContent: summaryData?.summary || '작성된 팀 종합 의견이 없습니다.',
        }),
      ]);
    } else {
      const summaryInput = el('textarea', {
        className: 'form-control',
        rows: 4,
        placeholder: '이번 주 팀 종합 의견 및 경영진 전달 사항을 작성하세요',
      });
      summaryInput.value = summaryData?.summary || '';
      const saveBtn = el('button', { type: 'button', className: 'btn btn-primary', textContent: '팀 종합 의견 저장' });
      saveBtn.addEventListener('click', async () => {
        setInlineAlert(summaryErr, '');
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
        try {
          await apiFetch('/api/team-summaries', {
            method: 'PUT',
            body: JSON.stringify({
              managerId: state.currentUser.id,
              weekStart: teamData.weekStart,
              summary: summaryInput.value.trim(),
            }),
          });
          showToast('팀 종합 의견이 저장되었습니다.');
          await onRefresh();
        } catch (err) {
          setInlineAlert(summaryErr, err.message);
          saveBtn.disabled = false;
          saveBtn.textContent = '팀 종합 의견 저장';
        }
      });

      summaryCard = el('section', { className: 'card form-stack' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: '팀 종합 의견' }),
          summaryData?.updatedAt
            ? el('span', { className: 'page-subtitle', textContent: `최근 저장: ${formatIsoDate(summaryData.updatedAt)}` })
            : null,
        ]),
        summaryInput,
        summaryErr,
        el('div', { className: 'form-actions' }, [saveBtn]),
      ]);
    }

    return [
      statsRow,
      el('div', { className: 'rollup-grid-2' }, [membersCard, projectCard]),
      quoteGrid,
      summaryCard,
    ];
  }

  async function renderManagerWeeklyRoute(seq) {
    const user = state.currentUser;
    const weekQuery = state.managerWeekStart ? `&weekStart=${encodeURIComponent(state.managerWeekStart)}` : '';
    const [teamData] = await Promise.all([
      apiFetch(`/api/weekly-reports/team?viewerId=${encodeURIComponent(user.id)}${weekQuery}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    state.managerWeekStart = teamData.weekStart;
    const weekNav = buildWeekNav(teamData.weekStart, teamData.weekLabel, async (nextWeek) => {
      state.managerWeekStart = nextWeek;
      await renderCurrentRoute();
    });

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: `주간보고 - 팀 종합 (${teamData.team})` }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} 팀장 · ${teamData.weekLabel}` }),
          ]),
          weekNav,
        ]),
        ...renderTeamRollupContent(teamData, {
          readOnly: false,
          onRefresh: () => renderCurrentRoute(),
        }),
      ])
    );
  }

  async function renderExecutiveWeeklyRoute(seq) {
    const user = state.currentUser;
    updateNavApprovalsBadge(0);

    if (state.execSelectedTeam) {
      const weekQuery = state.execWeekStart ? `&weekStart=${encodeURIComponent(state.execWeekStart)}` : '';
      const teamData = await apiFetch(
        `/api/weekly-reports/team?viewerId=${encodeURIComponent(user.id)}&team=${encodeURIComponent(state.execSelectedTeam)}${weekQuery}`
      );
      if (seq !== state.routeSeq) return;

      state.execWeekStart = teamData.weekStart;
      const weekNav = buildWeekNav(teamData.weekStart, teamData.weekLabel, async (nextWeek) => {
        state.execWeekStart = nextWeek;
        await renderCurrentRoute();
      });

      dom.routeView.replaceChildren(
        el('div', { className: 'stack-lg' }, [
          el('div', { className: 'page-header' }, [
            el('div', { className: 'approval-summary-left' }, [
              el('button', {
                type: 'button',
                className: 'btn btn-sm btn-outline',
                textContent: '← 전체 팀 목록',
                onClick: () => {
                  state.execSelectedTeam = null;
                  renderCurrentRoute();
                },
              }),
              el('div', {}, [
                el('h2', { className: 'page-title', textContent: `${teamData.team} 주간보고 상세` }),
                el('p', { className: 'page-subtitle', textContent: `${teamData.weekLabel} · 읽기 전용` }),
              ]),
            ]),
            weekNav,
          ]),
          ...renderTeamRollupContent(teamData, {
            readOnly: true,
            onRefresh: () => renderCurrentRoute(),
          }),
        ])
      );
      return;
    }

    const weekQuery = state.execWeekStart ? `&weekStart=${encodeURIComponent(state.execWeekStart)}` : '';
    const execData = await apiFetch(
      `/api/executive/weekly?executiveId=${encodeURIComponent(user.id)}${weekQuery}`
    );
    if (seq !== state.routeSeq) return;

    state.execWeekStart = execData.weekStart;
    const weekNav = buildWeekNav(execData.weekStart, execData.weekLabel, async (nextWeek) => {
      state.execWeekStart = nextWeek;
      await renderCurrentRoute();
    });

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '주간보고 - 팀별 현황' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · 전사 팀 요약 비교 (카드를 클릭해 상세 열람)` }),
          ]),
          weekNav,
        ]),
        buildExecutiveTeamCards(execData.teams, (teamName) => {
          state.execSelectedTeam = teamName;
          renderCurrentRoute();
        }),
      ])
    );
  }

  async function renderWeeklyRoute(seq) {
    const role = state.currentUser.role;
    if (role === 'manager') {
      await renderManagerWeeklyRoute(seq);
    } else if (role === 'executive') {
      await renderExecutiveWeeklyRoute(seq);
    } else {
      await renderEmployeeWeeklyRoute(seq);
    }
  }

  /* ---------- Screen 4: Leave (#/leave) ---------- */

  function buildTeamCalendarGrid(monthStr, calendarItems) {
    const [yearStr, monStr] = monthStr.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monStr) - 1;
    const firstUtc = Date.UTC(year, monthIndex, 1);
    const firstDow = new Date(firstUtc).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const todayStr = getLocalTodayISO();
    const items = Array.isArray(calendarItems) ? calendarItems : [];

    const grid = el('div', { className: 'calendar-grid' });
    WEEKDAY_NAMES.forEach((d, idx) => {
      const cls = `calendar-dow${idx === 0 ? ' is-sun' : idx === 6 ? ' is-sat' : ''}`;
      grid.appendChild(el('div', { className: cls, textContent: d }));
    });

    for (let i = 0; i < firstDow; i++) {
      grid.appendChild(el('div', { className: 'calendar-cell is-empty' }));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${yearStr}-${monStr}-${String(day).padStart(2, '0')}`;
      const dow = (firstDow + day - 1) % 7;
      const isWeekend = dow === 0 || dow === 6;
      const cell = el('div', {
        className: `calendar-cell${dateStr === todayStr ? ' is-today' : ''}`,
      }, [
        el('div', { className: 'calendar-day-num', textContent: String(day) }),
      ]);

      const matching = items.filter((item) => {
        if (dateStr < item.startDate || dateStr > item.endDate) return false;
        if (isWeekend && item.startDate !== item.endDate) return false;
        return true;
      });

      for (const m of matching) {
        const shortType = LEAVE_SHORT_LABELS[m.type] || m.type;
        const pillCls = m.status === 'approved' ? 'cal-pill cal-pill-approved' : 'cal-pill cal-pill-pending';
        cell.appendChild(el('div', {
          className: pillCls,
          title: `${m.userName} · ${LEAVE_TYPE_LABELS[m.type] || m.type} (${m.status === 'approved' ? '승인' : '대기'})`,
          textContent: `${m.userName} (${shortType})`,
        }));
      }

      grid.appendChild(cell);
    }

    const totalCells = firstDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      grid.appendChild(el('div', { className: 'calendar-cell is-empty' }));
    }

    return grid;
  }

  async function renderLeaveRoute(seq) {
    const user = state.currentUser;
    if (!state.leaveCalendarMonth) state.leaveCalendarMonth = getLocalMonthISO();

    const [balance, requests, calendarItems] = await Promise.all([
      apiFetch(`/api/users/${encodeURIComponent(user.id)}/balance`),
      apiFetch(`/api/leave-requests?userId=${encodeURIComponent(user.id)}`),
      apiFetch(`/api/leave-calendar?userId=${encodeURIComponent(user.id)}&month=${encodeURIComponent(state.leaveCalendarMonth)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const available = Math.max(0, Math.round((Number(balance.remaining) - Number(balance.pending)) * 10) / 10);
    const balanceCards = el('div', { className: 'stats-grid-4' }, [
      el('div', { className: 'stat-card stat-card-primary' }, [
        el('div', { className: 'stat-label', textContent: '잔여 연차' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.remaining) }),
        el('div', { className: 'stat-hint', textContent: `추가 신청 가능: ${formatDays(available)}` }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '사용 연차' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.used) }),
        el('div', { className: 'stat-hint', textContent: '승인 완료 합계' }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '승인 대기' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.pending) }),
        el('div', { className: 'stat-hint', textContent: '결재 진행 중' }),
      ]),
      el('div', { className: 'stat-card' }, [
        el('div', { className: 'stat-label', textContent: '총 부여 연차' }),
        el('div', { className: 'stat-value', textContent: formatDays(balance.total) }),
        el('div', { className: 'stat-hint', textContent: '연간 기준 일수' }),
      ]),
    ]);

    const today = getLocalTodayISO();
    const typeSelect = el('select', { className: 'form-control', id: 'leave-type' }, [
      el('option', { value: 'annual', textContent: '연차 (종일)' }),
      el('option', { value: 'half_am', textContent: '오전 반차 (0.5일)' }),
      el('option', { value: 'half_pm', textContent: '오후 반차 (0.5일)' }),
    ]);
    const startInput = el('input', { type: 'date', className: 'form-control', id: 'leave-start', value: today });
    const endInput = el('input', { type: 'date', className: 'form-control', id: 'leave-end', value: today });
    const halfHint = el('p', {
      className: 'field-hint is-hidden',
      hidden: true,
      textContent: '반차는 시작일과 종료일이 동일하게 적용됩니다.',
    });
    const previewVal = el('strong', { className: 'preview-value', textContent: '-' });
    const reasonInput = el('textarea', {
      className: 'form-control',
      rows: 3,
      id: 'leave-reason',
      placeholder: '연차 사유를 입력하세요 (예: 개인 사유, 병원 방문)',
    });
    const reqErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const submitBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: '신청하기' });

    const syncPreview = () => {
      const type = typeSelect.value;
      const isHalf = type === 'half_am' || type === 'half_pm';
      if (isHalf) {
        if (startInput.value) endInput.value = startInput.value;
        endInput.disabled = true;
        setVisible(halfHint, true);
      } else {
        endInput.disabled = false;
        setVisible(halfHint, false);
        if (startInput.value && (!endInput.value || endInput.value < startInput.value)) {
          endInput.value = startInput.value;
        }
      }
      const prev = calculatePreviewDays(type, startInput.value, endInput.value);
      previewVal.textContent = prev.text;
      previewVal.classList.toggle('is-invalid', !prev.valid);
    };

    typeSelect.addEventListener('change', syncPreview);
    startInput.addEventListener('change', syncPreview);
    endInput.addEventListener('change', syncPreview);
    syncPreview();

    const formCard = el('section', { className: 'card' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '연차 신청' }),
        el('span', { className: 'page-subtitle', textContent: '주말 제외 평일 계산' }),
      ]),
      el('form', {
        className: 'form-stack',
        novalidate: true,
        onSubmit: async (e) => {
          e.preventDefault();
          setInlineAlert(reqErrBox, '');
          const type = typeSelect.value;
          const startDate = startInput.value;
          const endDate = type === 'annual' ? endInput.value : startDate;
          submitBtn.disabled = true;
          submitBtn.textContent = '신청 중...';
          try {
            await apiFetch('/api/leave-requests', {
              method: 'POST',
              body: JSON.stringify({
                userId: user.id,
                type,
                startDate,
                endDate,
                reason: reasonInput.value.trim(),
              }),
            });
            showToast('연차 신청이 접수되었습니다.');
            await renderCurrentRoute();
          } catch (err) {
            setInlineAlert(reqErrBox, err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = '신청하기';
          }
        },
      }, [
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: 'leave-type', textContent: '휴가 유형' }),
          typeSelect,
        ]),
        el('div', { className: 'form-row-2' }, [
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', for: 'leave-start', textContent: '시작일' }),
            startInput,
          ]),
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', for: 'leave-end', textContent: '종료일' }),
            endInput,
          ]),
        ]),
        halfHint,
        el('div', { className: 'preview-box', 'aria-live': 'polite' }, [
          el('span', { className: 'preview-label', textContent: '예상 차감 일수' }),
          previewVal,
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: 'leave-reason', textContent: '사유' }),
          reasonInput,
        ]),
        reqErrBox,
        el('div', { className: 'form-actions' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-outline',
            textContent: '초기화',
            onClick: () => {
              typeSelect.value = 'annual';
              startInput.value = today;
              endInput.value = today;
              reasonInput.value = '';
              setInlineAlert(reqErrBox, '');
              syncPreview();
            },
          }),
          submitBtn,
        ]),
      ]),
    ]);

    const list = Array.isArray(requests) ? requests : [];
    const listErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const listCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '내 신청 내역' }),
        makeBadge(`총 ${list.length}건`, 'badge badge-neutral'),
      ]),
      listErrBox,
      list.length === 0
        ? el('div', { className: 'state-box', textContent: '아직 신청한 연차 내역이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '기간' }),
                el('th', { textContent: '유형' }),
                el('th', { textContent: '일수' }),
                el('th', { textContent: '사유' }),
                el('th', { textContent: '상태' }),
                el('th', { textContent: '결재 의견' }),
                el('th', { textContent: '관리' }),
              ]),
            ]),
            el('tbody', {}, list.map((item) => {
              const cancelBtn = item.status === 'pending'
                ? el('button', {
                  type: 'button',
                  className: 'btn btn-sm btn-reject',
                  textContent: '취소',
                  onClick: async (e) => {
                    const btn = e.currentTarget;
                    setInlineAlert(listErrBox, '');
                    btn.disabled = true;
                    try {
                      await apiFetch(`/api/leave-requests/${encodeURIComponent(item.id)}/cancel`, {
                        method: 'POST',
                        body: JSON.stringify({ userId: user.id }),
                      });
                      showToast('연차 신청이 취소되었습니다.');
                      await renderCurrentRoute();
                    } catch (err) {
                      setInlineAlert(listErrBox, err.message);
                      btn.disabled = false;
                    }
                  },
                })
                : el('span', { textContent: '-' });

              const commentText = item.comment && String(item.comment).trim()
                ? (item.approverName ? `${item.comment} (${item.approverName})` : item.comment)
                : '-';

              return el('tr', {}, [
                el('td', { textContent: formatPeriod(item.startDate, item.endDate) }),
                el('td', {}, [makeBadge(LEAVE_TYPE_LABELS[item.type] || item.type, 'badge badge-neutral')]),
                el('td', { textContent: formatDays(item.days) }),
                el('td', { textContent: item.reason || '-' }),
                el('td', {}, [makeStatusBadge(item.status)]),
                el('td', { textContent: commentText }),
                el('td', {}, [cancelBtn]),
              ]);
            })),
          ]),
        ]),
    ]);

    const calMonthInput = el('input', {
      type: 'month',
      className: 'form-control',
      value: state.leaveCalendarMonth,
      'aria-label': '팀 연차 캘린더 월 선택',
      onChange: async (e) => {
        if (!e.target.value) return;
        state.leaveCalendarMonth = e.target.value;
        await renderCurrentRoute();
      },
    });
    calMonthInput.style.width = 'auto';

    const calendarCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: `팀 월간 연차 캘린더 (${user.team})` }),
        el('div', { className: 'calendar-controls' }, [
          el('div', { className: 'calendar-legend' }, [
            el('span', {}, [el('span', { className: 'legend-dot legend-approved' }), '승인']),
            el('span', {}, [el('span', { className: 'legend-dot legend-pending' }), '대기']),
          ]),
          calMonthInput,
        ]),
      ]),
      buildTeamCalendarGrid(state.leaveCalendarMonth, calendarItems),
      calendarItems.length === 0
        ? el('div', { className: 'page-subtitle', textContent: '선택한 월에 예정된 팀 연차가 없습니다.' })
        : null,
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '연차 관리' }),
            el('p', { className: 'page-subtitle', textContent: `${user.name} · ${user.team}` }),
          ]),
        ]),
        balanceCards,
        el('div', { className: 'leave-workspace' }, [formCard, listCard]),
        calendarCard,
      ])
    );
  }

  /* ---------- Screen 5: Approvals (#/approvals) ---------- */

  function renderApprovalDetail(item) {
    const d = item.detail || {};
    const viewerId = state.currentUser?.id;
    if (item.kind === 'weekly') {
      const reportId = d.id || item.id;
      const box = el('div', { className: 'approval-detail-box' }, [
        el('div', { className: 'approval-summary-left' }, [
          el('strong', { textContent: `${d.userName || item.userName} · ${d.weekLabel || formatWeekLabel(d.weekStart)}` }),
          el('span', { className: 'page-subtitle', textContent: `금주 ${formatHours(d.totalHours)} · 차주 ${formatHours(d.nextTotalHours)}` }),
          d.fileName ? makeBadge(d.fileName, 'badge badge-neutral') : null,
          d.fileName && reportId && viewerId
            ? buildWeeklyDownloadLink(reportId, viewerId, { compact: true })
            : null,
          d.comment ? el('span', { className: 'page-subtitle', textContent: `결재 의견: ${d.comment}` }) : null,
        ]),
        buildExcelWeeklyForm(d, { editable: false }),
      ]);
      if (item.status === 'rejected' && item.userId === viewerId) {
        box.appendChild(
          el('div', { className: 'form-actions' }, [
            el('a', {
              href: '#/weekly',
              className: 'btn btn-sm btn-primary',
              textContent: '보완 파일 다시 업로드 · 제출 →',
              onClick: () => closeModal(),
            }),
          ])
        );
      }
      return box;
    }

    return el('div', { className: 'approval-detail-box' }, [
      el('div', { className: 'detail-kv-grid' }, [
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '신청자' }),
          el('div', { className: 'detail-kv-value', textContent: d.userName || item.userName || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '휴가 유형' }),
          el('div', { className: 'detail-kv-value', textContent: LEAVE_TYPE_LABELS[d.type] || d.type || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '기간 및 일수' }),
          el('div', { className: 'detail-kv-value', textContent: `${formatPeriod(d.startDate, d.endDate)} (${formatDays(d.days)})` }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '신청 사유' }),
          el('div', { className: 'detail-kv-value', textContent: d.reason || '-' }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '신청일' }),
          el('div', { className: 'detail-kv-value', textContent: formatDotDate(item.createdAt) }),
        ]),
        d.comment
          ? el('div', {}, [
            el('div', { className: 'detail-kv-label', textContent: `결재 의견 (${d.approverName || '팀장'})` }),
            el('div', { className: 'detail-kv-value', textContent: d.comment }),
          ])
          : null,
      ]),
    ]);
  }

  async function submitApprovalDecision(item, action, comment) {
    const base = item.kind === 'weekly' ? '/api/weekly-reports' : '/api/leave-requests';
    await apiFetch(`${base}/${encodeURIComponent(item.id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        approverId: state.currentUser.id,
        comment: comment || '',
      }),
    });
  }

  function openRejectCommentModal(item, onAfterAction) {
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const commentInput = el('textarea', {
      className: 'form-control',
      rows: 3,
      placeholder: item.kind === 'weekly'
        ? '반려 사유를 입력하세요 (주간보고 반려 시 필수)'
        : '반려 사유를 입력하세요 (선택)',
    });
    const cancelBtn = el('button', {
      type: 'button',
      className: 'btn btn-outline',
      textContent: '취소',
      onClick: () => closeModal(),
    });
    const confirmBtn = el('button', {
      type: 'button',
      className: 'btn btn-reject',
      textContent: '반려 확정',
    });

    confirmBtn.addEventListener('click', async () => {
      const comment = commentInput.value.trim();
      setInlineAlert(errBox, '');
      if (item.kind === 'weekly' && !comment) {
        setInlineAlert(errBox, '주간보고 반려 시 결재 의견을 입력해 주세요.');
        commentInput.focus();
        return;
      }
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      commentInput.disabled = true;
      try {
        await submitApprovalDecision(item, 'reject', comment);
        closeModal();
        showToast('반려 처리되었습니다.');
        await onAfterAction();
      } catch (err) {
        setInlineAlert(errBox, err.message);
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        commentInput.disabled = false;
      }
    });

    openModal(`${item.userName} · ${item.kind === 'weekly' ? '주간보고' : '연차'} 반려`, [
      el('div', { className: 'form-stack' }, [
        el('p', { className: 'page-subtitle', textContent: item.title || '-' }),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', textContent: '반려 의견' }),
          commentInput,
        ]),
        errBox,
        el('div', { className: 'form-actions' }, [cancelBtn, confirmBtn]),
      ]),
    ]);
  }

  function openApprovalDetailModal(item, { canDecide, onAfterAction }) {
    const kindLabel = item.kind === 'weekly' ? '주간보고' : '연차';
    const contentNodes = [
      el('div', { className: 'approval-summary-left' }, [
        makeBadge(kindLabel, item.kind === 'weekly' ? 'badge badge-submitted' : 'badge badge-pinned'),
        makeStatusBadge(item.status),
        el('span', { className: 'page-subtitle', textContent: `신청일 ${formatDotDate(item.createdAt)}` }),
      ]),
      renderApprovalDetail(item),
    ];

    if (canDecide) {
      const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
      const commentInput = el('input', {
        type: 'text',
        className: 'form-control approval-comment-input',
        placeholder: item.kind === 'weekly' ? '결재 의견 입력 (주간보고 반려 시 필수)' : '결재 의견 입력 (선택)',
      });
      const rejectBtn = el('button', { type: 'button', className: 'btn btn-reject', textContent: '반려' });
      const approveBtn = el('button', { type: 'button', className: 'btn btn-primary', textContent: '승인' });

      const decide = async (action) => {
        const comment = commentInput.value.trim();
        setInlineAlert(errBox, '');
        if (action === 'reject' && item.kind === 'weekly' && !comment) {
          setInlineAlert(errBox, '주간보고 반려 시 결재 의견을 입력해 주세요.');
          commentInput.focus();
          return;
        }
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        commentInput.disabled = true;
        try {
          await submitApprovalDecision(item, action, comment);
          closeModal();
          showToast(action === 'approve' ? '승인 처리되었습니다.' : '반려 처리되었습니다.');
          await onAfterAction();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          commentInput.disabled = false;
        }
      };

      approveBtn.addEventListener('click', () => decide('approve'));
      rejectBtn.addEventListener('click', () => decide('reject'));

      contentNodes.push(
        errBox,
        el('div', { className: 'approval-actions-row' }, [commentInput, rejectBtn, approveBtn])
      );
    }

    openModal(
      `${item.userName} · ${kindLabel} 상세`,
      contentNodes,
      { wide: item.kind === 'weekly' }
    );
  }

  function formatWeeklyIssuesSummary(detail) {
    const d = detail || {};
    const cur = d.current || {};
    const parts = [];
    const issueText = typeof cur.issues === 'string' ? cur.issues.trim() : '';
    const reqText = typeof cur.requests === 'string' ? cur.requests.trim() : '';
    if (issueText && issueText !== '없음' && issueText !== '-') {
      parts.push(`이슈: ${issueText}`);
    }
    if (reqText && reqText !== '없음' && reqText !== '-') {
      parts.push(`요청: ${reqText}`);
    }
    if (parts.length === 0) {
      parts.push('특이사항 없음');
    }
    if (d.comment) {
      parts.push(`의견: ${d.comment}`);
    }
    return parts.join(' · ');
  }

  function formatApprovalRowMeta(item) {
    const d = item.detail || {};
    if (item.kind === 'weekly') {
      const periodText = d.weekLabel || formatWeekLabel(d.weekStart);
      const amountText = `금주 ${formatHours(d.totalHours)}`;
      const parts = [`차주 ${formatHours(d.nextTotalHours)}`];
      if (d.fileName) parts.push(d.fileName);
      if (d.comment) parts.push(`의견: ${d.comment}`);
      return {
        kindLabel: '주간보고',
        kindClass: 'badge badge-submitted',
        periodText,
        amountText,
        summaryText: parts.join(' · '),
      };
    }

    const periodText = formatPeriod(d.startDate, d.endDate);
    const typeLabel = LEAVE_TYPE_LABELS[d.type] || d.type || '휴가';
    const amountText = `${typeLabel} · ${formatDays(d.days)}`;
    const summaryParts = [d.reason || '-'];
    if (d.comment) summaryParts.push(`의견: ${d.comment}`);
    return {
      kindLabel: '연차',
      kindClass: 'badge badge-pinned',
      periodText,
      amountText,
      summaryText: summaryParts.join(' · '),
    };
  }

  function buildApprovalsTable(items, { tableKind = 'recent', showInlineActions = false, onAfterAction, errBox }) {
    const headersByKind = {
      recent: ['신청 직원', '종류', '기간 / 주차', '일수 / 시간', '사유 / 요약', '상태', '처리'],
      leave: ['신청 직원', '연차 유형', '기간', '일수', '사유', '상태', '처리'],
      weekly: ['작성자', '주차', '금주 총 시간', '이슈·요청 요약', '제출일', '상태', '처리'],
    };
    const headers = headersByKind[tableKind] || headersByKind.recent;

    return el('div', { className: 'table-wrap' }, [
      el('table', { className: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, headers.map((label) => el('th', { textContent: label }))),
        ]),
        el('tbody', {}, items.map((item) => {
          const d = item.detail || {};
          const meta = formatApprovalRowMeta(item);
          const isPending = item.status === 'pending' || item.status === 'submitted';
          const canDecideRow = showInlineActions && isPending;

          const openDetail = () => openApprovalDetailModal(item, {
            canDecide: showInlineActions && isPending,
            onAfterAction,
          });

          const detailBtn = el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline',
            textContent: '상세',
            onClick: (e) => {
              e.stopPropagation();
              openDetail();
            },
          });
          const actionButtons = [detailBtn];

          if (canDecideRow) {
            const approveBtn = el('button', {
              type: 'button',
              className: 'btn btn-sm btn-primary',
              textContent: '승인',
            });
            const rejectBtn = el('button', {
              type: 'button',
              className: 'btn btn-sm btn-outline',
              textContent: '반려',
            });
            approveBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              setInlineAlert(errBox, '');
              approveBtn.disabled = true;
              rejectBtn.disabled = true;
              try {
                await submitApprovalDecision(item, 'approve', '');
                showToast('승인 처리되었습니다.');
                await onAfterAction();
              } catch (err) {
                setInlineAlert(errBox, err.message);
                approveBtn.disabled = false;
                rejectBtn.disabled = false;
              }
            });
            rejectBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              openRejectCommentModal(item, onAfterAction);
            });
            actionButtons.push(approveBtn, rejectBtn);
          }

          let cells;
          if (tableKind === 'leave') {
            const leaveReason = [d.reason || '-', d.comment ? `의견: ${d.comment}` : '']
              .filter(Boolean)
              .join(' · ');
            cells = [
              el('td', {}, [
                el('div', { className: 'cell-stack' }, [
                  el('span', { className: 'cell-primary', textContent: item.userName || '-' }),
                  el('span', { className: 'cell-secondary', textContent: `신청일 ${formatDotDate(item.createdAt)}` }),
                ]),
              ]),
              el('td', { textContent: LEAVE_TYPE_LABELS[d.type] || d.type || '-' }),
              el('td', { textContent: formatPeriod(d.startDate, d.endDate) }),
              el('td', { textContent: formatDays(d.days) }),
              el('td', { className: 'cell-reason', textContent: leaveReason }),
              el('td', {}, [makeStatusBadge(item.status)]),
              el('td', {}, [el('div', { className: 'table-actions' }, actionButtons)]),
            ];
          } else if (tableKind === 'weekly') {
            cells = [
              el('td', {}, [
                el('div', { className: 'cell-stack' }, [
                  el('span', { className: 'cell-primary', textContent: item.userName || '-' }),
                  d.fileName
                    ? el('span', { className: 'cell-secondary', textContent: d.fileName })
                    : null,
                ]),
              ]),
              el('td', { textContent: d.weekLabel || formatWeekLabel(d.weekStart) }),
              el('td', { textContent: formatHours(d.totalHours) }),
              el('td', { className: 'cell-reason', textContent: formatWeeklyIssuesSummary(d) }),
              el('td', { textContent: formatDotDate(d.submittedAt || item.createdAt) }),
              el('td', {}, [makeStatusBadge(item.status)]),
              el('td', {}, [el('div', { className: 'table-actions' }, actionButtons)]),
            ];
          } else {
            cells = [
              el('td', {}, [
                el('div', { className: 'cell-stack' }, [
                  el('span', { className: 'cell-primary', textContent: item.userName || '-' }),
                  el('span', { className: 'cell-secondary', textContent: `신청일 ${formatDotDate(item.createdAt)}` }),
                ]),
              ]),
              el('td', {}, [makeBadge(meta.kindLabel, meta.kindClass)]),
              el('td', { textContent: meta.periodText }),
              el('td', { textContent: meta.amountText }),
              el('td', { className: 'cell-reason', textContent: meta.summaryText }),
              el('td', {}, [makeStatusBadge(item.status)]),
              el('td', {}, [el('div', { className: 'table-actions' }, actionButtons)]),
            ];
          }

          const rowAttrs = item.kind === 'weekly' || tableKind === 'weekly'
            ? { className: 'is-clickable', title: '클릭하여 주간보고 2단 양식 보기', onClick: openDetail }
            : {};
          return el('tr', rowAttrs, cells);
        })),
      ]),
    ]);
  }

  function buildApprovalKindSegmentedTabs(activeKind, leaveBadgeCount, weeklyBadgeCount) {
    const defs = [
      { kind: 'leave', label: '연차 결재', badge: leaveBadgeCount, hash: '#/approvals/leave' },
      { kind: 'weekly', label: '주간보고 결재', badge: weeklyBadgeCount, hash: '#/approvals/weekly' },
    ];
    return el('div', { className: 'segmented-tabs', role: 'tablist', 'aria-label': '결재 종류 선택' },
      defs.map((def) =>
        el('a', {
          href: def.hash,
          role: 'tab',
          'aria-selected': String(activeKind === def.kind),
          className: `segmented-tab${activeKind === def.kind ? ' is-active' : ''}`,
        }, [
          el('span', { textContent: def.label }),
          def.badge > 0
            ? el('span', { className: 'segmented-tab-badge', textContent: String(def.badge) })
            : null,
        ])
      )
    );
  }

  async function renderApprovalsRoute(seq) {
    const user = state.currentUser;
    const isManager = user.role === 'manager';
    const activeKind = state.approvalKind === 'weekly' ? 'weekly' : 'leave';
    const isWeekly = activeKind === 'weekly';
    const pageErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    if (isManager) {
      const [pendingList, historyList] = await Promise.all([
        apiFetch(`/api/approvals?approverId=${encodeURIComponent(user.id)}`),
        apiFetch(`/api/approvals/history?approverId=${encodeURIComponent(user.id)}`),
      ]);
      if (seq !== state.routeSeq) return;

      const pendingAll = Array.isArray(pendingList) ? pendingList : [];
      const historyAll = Array.isArray(historyList) ? historyList : [];
      const leavePendingCount = pendingAll.filter((x) => x.kind === 'leave').length;
      const weeklyPendingCount = pendingAll.filter((x) => x.kind === 'weekly').length;
      updateNavApprovalsBadge({ leave: leavePendingCount, weekly: weeklyPendingCount });

      const pending = pendingAll.filter((x) => x.kind === activeKind);
      const history = historyAll.filter((x) => x.kind === activeKind);
      const approvedList = history.filter((x) => x.status === 'approved');
      const rejectedList = history.filter((x) => x.status === 'rejected');
      const allItems = [...pending, ...history];

      const filterStateKey = isWeekly ? 'approvalsWeeklyFilter' : 'approvalsLeaveFilter';
      const rawFilter = state[filterStateKey];
      const filterKey = ['pending', 'all', 'approved', 'rejected'].includes(rawFilter)
        ? rawFilter
        : 'pending';

      const itemsByFilter = {
        pending,
        all: allItems,
        approved: approvedList,
        rejected: rejectedList,
      };
      const filteredItems = itemsByFilter[filterKey] || pending;

      const filterDefs = [
        { key: 'pending', label: '결재 대기', count: pending.length },
        { key: 'all', label: '전체', count: allItems.length },
        { key: 'approved', label: '승인', count: approvedList.length },
        { key: 'rejected', label: '반려', count: rejectedList.length },
      ];

      const filterTabsEl = el('div', { className: 'filter-tabs', role: 'tablist', 'aria-label': '결재 상태 필터' },
        filterDefs.map((def) =>
          el('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': String(filterKey === def.key),
            className: `filter-tab${filterKey === def.key ? ' is-active' : ''}`,
            onClick: () => {
              state[filterStateKey] = def.key;
              renderCurrentRoute();
            },
          }, [
            el('span', { textContent: def.label }),
            el('span', { className: 'filter-tab-count', textContent: String(def.count) }),
          ])
        )
      );

      const kindTitle = isWeekly ? '주간보고' : '연차';
      const statsGrid = el('div', { className: 'stats-grid-3' }, [
        buildStatCard({
          label: `${kindTitle} 결재 대기`,
          count: pending.length,
          tone: 'amber',
          icon: isWeekly ? 'file' : 'clock',
          hint: isWeekly ? '팀원 제출 주간보고 확인 대기' : '검토 및 결재가 필요한 연차 신청',
        }),
        buildStatCard({
          label: `${kindTitle} 승인`,
          count: approvedList.length,
          tone: 'green',
          icon: 'check',
          hint: `승인 완료된 ${kindTitle} 건수`,
        }),
        buildStatCard({
          label: `${kindTitle} 반려`,
          count: rejectedList.length,
          tone: 'red',
          icon: 'x',
          hint: `반려 및 보완 요청 ${kindTitle} 건수`,
        }),
      ]);

      const emptyMessages = {
        pending: `대기 중인 ${kindTitle} 결재 요청이 없습니다.`,
        all: `접수된 ${kindTitle} 결재 내역이 없습니다.`,
        approved: `승인 완료된 ${kindTitle} 내역이 없습니다.`,
        rejected: `반려 처리된 ${kindTitle} 내역이 없습니다.`,
      };

      const tableCard = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          filterTabsEl,
          makeBadge(`${filteredItems.length}건`, 'badge badge-neutral'),
        ]),
        filteredItems.length === 0
          ? el('div', { className: 'state-box', textContent: emptyMessages[filterKey] })
          : buildApprovalsTable(filteredItems, {
            tableKind: activeKind,
            showInlineActions: true,
            onAfterAction: () => renderCurrentRoute(),
            errBox: pageErrBox,
          }),
      ]);

      dom.routeView.replaceChildren(
        el('div', { className: 'stack-lg' }, [
          el('div', { className: 'page-header' }, [
            el('div', {}, [
              el('h2', { className: 'page-title', textContent: `결재 관리 · ${kindTitle} 결재` }),
              el('p', {
                className: 'page-subtitle',
                textContent: isWeekly
                  ? `${user.team} 주간보고를 검토하고 행을 눌러 2단 양식과 원본 파일을 확인합니다.`
                  : `${user.team} 구성원의 연차 · 반차 신청을 검토하고 승인 또는 반려합니다.`,
              }),
            ]),
            buildApprovalKindSegmentedTabs(activeKind, leavePendingCount, weeklyPendingCount),
          ]),
          statsGrid,
          pageErrBox,
          tableCard,
        ])
      );
      return;
    }

    const mineList = await apiFetch(`/api/approvals/mine?userId=${encodeURIComponent(user.id)}`);
    if (seq !== state.routeSeq) return;
    updateNavApprovalsBadge({ leave: 0, weekly: 0 });

    const mineAll = Array.isArray(mineList) ? mineList : [];
    const empLeavePendingCount = mineAll.filter((x) => x.kind === 'leave' && (x.status === 'pending' || x.status === 'submitted')).length;
    const empWeeklyPendingCount = mineAll.filter((x) => x.kind === 'weekly' && (x.status === 'pending' || x.status === 'submitted')).length;

    const mine = mineAll.filter((x) => x.kind === activeKind);
    const empPending = mine.filter((x) => x.status === 'pending' || x.status === 'submitted');
    const empApproved = mine.filter((x) => x.status === 'approved');
    const empRejected = mine.filter((x) => x.status === 'rejected');

    const empFilterKey = isWeekly ? 'empApprovalsWeeklyFilter' : 'empApprovalsLeaveFilter';
    const rawEmpFilter = state[empFilterKey];
    const empFilter = ['all', 'pending', 'approved', 'rejected'].includes(rawEmpFilter)
      ? rawEmpFilter
      : 'all';
    const empMap = {
      all: mine,
      pending: empPending,
      approved: empApproved,
      rejected: empRejected,
    };
    const empFiltered = empMap[empFilter] || mine;

    const empTabsEl = el('div', { className: 'filter-tabs', role: 'tablist', 'aria-label': '내 결재 상태 필터' }, [
      { key: 'all', label: '전체', count: mine.length },
      { key: 'pending', label: '대기', count: empPending.length },
      { key: 'approved', label: '승인', count: empApproved.length },
      { key: 'rejected', label: '반려', count: empRejected.length },
    ].map((def) =>
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(empFilter === def.key),
        className: `filter-tab${empFilter === def.key ? ' is-active' : ''}`,
        onClick: () => {
          state[empFilterKey] = def.key;
          renderCurrentRoute();
        },
      }, [
        el('span', { textContent: def.label }),
        el('span', { className: 'filter-tab-count', textContent: String(def.count) }),
      ])
    ));

    const kindHeading = isWeekly ? '내가 올린 주간보고' : '내가 올린 연차';
    const statsGrid = el('div', { className: 'stats-grid-3' }, [
      buildStatCard({
        label: '결재 대기',
        count: empPending.length,
        tone: 'amber',
        icon: isWeekly ? 'file' : 'clock',
        hint: '팀장 검토 중인 요청',
      }),
      buildStatCard({
        label: '승인',
        count: empApproved.length,
        tone: 'green',
        icon: 'check',
        hint: '승인 완료된 내역',
      }),
      buildStatCard({
        label: '반려',
        count: empRejected.length,
        tone: 'red',
        icon: 'x',
        hint: '보완 후 재제출 필요',
      }),
    ]);

    const tableCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        empTabsEl,
        makeBadge(`총 ${empFiltered.length}건`, 'badge badge-neutral'),
      ]),
      empFiltered.length === 0
        ? el('div', { className: 'state-box', textContent: `${kindHeading} 내역이 없습니다.` })
        : buildApprovalsTable(empFiltered, {
          tableKind: activeKind,
          showInlineActions: false,
          onAfterAction: () => renderCurrentRoute(),
          errBox: pageErrBox,
        }),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: `결재 관리 · ${kindHeading}` }),
            el('p', {
              className: 'page-subtitle',
              textContent: isWeekly
                ? `${user.name} · 제출한 주간보고 결재 진행 및 원본 파일을 확인합니다.`
                : `${user.name} · 신청한 연차·반차 승인 결과를 확인합니다.`,
            }),
          ]),
          buildApprovalKindSegmentedTabs(activeKind, empLeavePendingCount, empWeeklyPendingCount),
        ]),
        statsGrid,
        pageErrBox,
        tableCard,
      ])
    );
  }

  /* ---------- Screen 6: Meeting Rooms (#/rooms) ---------- */

  const ROOM_SLOTS = Array.from({ length: 24 }, (_, idx) => {
    const h = 8 + Math.floor(idx / 2);
    const m = idx % 2 === 0 ? '00' : '30';
    return `${String(h).padStart(2, '0')}:${m}`;
  });

  const ROOM_END_SLOTS = Array.from({ length: 24 }, (_, idx) => {
    const endIdx = idx + 1;
    const h = 8 + Math.floor(endIdx / 2);
    const m = endIdx % 2 === 0 ? '00' : '30';
    return `${String(h).padStart(2, '0')}:${m}`;
  });

  function toSlotIndex(hhmm) {
    if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return -1;
    const [h, m] = hhmm.split(':').map(Number);
    return (h - 8) * 2 + (m >= 30 ? 1 : 0);
  }

  function addOneHourCapped(startTime) {
    const idx = toSlotIndex(startTime);
    if (idx < 0) return '10:00';
    const endIdx = Math.min(24, idx + 2);
    return ROOM_END_SLOTS[endIdx - 1];
  }

  function openRoomBookingModal({ rooms, prefillRoomId, prefillDate, prefillStart, onAfterAction }) {
    const user = state.currentUser;
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });

    const roomSelect = el('select', { className: 'form-control' }, rooms.map((r) =>
      el('option', { value: String(r.id), textContent: `${r.name} (${r.capacity}인${r.equipment ? ' · ' + r.equipment : ''})` })
    ));
    if (prefillRoomId) roomSelect.value = String(prefillRoomId);

    const dateInput = el('input', {
      type: 'date',
      className: 'form-control',
      value: prefillDate || getLocalTodayISO(),
    });

    const startTime = ROOM_SLOTS.includes(prefillStart) ? prefillStart : '09:00';
    const startSelect = el('select', { className: 'form-control' }, ROOM_SLOTS.map((t) =>
      el('option', { value: t, textContent: t })
    ));
    startSelect.value = startTime;

    const endSelect = el('select', { className: 'form-control' }, ROOM_END_SLOTS.map((t) =>
      el('option', { value: t, textContent: t })
    ));
    endSelect.value = addOneHourCapped(startTime);

    startSelect.addEventListener('change', () => {
      if (toSlotIndex(endSelect.value) <= toSlotIndex(startSelect.value)) {
        endSelect.value = addOneHourCapped(startSelect.value);
      }
    });

    const titleInput = el('input', {
      type: 'text',
      className: 'form-control',
      placeholder: '회의 제목을 입력하세요 (예: 개발팀 주간 점검)',
    });

    const attendeesInput = el('input', {
      type: 'text',
      className: 'form-control',
      placeholder: '참석자를 입력하세요 (예: 김신입, 이분석)',
    });

    const submitBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: '예약하기' });

    const form = el('form', {
      className: 'form-stack',
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        setInlineAlert(errBox, '');
        submitBtn.disabled = true;
        submitBtn.textContent = '예약 중...';
        try {
          await apiFetch('/api/room-reservations', {
            method: 'POST',
            body: JSON.stringify({
              userId: user.id,
              roomId: Number(roomSelect.value),
              date: dateInput.value,
              startTime: startSelect.value,
              endTime: endSelect.value,
              title: titleInput.value.trim(),
              attendees: attendeesInput.value.trim(),
            }),
          });
          closeModal();
          showToast('회의실이 예약되었습니다.');
          await onAfterAction();
        } catch (err) {
          setInlineAlert(errBox, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = '예약하기';
        }
      },
    }, [
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '회의실 (마곡)' }),
        roomSelect,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '날짜' }),
        dateInput,
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', textContent: '시작 시각' }),
          startSelect,
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', textContent: '종료 시각' }),
          endSelect,
        ]),
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '회의 제목' }),
        titleInput,
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', textContent: '참석자' }),
        attendeesInput,
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [
        el('button', { type: 'button', className: 'btn btn-outline', textContent: '취소', onClick: closeModal }),
        submitBtn,
      ]),
    ]);

    openModal('회의실 예약', form);
    titleInput.focus();
  }

  function openReservationDetailModal(res, onAfterCancel) {
    const user = state.currentUser;
    const isMine = res.userId === user.id;
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const cancelBtn = isMine
      ? el('button', {
        type: 'button',
        className: 'btn btn-reject',
        textContent: '예약 취소',
        onClick: async (e) => {
          const btn = e.currentTarget;
          setInlineAlert(errBox, '');
          btn.disabled = true;
          try {
            await apiFetch(`/api/room-reservations/${encodeURIComponent(res.id)}/cancel`, {
              method: 'POST',
              body: JSON.stringify({ userId: user.id }),
            });
            closeModal();
            showToast('회의실 예약이 취소되었습니다.');
            await onAfterCancel();
          } catch (err) {
            setInlineAlert(errBox, err.message);
            btn.disabled = false;
          }
        },
      })
      : null;

    openModal(res.title || '예약 상세', el('div', { className: 'stack-md' }, [
      el('div', { className: 'detail-kv-grid' }, [
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '회의실' }),
          el('div', { className: 'detail-kv-value', textContent: res.roomName }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '일시' }),
          el('div', { className: 'detail-kv-value', textContent: `${res.date} · ${res.startTime} ~ ${res.endTime}` }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '예약자' }),
          el('div', { className: 'detail-kv-value', textContent: `${res.userName}${res.team ? ` (${res.team})` : ''}` }),
        ]),
        el('div', {}, [
          el('div', { className: 'detail-kv-label', textContent: '참석자' }),
          el('div', { className: 'detail-kv-value', textContent: res.attendees || '-' }),
        ]),
      ]),
      errBox,
      el('div', { className: 'form-actions' }, [
        cancelBtn,
        el('button', { type: 'button', className: 'btn btn-outline', textContent: '닫기', onClick: closeModal }),
      ]),
    ]));
  }

  async function renderRoomsRoute(seq) {
    const user = state.currentUser;
    if (!state.roomsDate) state.roomsDate = getLocalTodayISO();
    const todayStr = getLocalTodayISO();

    const refreshRoomsAndHome = async () => {
      await Promise.all([
        renderCurrentRoute(),
        apiFetch(`/api/home?userId=${encodeURIComponent(user.id)}`).catch(() => null),
      ]);
    };

    const [rooms, dayReservations, myReservations] = await Promise.all([
      apiFetch('/api/rooms'),
      apiFetch(`/api/room-reservations?date=${encodeURIComponent(state.roomsDate)}`),
      apiFetch(`/api/room-reservations/mine?userId=${encodeURIComponent(user.id)}`),
      syncNavBadgeFromServer(seq),
    ]);
    if (seq !== state.routeSeq) return;

    const roomList = Array.isArray(rooms) ? rooms : [];
    const dayList = Array.isArray(dayReservations) ? dayReservations : [];
    const mineList = Array.isArray(myReservations) ? myReservations : [];

    const dateInput = el('input', {
      type: 'date',
      className: 'form-control',
      value: state.roomsDate,
      'aria-label': '예약 조회 날짜 선택',
      onChange: (e) => {
        if (!e.target.value) return;
        state.roomsDate = e.target.value;
        renderCurrentRoute();
      },
    });
    dateInput.style.width = 'auto';

    const dateNav = el('div', { className: 'week-nav' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '< 이전',
        onClick: () => {
          state.roomsDate = shiftDateISO(state.roomsDate, -1);
          renderCurrentRoute();
        },
      }),
      el('button', {
        type: 'button',
        className: `btn btn-sm ${state.roomsDate === todayStr ? 'btn-primary' : 'btn-outline'}`,
        textContent: '오늘',
        onClick: () => {
          state.roomsDate = todayStr;
          renderCurrentRoute();
        },
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-sm btn-outline',
        textContent: '다음 >',
        onClick: () => {
          state.roomsDate = shiftDateISO(state.roomsDate, 1);
          renderCurrentRoute();
        },
      }),
      dateInput,
    ]);

    const hourHeaders = Array.from({ length: 12 }, (_, idx) =>
      el('th', {
        colspan: '2',
        className: 'tt-hour-head',
        textContent: String(8 + idx).padStart(2, '0'),
      })
    );

    const timetableBody = el('tbody', {}, roomList.map((room) => {
      const roomRes = dayList
        .filter((r) => r.roomId === room.id && r.status === 'reserved')
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      const cells = [];
      let slotIdx = 0;
      while (slotIdx < 24) {
        const hit = roomRes.find((r) => {
          const s = toSlotIndex(r.startTime);
          const e = toSlotIndex(r.endTime);
          return s <= slotIdx && slotIdx < e;
        });

        if (hit && toSlotIndex(hit.startTime) === slotIdx) {
          const endIdx = Math.min(24, Math.max(slotIdx + 1, toSlotIndex(hit.endTime)));
          const span = endIdx - slotIdx;
          const isMine = hit.userId === user.id;
          cells.push(el('td', { colspan: String(span), className: 'tt-booked-cell' }, [
            el('button', {
              type: 'button',
              className: `tt-booking${isMine ? ' is-mine' : ''}`,
              title: `${hit.startTime}~${hit.endTime} · ${hit.title} (${hit.userName})`,
              onClick: () => openReservationDetailModal(hit, refreshRoomsAndHome),
            }, [
              el('span', { className: 'tt-booking-title', textContent: hit.title }),
              el('span', { className: 'tt-booking-user', textContent: `${hit.userName} · ${hit.startTime}~${hit.endTime}` }),
            ]),
          ]));
          slotIdx += span;
        } else if (hit) {
          cells.push(el('td', { className: `tt-slot-cell${slotIdx % 2 === 1 ? ' is-hour-end' : ''}` }));
          slotIdx += 1;
        } else {
          const slotTime = ROOM_SLOTS[slotIdx];
          cells.push(el('td', { className: `tt-slot-cell${slotIdx % 2 === 1 ? ' is-hour-end' : ''}` }, [
            el('button', {
              type: 'button',
              className: 'tt-empty-btn',
              title: `${room.name} ${slotTime} 예약`,
              'aria-label': `${room.name} ${slotTime} 예약`,
              textContent: '+',
              onClick: () => openRoomBookingModal({
                rooms: roomList,
                prefillRoomId: room.id,
                prefillDate: state.roomsDate,
                prefillStart: slotTime,
                onAfterAction: refreshRoomsAndHome,
              }),
            }),
          ]));
          slotIdx += 1;
        }
      }

      return el('tr', {}, [
        el('th', { scope: 'row', className: 'tt-room-cell' }, [
          el('div', { className: 'tt-room-name', textContent: room.name }),
          el('div', {
            className: 'tt-room-meta',
            textContent: `${room.capacity}인${room.equipment ? ` · ${room.equipment}` : ''}`,
          }),
        ]),
        ...cells,
      ]);
    }));

    const desktopTimetable = el('div', { className: 'rooms-timetable-desktop tt-wrap' }, [
      el('table', { className: 'tt-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { className: 'tt-room-head', textContent: '회의실 \\ 시각' }),
            ...hourHeaders,
          ]),
        ]),
        timetableBody,
      ]),
    ]);

    const mobileList = el('div', { className: 'rooms-mobile-list' }, roomList.map((room) => {
      const roomRes = dayList
        .filter((r) => r.roomId === room.id && r.status === 'reserved')
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      return el('article', { className: 'card stack-sm' }, [
        el('div', { className: 'card-header' }, [
          el('div', {}, [
            el('h4', { className: 'card-title', textContent: room.name }),
            el('span', {
              className: 'page-subtitle',
              textContent: `${room.capacity}인${room.equipment ? ` · ${room.equipment}` : ''}`,
            }),
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-sm btn-primary',
            textContent: '+ 예약',
            onClick: () => openRoomBookingModal({
              rooms: roomList,
              prefillRoomId: room.id,
              prefillDate: state.roomsDate,
              prefillStart: '09:00',
              onAfterAction: refreshRoomsAndHome,
            }),
          }),
        ]),
        roomRes.length === 0
          ? el('div', { className: 'page-subtitle', textContent: '예약된 일정이 없습니다.' })
          : el('ul', { className: 'list-clean' }, roomRes.map((r) =>
            el('li', {}, [
              el('button', {
                type: 'button',
                className: 'list-item-row notice-btn-item',
                onClick: () => openReservationDetailModal(r, refreshRoomsAndHome),
              }, [
                el('div', { className: 'approval-summary-left' }, [
                  el('span', { className: 'meeting-time-pill', textContent: `${r.startTime}~${r.endTime}` }),
                  el('strong', { textContent: r.title }),
                ]),
                makeBadge(
                  r.userId === user.id ? `${r.userName} (내 예약)` : r.userName,
                  r.userId === user.id ? 'badge badge-working' : 'badge badge-neutral'
                ),
              ]),
            ])
          )),
      ]);
    }));

    const scheduleCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'rooms-toolbar' }, [
        el('div', { className: 'rooms-legend' }, [
          el('span', { className: 'rooms-legend-item' }, [el('span', { className: 'legend-swatch legend-swatch-free' }), '빈 칸 클릭 예약']),
          el('span', { className: 'rooms-legend-item' }, [el('span', { className: 'legend-swatch legend-swatch-mine' }), '내 예약']),
          el('span', { className: 'rooms-legend-item' }, [el('span', { className: 'legend-swatch legend-swatch-other' }), '다른 사람 예약']),
        ]),
        el('button', {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          textContent: '+ 회의실 예약',
          disabled: roomList.length === 0,
          onClick: () => openRoomBookingModal({
            rooms: roomList,
            prefillRoomId: roomList[0]?.id,
            prefillDate: state.roomsDate,
            prefillStart: '09:00',
            onAfterAction: refreshRoomsAndHome,
          }),
        }),
      ]),
      roomList.length === 0
        ? el('div', { className: 'state-box', textContent: '등록된 회의실이 없습니다.' })
        : desktopTimetable,
      roomList.length > 0 ? mobileList : null,
    ]);

    const mineErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const myCard = el('section', { className: 'card stack-md' }, [
      el('div', { className: 'card-header' }, [
        el('h3', { className: 'card-title', textContent: '내 다가오는 예약' }),
        makeBadge(`총 ${mineList.length}건`, 'badge badge-neutral'),
      ]),
      mineErrBox,
      mineList.length === 0
        ? el('div', { className: 'state-box', textContent: '예정된 회의실 예약이 없습니다.' })
        : el('div', { className: 'table-wrap' }, [
          el('table', { className: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { textContent: '날짜' }),
                el('th', { textContent: '시간' }),
                el('th', { textContent: '회의실' }),
                el('th', { textContent: '회의 제목' }),
                el('th', { textContent: '참석자' }),
                el('th', { textContent: '관리' }),
              ]),
            ]),
            el('tbody', {}, mineList.map((r) =>
              el('tr', {}, [
                el('td', { textContent: formatWorkDateWithDay(r.date) }),
                el('td', {}, [el('span', { className: 'meeting-time-pill', textContent: `${r.startTime} ~ ${r.endTime}` })]),
                el('td', {}, [makeBadge(r.roomName, 'badge badge-neutral')]),
                el('td', {}, [el('strong', { textContent: r.title })]),
                el('td', { textContent: r.attendees || '-' }),
                el('td', {}, [
                  el('button', {
                    type: 'button',
                    className: 'btn btn-sm btn-reject',
                    textContent: '취소',
                    onClick: async (e) => {
                      const btn = e.currentTarget;
                      setInlineAlert(mineErrBox, '');
                      btn.disabled = true;
                      try {
                        await apiFetch(`/api/room-reservations/${encodeURIComponent(r.id)}/cancel`, {
                          method: 'POST',
                          body: JSON.stringify({ userId: user.id }),
                        });
                        showToast('회의실 예약이 취소되었습니다.');
                        await refreshRoomsAndHome();
                      } catch (err) {
                        setInlineAlert(mineErrBox, err.message);
                        btn.disabled = false;
                      }
                    },
                  }),
                ]),
              ])
            )),
          ]),
        ]),
    ]);

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '회의실 예약 (마곡 사무실)' }),
            el('p', { className: 'page-subtitle', textContent: `${formatWorkDateWithDay(state.roomsDate)} · ${user.name} (${user.team})` }),
          ]),
          dateNav,
        ]),
        scheduleCard,
        myCard,
      ])
    );
  }

  /* ---------- Screen 7: Wiki Docs (#/docs) ---------- */

  const WIKI_TABLE_STATUS_CLASSES = {
    '완료': 'badge badge-approved',
    '진행 중': 'badge badge-submitted',
    '예정': 'badge badge-neutral',
  };

  function appendInlineMarkdown(parent, text) {
    const src = String(text || '');
    const tokenRe = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\))/g;
    let lastIdx = 0;
    let match;
    while ((match = tokenRe.exec(src)) !== null) {
      if (match.index > lastIdx) {
        parent.appendChild(document.createTextNode(src.slice(lastIdx, match.index)));
      }
      const token = match[0];
      if (token.startsWith('`') && token.endsWith('`')) {
        parent.appendChild(el('code', { className: 'wiki-inline-code', textContent: token.slice(1, -1) }));
      } else if (token.startsWith('**') && token.endsWith('**')) {
        const strong = el('strong');
        appendInlineMarkdown(strong, token.slice(2, -2));
        parent.appendChild(strong);
      } else if (token.startsWith('[')) {
        const linkMatch = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token);
        if (linkMatch && /^https?:\/\//i.test(linkMatch[2])) {
          parent.appendChild(el('a', {
            className: 'wiki-link',
            href: linkMatch[2],
            target: '_blank',
            rel: 'noopener noreferrer',
            textContent: linkMatch[1],
          }));
        } else {
          parent.appendChild(document.createTextNode(token));
        }
      }
      lastIdx = tokenRe.lastIndex;
    }
    if (lastIdx < src.length) {
      parent.appendChild(document.createTextNode(src.slice(lastIdx)));
    }
  }

  function splitPipeRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map((cell) => cell.trim());
  }

  function isPipeTableRow(line) {
    const t = line.trim();
    return t.startsWith('|') && t.includes('|', 1);
  }

  function isPipeTableSeparator(line) {
    if (!isPipeTableRow(line)) return false;
    const cells = splitPipeRow(line);
    return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
  }

  function normalizeHeadingText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function renderSafeMarkdown(container, markdownText) {
    const lines = String(markdownText || '').replace(/\r\n?/g, '\n').split('\n');
    const nodes = [];
    let headingCounter = 0;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (trimmed.startsWith('```')) {
        const codeLines = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        nodes.push(el('pre', { className: 'wiki-pre' }, [el('code', { textContent: codeLines.join('\n') })]));
        continue;
      }

      const headingMatch = /^(#{1,4})\s+(.*)$/.exec(trimmed);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = normalizeHeadingText(headingMatch[2]);
        headingCounter += 1;
        const hNode = el(`h${level}`, {
          id: `wiki-h-${headingCounter}`,
          className: `wiki-h${level}`,
          'data-heading': headingText,
        });
        appendInlineMarkdown(hNode, headingMatch[2].trim());
        nodes.push(hNode);
        i += 1;
        continue;
      }

      if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
        nodes.push(el('hr', { className: 'wiki-hr' }));
        i += 1;
        continue;
      }

      if (trimmed.startsWith('>')) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i += 1;
        }
        const quoteEl = el('blockquote', { className: 'wiki-quote' });
        quoteLines.forEach((ql, idx) => {
          if (idx > 0) quoteEl.appendChild(el('br'));
          appendInlineMarkdown(quoteEl, ql);
        });
        nodes.push(quoteEl);
        continue;
      }

      if (isPipeTableRow(line) && i + 1 < lines.length && isPipeTableSeparator(lines[i + 1])) {
        const headerCells = splitPipeRow(line);
        i += 2;
        const bodyRows = [];
        while (i < lines.length && isPipeTableRow(lines[i])) {
          bodyRows.push(splitPipeRow(lines[i]));
          i += 1;
        }

        const theadRow = el('tr', {}, headerCells.map((hText) => {
          const th = el('th');
          appendInlineMarkdown(th, hText);
          return th;
        }));
        const tbodyRows = bodyRows.map((rowCells) =>
          el('tr', {}, headerCells.map((_hdr, colIdx) => {
            const cellVal = rowCells[colIdx] ?? '';
            const td = el('td');
            const statusClass = WIKI_TABLE_STATUS_CLASSES[cellVal];
            if (statusClass) {
              td.appendChild(makeBadge(cellVal, statusClass));
            } else {
              appendInlineMarkdown(td, cellVal);
            }
            return td;
          }))
        );
        nodes.push(
          el('div', { className: 'table-wrap' }, [
            el('table', { className: 'wiki-table' }, [
              el('thead', {}, [theadRow]),
              el('tbody', {}, tbodyRows),
            ]),
          ])
        );
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const ul = el('ul', { className: 'wiki-list' });
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const li = el('li');
          appendInlineMarkdown(li, lines[i].replace(/^\s*[-*]\s+/, '').trim());
          ul.appendChild(li);
          i += 1;
        }
        nodes.push(ul);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const ol = el('ol', { className: 'wiki-ol' });
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          const li = el('li');
          appendInlineMarkdown(li, lines[i].replace(/^\s*\d+\.\s+/, '').trim());
          ol.appendChild(li);
          i += 1;
        }
        nodes.push(ol);
        continue;
      }

      const paraLines = [];
      while (i < lines.length) {
        const cur = lines[i];
        const curTrim = cur.trim();
        if (
          !curTrim ||
          curTrim.startsWith('```') ||
          /^(#{1,4})\s+/.test(curTrim) ||
          /^(?:---+|\*\*\*+|___+)$/.test(curTrim) ||
          curTrim.startsWith('>') ||
          /^\s*[-*]\s+/.test(cur) ||
          /^\s*\d+\.\s+/.test(cur) ||
          (isPipeTableRow(cur) && i + 1 < lines.length && isPipeTableSeparator(lines[i + 1]))
        ) {
          break;
        }
        paraLines.push(curTrim);
        i += 1;
      }
      if (paraLines.length > 0) {
        const pEl = el('p');
        paraLines.forEach((pl, idx) => {
          if (idx > 0) pEl.appendChild(el('br'));
          appendInlineMarkdown(pEl, pl);
        });
        nodes.push(pEl);
      }
    }

    container.replaceChildren(...nodes);
  }

  function parseDocLabels(labelsStr) {
    if (typeof labelsStr !== 'string') return [];
    return labelsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function navigateToDoc(docId, heading = '') {
    state.pendingDocHeading = heading || '';
    const nextHash = `#/docs/${encodeURIComponent(docId)}`;
    if (window.location.hash === nextHash) {
      renderCurrentRoute();
    } else {
      window.location.hash = nextHash;
    }
  }

  function scrollToDocHeading(markdownEl, targetHeading) {
    const query = normalizeHeadingText(targetHeading);
    if (!query || !markdownEl) return;
    const headings = Array.from(markdownEl.querySelectorAll('[data-heading]'));
    if (headings.length === 0) return;
    const lower = query.toLowerCase();
    const targetEl =
      headings.find((h) => (h.dataset.heading || '').toLowerCase() === lower) ||
      headings.find((h) => (h.dataset.heading || '').toLowerCase().includes(lower));
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      targetEl.classList.add('wiki-heading-flash');
      window.setTimeout(() => targetEl.classList.remove('wiki-heading-flash'), 2000);
    }
  }

  function buildDocsTreeCard(docsList, activeDocId) {
    const bySpace = new Map();
    for (const d of docsList) {
      const space = d.space || '일반';
      if (!bySpace.has(space)) bySpace.set(space, []);
      bySpace.get(space).push(d);
    }

    if (bySpace.size === 0) {
      return el('aside', { className: 'card docs-sidebar-card' }, [
        el('div', { className: 'state-box', textContent: '등록된 문서가 없습니다.' }),
      ]);
    }

    const groups = Array.from(bySpace.entries()).map(([space, items]) =>
      el('div', { className: 'docs-space-group' }, [
        el('div', { className: 'docs-space-title' }, [
          makeSvgIcon('folder', { size: 14 }),
          el('span', { textContent: space }),
        ]),
        el('ul', { className: 'docs-tree-list' }, items.map((d) =>
          el('li', {}, [
            el('a', {
              href: `#/docs/${encodeURIComponent(d.id)}`,
              className: `docs-tree-link${String(d.id) === String(activeDocId) ? ' is-active' : ''}`,
              onClick: () => {
                state.pendingDocHeading = '';
              },
            }, [
              el('span', { textContent: d.title }),
              d.docKey ? el('span', { className: 'docs-tree-key', textContent: d.docKey }) : null,
            ]),
          ])
        )),
      ])
    );

    return el('aside', { className: 'card docs-sidebar-card', 'aria-label': '스페이스별 문서 트리' }, groups);
  }

  function buildDocEditorCard({ isNew, doc, docsList, user }) {
    const errBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const existingSpaces = Array.from(new Set(docsList.map((d) => d.space).filter(Boolean)));

    let spaceSelect = null;
    let customSpaceInput = null;
    let spaceFieldNode = null;

    if (isNew) {
      customSpaceInput = el('input', {
        type: 'text',
        className: 'form-control',
        placeholder: '새 스페이스 이름 (예: 개발팀, 운영 매뉴얼)',
        maxLength: 80,
      });

      if (existingSpaces.length > 0) {
        spaceSelect = el('select', { className: 'form-control' }, [
          ...existingSpaces.map((sp) => el('option', { value: sp, textContent: sp })),
          el('option', { value: '__custom__', textContent: '+ 새 스페이스 직접 입력' }),
        ]);
        const syncCustomVisible = () => {
          setVisible(customSpaceInput, spaceSelect.value === '__custom__');
        };
        spaceSelect.addEventListener('change', syncCustomVisible);
        syncCustomVisible();
        spaceFieldNode = el('div', { className: 'stack-sm' }, [spaceSelect, customSpaceInput]);
      } else {
        setVisible(customSpaceInput, true);
        spaceFieldNode = customSpaceInput;
      }
    } else {
      spaceFieldNode = el('div', { className: 'approval-summary-left' }, [
        makeBadge(doc?.space || '-', 'badge badge-submitted'),
        doc?.docKey ? makeBadge(doc.docKey, 'badge badge-neutral') : null,
      ]);
    }

    const titleInput = el('input', {
      type: 'text',
      className: 'form-control',
      value: doc?.title || '',
      placeholder: '문서 제목을 입력하세요',
      maxLength: 140,
    });
    const labelsInput = el('input', {
      type: 'text',
      className: 'form-control',
      value: doc?.labels || '',
      placeholder: '예: 출시,마일스톤 (쉼표로 구분)',
      maxLength: 160,
    });
    const bodyTextarea = el('textarea', {
      className: 'form-control',
      rows: 16,
      placeholder: '마크다운으로 문서를 작성하세요 (# 제목, **굵게**, > 인용, - 목록, | 표 | 지원)',
    });
    bodyTextarea.value = doc?.body || '';

    const previewPane = el('div', { className: 'wiki-markdown' });
    const updatePreview = () => {
      renderSafeMarkdown(previewPane, bodyTextarea.value || '> 미리보기할 본문을 입력해 주세요.');
    };
    updatePreview();
    bodyTextarea.addEventListener('input', updatePreview);

    const cancelBtn = el('button', {
      type: 'button',
      className: 'btn btn-outline',
      textContent: '취소',
      onClick: () => {
        window.location.hash = isNew ? '#/docs' : `#/docs/${encodeURIComponent(doc.id)}`;
      },
    });
    const saveBtn = el('button', {
      type: 'button',
      className: 'btn btn-primary',
      textContent: isNew ? '문서 저장' : '수정 저장',
    });

    saveBtn.addEventListener('click', async () => {
      setInlineAlert(errBox, '');
      const title = titleInput.value.trim();
      const body = bodyTextarea.value;
      const labels = labelsInput.value.trim();
      let spaceVal = doc?.space || '';
      if (isNew) {
        spaceVal = spaceSelect && spaceSelect.value !== '__custom__'
          ? spaceSelect.value.trim()
          : (customSpaceInput ? customSpaceInput.value.trim() : '');
        if (!spaceVal) {
          setInlineAlert(errBox, '스페이스 이름을 선택하거나 입력해 주세요.');
          return;
        }
      }

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = '저장 중...';

      try {
        let saved;
        if (isNew) {
          saved = await apiFetch('/api/docs', {
            method: 'POST',
            body: JSON.stringify({
              userId: user.id,
              space: spaceVal,
              title,
              body,
              labels,
            }),
          });
        } else {
          saved = await apiFetch(`/api/docs/${encodeURIComponent(doc.id)}`, {
            method: 'PUT',
            body: JSON.stringify({
              userId: user.id,
              title,
              body,
              labels,
            }),
          });
        }
        showToast(isNew ? '새 문서가 등록되었습니다.' : '문서가 수정되었습니다.');
        state.docsSearchResults = null;
        window.location.hash = `#/docs/${encodeURIComponent(saved.id)}`;
      } catch (err) {
        setInlineAlert(errBox, err.message);
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = isNew ? '문서 저장' : '수정 저장';
      }
    });

    return el('section', { className: 'card docs-reader stack-md' }, [
      el('div', { className: 'docs-reader-top' }, [
        el('div', { className: 'docs-breadcrumb' }, [
          el('a', { href: '#/docs', textContent: '문서' }),
          el('span', { textContent: '/' }),
          el('strong', { textContent: isNew ? '새 문서 작성' : `${doc?.title || ''} 수정` }),
        ]),
      ]),
      el('div', { className: 'form-stack' }, [
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', textContent: '스페이스' }),
          spaceFieldNode,
        ]),
        el('div', { className: 'form-row-2' }, [
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', textContent: '제목' }),
            titleInput,
          ]),
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', textContent: '라벨 (쉼표 구분)' }),
            labelsInput,
          ]),
        ]),
        el('div', { className: 'doc-editor-grid' }, [
          el('div', { className: 'form-group' }, [
            el('label', { className: 'form-label', textContent: '본문 (마크다운)' }),
            bodyTextarea,
          ]),
          el('div', { className: 'form-group' }, [
            el('span', { className: 'form-label', textContent: '실시간 미리보기' }),
            el('div', { className: 'doc-preview-box' }, [previewPane]),
          ]),
        ]),
        errBox,
        el('div', { className: 'form-actions' }, [cancelBtn, saveBtn]),
      ]),
    ]);
  }

  async function renderDocsRoute(seq) {
    const user = state.currentUser;
    const docsListRaw = await Promise.all([
      apiFetch('/api/docs'),
      syncNavBadgeFromServer(seq),
    ]).then(([list]) => list);
    if (seq !== state.routeSeq) return;

    const docsList = Array.isArray(docsListRaw) ? docsListRaw : [];
    const targetDocId = state.docMode === 'view' && !state.docId && docsList[0]
      ? String(docsList[0].id)
      : state.docId;

    let activeDoc = null;
    let docLoadError = '';
    if ((state.docMode === 'view' || state.docMode === 'edit') && targetDocId) {
      try {
        activeDoc = await apiFetch(`/api/docs/${encodeURIComponent(targetDocId)}`);
      } catch (err) {
        docLoadError = err.message;
      }
      if (seq !== state.routeSeq) return;
    }

    const searchErrBox = el('div', { className: 'alert alert-error is-hidden', role: 'alert', hidden: true });
    const searchInput = el('input', {
      type: 'search',
      className: 'form-control docs-search-input',
      value: state.docsSearchQuery || '',
      placeholder: '제목, 본문, 이슈 키(GW-101) 검색...',
      'aria-label': '문서 검색',
    });
    const searchBtn = el('button', {
      type: 'submit',
      className: 'btn btn-outline btn-icon-label',
    }, [makeSvgIcon('search', { size: 15 }), el('span', { textContent: '검색' })]);
    const clearSearchBtn = state.docsSearchResults !== null
      ? el('button', {
        type: 'button',
        className: 'btn btn-outline btn-sm',
        textContent: '검색 닫기',
        onClick: () => {
          state.docsSearchQuery = '';
          state.docsSearchResults = null;
          renderCurrentRoute();
        },
      })
      : null;

    const searchForm = el('form', {
      className: 'docs-search-form',
      onSubmit: async (e) => {
        e.preventDefault();
        setInlineAlert(searchErrBox, '');
        const q = searchInput.value.trim();
        if (!q) {
          state.docsSearchQuery = '';
          state.docsSearchResults = null;
          await renderCurrentRoute();
          return;
        }
        searchBtn.disabled = true;
        try {
          const hits = await apiFetch(`/api/docs/search?q=${encodeURIComponent(q)}&limit=5`);
          state.docsSearchQuery = q;
          state.docsSearchResults = Array.isArray(hits) ? hits : [];
          await renderCurrentRoute();
        } catch (err) {
          setInlineAlert(searchErrBox, err.message);
        } finally {
          searchBtn.disabled = false;
        }
      },
    }, [searchInput, searchBtn, clearSearchBtn]);

    const newDocBtn = el('a', {
      href: '#/docs/new',
      className: 'btn btn-primary btn-icon-label',
    }, [makeSvgIcon('plus', { size: 15 }), el('span', { textContent: '새 문서' })]);

    let searchResultsCard = null;
    if (Array.isArray(state.docsSearchResults)) {
      const hits = state.docsSearchResults;
      searchResultsCard = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'card-header' }, [
          el('h3', { className: 'card-title', textContent: `"${state.docsSearchQuery}" 검색 결과` }),
          makeBadge(`${hits.length}건`, 'badge badge-neutral'),
        ]),
        hits.length === 0
          ? el('div', { className: 'state-box', textContent: '일치하는 문서 구간을 찾지 못했습니다.' })
          : el('div', { className: 'docs-search-list' }, hits.map((hit) =>
            el('button', {
              type: 'button',
              className: 'docs-search-item',
              onClick: () => navigateToDoc(hit.docId, hit.heading || ''),
            }, [
              el('div', { className: 'docs-search-meta' }, [
                makeBadge(hit.space || '문서', 'badge badge-neutral'),
                el('strong', { textContent: hit.title || `문서 #${hit.docId}` }),
                hit.heading ? makeBadge(`> ${hit.heading}`, 'badge badge-submitted') : null,
              ]),
              el('p', { className: 'docs-search-excerpt', textContent: hit.excerpt || '' }),
            ])
          )),
      ]);
    }

    let rightPane = null;
    let renderedMarkdownEl = null;

    if (state.docMode === 'new') {
      rightPane = buildDocEditorCard({ isNew: true, doc: null, docsList, user });
    } else if (state.docMode === 'edit') {
      rightPane = docLoadError
        ? el('section', { className: 'card stack-md' }, [
          el('div', { className: 'alert alert-error', textContent: docLoadError }),
          el('div', { className: 'form-actions' }, [
            el('a', { href: '#/docs', className: 'btn btn-outline', textContent: '문서 목록으로' }),
          ]),
        ])
        : buildDocEditorCard({ isNew: false, doc: activeDoc, docsList, user });
    } else if (docLoadError) {
      rightPane = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'alert alert-error', textContent: docLoadError }),
        el('div', { className: 'form-actions' }, [
          el('a', { href: '#/docs', className: 'btn btn-outline', textContent: '첫 문서 보기' }),
        ]),
      ]);
    } else if (!activeDoc) {
      rightPane = el('section', { className: 'card stack-md' }, [
        el('div', { className: 'state-box', textContent: '아직 작성된 문서가 없습니다. 첫 위키 문서를 작성해 보세요.' }),
        el('div', { className: 'form-actions' }, [
          el('a', { href: '#/docs/new', className: 'btn btn-primary', textContent: '첫 문서 작성' }),
        ]),
      ]);
    } else {
      const labelChips = parseDocLabels(activeDoc.labels).map((lbl) => makeBadge(lbl, 'badge badge-neutral'));
      renderedMarkdownEl = el('article', { className: 'wiki-markdown' });
      renderSafeMarkdown(renderedMarkdownEl, activeDoc.body);

      rightPane = el('section', { className: 'card docs-reader stack-md' }, [
        el('div', { className: 'docs-reader-top' }, [
          el('div', { className: 'docs-breadcrumb' }, [
            el('a', { href: '#/docs', textContent: '문서' }),
            el('span', { textContent: '/' }),
            el('span', { textContent: activeDoc.space || '일반' }),
            el('span', { textContent: '/' }),
            el('strong', { textContent: activeDoc.title }),
            activeDoc.docKey ? makeBadge(activeDoc.docKey, 'badge badge-neutral') : null,
          ]),
          el('a', {
            href: `#/docs/${encodeURIComponent(activeDoc.id)}/edit`,
            className: 'btn btn-sm btn-outline btn-icon-label',
          }, [makeSvgIcon('edit', { size: 14 }), el('span', { textContent: '편집' })]),
        ]),
        el('div', { className: 'docs-article-head' }, [
          el('h1', { className: 'docs-article-title', textContent: activeDoc.title }),
          el('div', { className: 'docs-meta-row' }, [
            el('div', { className: 'docs-labels' }, labelChips),
            el('span', {
              className: 'docs-meta-text',
              textContent: `최종 수정 ${activeDoc.updatedByName || activeDoc.authorName || '-'} · ${formatDateTime(activeDoc.updatedAt)}`,
            }),
          ]),
        ]),
        renderedMarkdownEl,
      ]);
    }

    dom.routeView.replaceChildren(
      el('div', { className: 'stack-lg' }, [
        el('div', { className: 'page-header' }, [
          el('div', {}, [
            el('h2', { className: 'page-title', textContent: '문서' }),
            el('p', { className: 'page-subtitle', textContent: '프로젝트 일정, 사내 가이드 및 지식을 스페이스별로 정리합니다.' }),
          ]),
          el('div', { className: 'docs-toolbar' }, [searchForm, newDocBtn]),
        ]),
        searchErrBox,
        searchResultsCard,
        el('div', { className: 'docs-workspace' }, [
          buildDocsTreeCard(docsList, activeDoc?.id),
          rightPane,
        ]),
      ])
    );

    const headingTarget = state.pendingDocHeading || window.__groupwareDocTargetHeading || '';
    state.pendingDocHeading = '';
    window.__groupwareDocTargetHeading = '';
    if (headingTarget && renderedMarkdownEl) {
      scrollToDocHeading(renderedMarkdownEl, headingTarget);
    }
  }

  /* ---------- Route Dispatcher & Bootstrap ---------- */

  async function renderCurrentRoute() {
    const parsed = parseHashState();
    state.route = parsed.route;
    state.approvalKind = parsed.approvalKind;
    state.docMode = parsed.docMode;
    state.docId = parsed.docId;

    if (state.currentUser && state.currentUser.role === 'executive') {
      const rawBase = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0].trim().toLowerCase();
      if (rawBase && !EXEC_ROUTES.includes(rawBase)) {
        window.history.replaceState(null, '', '#/home');
      }
    }
    syncSidebarForUser(state.currentUser);
    showGlobalError('');

    if (!state.currentUser) {
      dom.routeView.replaceChildren(
        el('div', { className: 'card state-box', textContent: '선택된 사용자가 없습니다.' })
      );
      return;
    }

    const seq = ++state.routeSeq;
    renderLoadingState();

    try {
      if (state.route === 'home') {
        await renderHomeRoute(seq);
      } else if (state.route === 'attendance') {
        await renderAttendanceRoute(seq);
      } else if (state.route === 'weekly') {
        await renderWeeklyRoute(seq);
      } else if (state.route === 'leave') {
        await renderLeaveRoute(seq);
      } else if (state.route === 'approvals') {
        await renderApprovalsRoute(seq);
      } else if (state.route === 'docs') {
        await renderDocsRoute(seq);
      } else if (state.route === 'rooms') {
        await renderRoomsRoute(seq);
      }
    } catch (err) {
      if (seq !== state.routeSeq) return;
      showGlobalError(err.message);
      dom.routeView.replaceChildren(
        el('div', { className: 'card state-box', textContent: '화면을 불러오지 못했습니다. 상단의 다시 시도를 눌러 주세요.' })
      );
    }
  }

  function populateUserSelect(users) {
    if (!Array.isArray(users) || users.length === 0) {
      dom.userSelect.replaceChildren(el('option', { value: '', textContent: '등록된 사용자 없음' }));
      dom.userSelect.disabled = true;
      state.currentUser = null;
      renderHeaderForUser(null);
      return;
    }

    const groups = new Map();
    for (const u of users) {
      const team = u.team || '기타';
      if (!groups.has(team)) groups.set(team, []);
      groups.get(team).push(u);
    }

    const optgroups = Array.from(groups.entries()).map(([team, members]) =>
      el('optgroup', { label: team }, members.map((u) => {
        const roleLabel = ROLE_META[u.role]?.label || u.role;
        return el('option', { value: String(u.id), textContent: `${u.name} · ${roleLabel}` });
      }))
    );

    dom.userSelect.replaceChildren(...optgroups);
    dom.userSelect.disabled = false;

    const storedId = readStoredUserId();
    const matched = users.find((u) => String(u.id) === storedId) || users[0];
    state.currentUser = matched;
    dom.userSelect.value = String(matched.id);
    writeStoredUserId(matched.id);
    renderHeaderForUser(matched);
  }

  async function initUsersAndStart() {
    showGlobalError('');
    dom.userSelect.disabled = true;
    renderLoadingState('사용자 정보를 불러오는 중입니다...');
    try {
      const users = await apiFetch('/api/users');
      state.users = Array.isArray(users) ? users : [];
      populateUserSelect(state.users);
      await renderCurrentRoute();
    } catch (err) {
      showGlobalError(err.message);
      dom.userSelect.replaceChildren(el('option', { value: '', textContent: '사용자 불러오기 실패' }));
      dom.routeView.replaceChildren(
        el('div', { className: 'card state-box', textContent: '서버 연결 후 다시 시도해 주세요.' })
      );
    }
  }

  function bindGlobalEvents() {
    window.addEventListener('hashchange', () => {
      closeModal();
      renderCurrentRoute();
    });

    dom.userSelect.addEventListener('change', async () => {
      const selectedId = dom.userSelect.value;
      const nextUser = state.users.find((u) => String(u.id) === selectedId) || null;
      if (!nextUser) return;
      state.currentUser = nextUser;
      state.approvalsTab = 'pending';
      state.employeeWeekStart = '';
      state.managerWeekStart = '';
      state.execWeekStart = '';
      state.execSelectedTeam = null;
      writeStoredUserId(nextUser.id);
      closeModal();
      renderHeaderForUser(nextUser);
      await renderCurrentRoute();
    });

    dom.globalRetryBtn.addEventListener('click', () => {
      if (state.users.length === 0) {
        initUsersAndStart();
      } else {
        renderCurrentRoute();
      }
    });

    dom.modalCloseBtn.addEventListener('click', closeModal);
    dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.modalBackdrop) closeModal();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dom.modalBackdrop.hidden) closeModal();
    });

    dom.toastCloseBtn.addEventListener('click', () => {
      if (state.toastTimer) window.clearTimeout(state.toastTimer);
      setVisible(dom.toast, false);
    });
  }

  function bootstrap() {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/home');
    }
    state.attendanceMonth = getLocalMonthISO();
    state.leaveCalendarMonth = getLocalMonthISO();
    state.roomsDate = getLocalTodayISO();
    window.groupwareRefresh = () => renderCurrentRoute();
    bindGlobalEvents();
    initUsersAndStart();
  }

  bootstrap();
})();
