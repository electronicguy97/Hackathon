(() => {
  'use strict';

  const STORAGE_KEY = 'groupware.selectedUserId';

  const TYPE_LABELS = {
    annual: '연차',
    half_am: '오전 반차',
    half_pm: '오후 반차',
  };

  const STATUS_META = {
    pending: { label: '대기', className: 'badge badge-pending' },
    approved: { label: '승인', className: 'badge badge-approved' },
    rejected: { label: '반려', className: 'badge badge-rejected' },
  };

  const ROLE_META = {
    employee: { label: '사원', className: 'role-badge role-badge-employee' },
    manager: { label: '팀장', className: 'role-badge role-badge-manager' },
  };

  const state = {
    users: [],
    currentUser: null,
    activeTab: 'my-leave',
    balance: null,
    myRequests: [],
    approvals: [],
    loadSeq: 0,
    toastTimer: null,
  };

  const dom = {
    tabMyLeave: document.getElementById('tab-my-leave'),
    tabApprovals: document.getElementById('tab-approvals'),
    approvalsBadge: document.getElementById('approvals-badge'),
    userSelect: document.getElementById('user-select'),
    roleBadge: document.getElementById('role-badge'),

    globalError: document.getElementById('global-error'),
    globalErrorText: document.getElementById('global-error-text'),
    globalRetryBtn: document.getElementById('global-retry-btn'),

    sectionMyLeave: document.getElementById('section-my-leave'),
    sectionApprovals: document.getElementById('section-approvals'),
    currentUserMeta: document.getElementById('current-user-meta'),
    focusRequestBtn: document.getElementById('focus-request-btn'),

    balanceRemaining: document.getElementById('balance-remaining'),
    balanceAvailableHint: document.getElementById('balance-available-hint'),
    balanceUsed: document.getElementById('balance-used'),
    balancePending: document.getElementById('balance-pending'),
    balanceTotal: document.getElementById('balance-total'),

    requestCard: document.getElementById('request-card'),
    leaveRequestForm: document.getElementById('leave-request-form'),
    leaveType: document.getElementById('leave-type'),
    startDate: document.getElementById('start-date'),
    endDate: document.getElementById('end-date'),
    halfDayHint: document.getElementById('half-day-hint'),
    daysPreview: document.getElementById('days-preview'),
    leaveReason: document.getElementById('leave-reason'),
    requestError: document.getElementById('request-error'),
    resetFormBtn: document.getElementById('reset-form-btn'),
    submitRequestBtn: document.getElementById('submit-request-btn'),

    requestsCount: document.getElementById('requests-count'),
    requestsLoading: document.getElementById('requests-loading'),
    requestsEmpty: document.getElementById('requests-empty'),
    requestsTableWrap: document.getElementById('requests-table-wrap'),
    requestsTbody: document.getElementById('requests-tbody'),

    approvalsSubtitle: document.getElementById('approvals-subtitle'),
    approvalsCountPill: document.getElementById('approvals-count-pill'),
    approvalsError: document.getElementById('approvals-error'),
    approvalsLoading: document.getElementById('approvals-loading'),
    approvalsEmpty: document.getElementById('approvals-empty'),
    approvalsList: document.getElementById('approvals-list'),

    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    toastCloseBtn: document.getElementById('toast-close-btn'),
  };

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
      // Ignore storage errors in restricted browser contexts.
    }
  }

  function getLocalTodayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDateUTC(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return null;
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcMs = Date.UTC(y, m - 1, d);
    const dt = new Date(utcMs);
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return utcMs;
  }

  function formatDays(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return '-';
    }
    const rounded = Math.round(num * 10) / 10;
    return `${rounded}일`;
  }

  function formatPeriod(startDate, endDate) {
    if (!startDate) {
      return '-';
    }
    if (!endDate || startDate === endDate) {
      return startDate;
    }
    return `${startDate} ~ ${endDate}`;
  }

  function formatIsoDate(isoStr) {
    if (!isoStr) {
      return '-';
    }
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) {
      return String(isoStr).slice(0, 10);
    }
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isHalfDay(type) {
    return type === 'half_am' || type === 'half_pm';
  }

  function calculatePreviewDays(type, startDateStr, endDateStr) {
    const startMs = parseDateUTC(startDateStr);
    if (isHalfDay(type)) {
      if (startMs === null) {
        return { valid: false, text: '시작일을 선택하세요' };
      }
      const dayOfWeek = new Date(startMs).getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { valid: false, text: '0일 (주말 선택 불가)' };
      }
      return { valid: true, text: '0.5일 (반차)' };
    }

    if (startMs === null) {
      return { valid: false, text: '시작일을 선택하세요' };
    }
    const endMs = parseDateUTC(endDateStr);
    if (endMs === null) {
      return { valid: false, text: '종료일을 선택하세요' };
    }
    if (endMs < startMs) {
      return { valid: false, text: '종료일이 시작일보다 빠릅니다' };
    }

    const dayMs = 24 * 60 * 60 * 1000;
    let totalDays = 0;
    let weekdays = 0;
    for (let cur = startMs; cur <= endMs; cur += dayMs) {
      totalDays += 1;
      const dow = new Date(cur).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        weekdays += 1;
      }
    }

    if (weekdays === 0) {
      return { valid: false, text: '0일 (주말만 포함됨)' };
    }
    if (totalDays > weekdays) {
      return { valid: true, text: `${weekdays}일 (주말 제외)` };
    }
    return { valid: true, text: `${weekdays}일` };
  }

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
      const apiError =
        payload && typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : `요청 처리에 실패했습니다. (HTTP ${response.status})`;
      const err = new Error(apiError);
      err.status = response.status;
      throw err;
    }

    return payload;
  }

  function showToast(message) {
    if (state.toastTimer) {
      window.clearTimeout(state.toastTimer);
    }
    dom.toastText.textContent = message;
    setVisible(dom.toast, true);
    state.toastTimer = window.setTimeout(() => {
      setVisible(dom.toast, false);
    }, 3500);
  }

  function showGlobalError(message) {
    dom.globalErrorText.textContent = message;
    setVisible(dom.globalError, Boolean(message));
  }

  function showBoxError(element, message) {
    element.textContent = message || '';
    setVisible(element, Boolean(message));
  }

  function setActiveTab(tabName) {
    const canSeeApprovals = state.currentUser && state.currentUser.role === 'manager';
    const nextTab = tabName === 'approvals' && canSeeApprovals ? 'approvals' : 'my-leave';
    state.activeTab = nextTab;

    const isMyLeave = nextTab === 'my-leave';
    dom.tabMyLeave.classList.toggle('is-active', isMyLeave);
    dom.tabMyLeave.setAttribute('aria-selected', String(isMyLeave));

    dom.tabApprovals.classList.toggle('is-active', !isMyLeave);
    dom.tabApprovals.setAttribute('aria-selected', String(!isMyLeave));

    setVisible(dom.sectionMyLeave, isMyLeave);
    setVisible(dom.sectionApprovals, !isMyLeave);
  }

  function syncDateConstraintsAndPreview() {
    const type = dom.leaveType.value;
    const half = isHalfDay(type);

    if (half) {
      if (dom.startDate.value) {
        dom.endDate.value = dom.startDate.value;
      }
      dom.endDate.disabled = true;
      setVisible(dom.halfDayHint, true);
    } else {
      dom.endDate.disabled = false;
      setVisible(dom.halfDayHint, false);
      if (dom.startDate.value && (!dom.endDate.value || dom.endDate.value < dom.startDate.value)) {
        dom.endDate.value = dom.startDate.value;
      }
    }

    const preview = calculatePreviewDays(type, dom.startDate.value, dom.endDate.value);
    dom.daysPreview.textContent = preview.text;
    dom.daysPreview.classList.toggle('is-invalid', !preview.valid);
  }

  function resetRequestForm() {
    const today = getLocalTodayISO();
    dom.leaveType.value = 'annual';
    dom.startDate.value = today;
    dom.endDate.value = today;
    dom.leaveReason.value = '';
    showBoxError(dom.requestError, '');
    syncDateConstraintsAndPreview();
  }

  function renderHeaderForUser(user) {
    if (!user) {
      setVisible(dom.roleBadge, false);
      setVisible(dom.tabApprovals, false);
      dom.currentUserMeta.textContent = '선택된 사용자가 없습니다.';
      return;
    }

    const roleInfo = ROLE_META[user.role] || {
      label: user.role,
      className: 'role-badge role-badge-employee',
    };
    dom.roleBadge.textContent = roleInfo.label;
    dom.roleBadge.className = roleInfo.className;
    setVisible(dom.roleBadge, true);

    const isManager = user.role === 'manager';
    setVisible(dom.tabApprovals, isManager);
    if (!isManager) {
      setVisible(dom.approvalsBadge, false);
    }

    dom.currentUserMeta.textContent = `${user.name} · ${user.team} (${roleInfo.label})`;
    dom.approvalsSubtitle.textContent = `${user.team} 구성원의 승인 대기 요청을 확인하고 결재합니다.`;
    setActiveTab(state.activeTab);
  }

  function renderBalance(balance) {
    if (!balance) {
      dom.balanceRemaining.textContent = '-';
      dom.balanceUsed.textContent = '-';
      dom.balancePending.textContent = '-';
      dom.balanceTotal.textContent = '-';
      dom.balanceAvailableHint.textContent = '승인 대기 차감 기준 확인';
      return;
    }

    dom.balanceRemaining.textContent = formatDays(balance.remaining);
    dom.balanceUsed.textContent = formatDays(balance.used);
    dom.balancePending.textContent = formatDays(balance.pending);
    dom.balanceTotal.textContent = formatDays(balance.total);

    const available = Math.max(0, Math.round((Number(balance.remaining) - Number(balance.pending)) * 10) / 10);
    dom.balanceAvailableHint.textContent = `추가 신청 가능: ${formatDays(available)}`;
  }

  function createBadge(text, className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function renderMyRequests(requests, isLoading) {
    setVisible(dom.requestsLoading, isLoading);
    if (isLoading) {
      setVisible(dom.requestsEmpty, false);
      setVisible(dom.requestsTableWrap, false);
      return;
    }

    const list = Array.isArray(requests) ? requests : [];
    dom.requestsCount.textContent = `총 ${list.length}건`;

    if (list.length === 0) {
      setVisible(dom.requestsEmpty, true);
      setVisible(dom.requestsTableWrap, false);
      dom.requestsTbody.replaceChildren();
      return;
    }

    setVisible(dom.requestsEmpty, false);
    setVisible(dom.requestsTableWrap, true);

    const rows = list.map((item) => {
      const tr = document.createElement('tr');

      const tdPeriod = document.createElement('td');
      const periodMain = document.createElement('div');
      periodMain.className = 'period-main';
      periodMain.textContent = formatPeriod(item.startDate, item.endDate);
      const periodSub = document.createElement('div');
      periodSub.className = 'period-sub';
      periodSub.textContent = `신청 ${formatIsoDate(item.createdAt)}`;
      tdPeriod.append(periodMain, periodSub);

      const tdType = document.createElement('td');
      tdType.appendChild(
        createBadge(TYPE_LABELS[item.type] || item.type || '-', 'badge badge-type')
      );

      const tdDays = document.createElement('td');
      tdDays.textContent = formatDays(item.days);

      const tdReason = document.createElement('td');
      tdReason.className = 'reason-cell';
      tdReason.textContent = item.reason || '-';

      const tdStatus = document.createElement('td');
      const statusMeta = STATUS_META[item.status] || {
        label: item.status || '-',
        className: 'badge badge-type',
      };
      tdStatus.appendChild(createBadge(statusMeta.label, statusMeta.className));

      const tdComment = document.createElement('td');
      tdComment.className = 'comment-cell';
      if (item.comment && String(item.comment).trim()) {
        tdComment.textContent = item.approverName
          ? `${item.comment} (${item.approverName})`
          : item.comment;
      } else if (item.approverName && item.status !== 'pending') {
        tdComment.textContent = `${item.approverName} 처리`;
      } else {
        tdComment.textContent = '-';
      }

      tr.append(tdPeriod, tdType, tdDays, tdReason, tdStatus, tdComment);
      return tr;
    });

    dom.requestsTbody.replaceChildren(...rows);
  }

  function renderApprovals(approvals, isLoading) {
    const isManager = state.currentUser && state.currentUser.role === 'manager';
    if (!isManager) {
      dom.approvalsList.replaceChildren();
      setVisible(dom.approvalsBadge, false);
      return;
    }

    setVisible(dom.approvalsLoading, isLoading);
    if (isLoading) {
      setVisible(dom.approvalsEmpty, false);
      dom.approvalsList.replaceChildren();
      return;
    }

    const list = Array.isArray(approvals) ? approvals : [];
    dom.approvalsCountPill.textContent = `대기 ${list.length}건`;
    dom.approvalsBadge.textContent = String(list.length);
    setVisible(dom.approvalsBadge, list.length > 0);

    if (list.length === 0) {
      setVisible(dom.approvalsEmpty, true);
      dom.approvalsList.replaceChildren();
      return;
    }

    setVisible(dom.approvalsEmpty, false);

    const cards = list.map((item) => {
      const card = document.createElement('article');
      card.className = 'approval-card';

      const top = document.createElement('div');
      top.className = 'approval-top';

      const applicant = document.createElement('div');
      applicant.className = 'approval-applicant';
      const nameEl = document.createElement('strong');
      nameEl.className = 'applicant-name';
      nameEl.textContent = item.userName || `사용자 #${item.userId}`;
      applicant.append(
        nameEl,
        createBadge(TYPE_LABELS[item.type] || item.type || '-', 'badge badge-type')
      );

      const dateEl = document.createElement('span');
      dateEl.className = 'approval-date';
      dateEl.textContent = `신청일: ${formatIsoDate(item.createdAt)}`;
      top.append(applicant, dateEl);

      const meta = document.createElement('div');
      meta.className = 'approval-meta';

      const metaEntries = [
        ['기간', formatPeriod(item.startDate, item.endDate)],
        ['일수', formatDays(item.days)],
        ['사유', item.reason || '-'],
      ];
      for (const [label, value] of metaEntries) {
        const entry = document.createElement('div');
        entry.className = 'approval-meta-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'approval-meta-label';
        labelEl.textContent = `${label}:`;
        const valueEl = document.createElement('span');
        valueEl.className = 'approval-meta-value';
        valueEl.textContent = value;
        entry.append(labelEl, valueEl);
        meta.appendChild(entry);
      }

      const actions = document.createElement('div');
      actions.className = 'approval-actions';

      const commentInput = document.createElement('input');
      commentInput.type = 'text';
      commentInput.className = 'form-control approval-comment-input';
      commentInput.placeholder = '결재 의견을 입력하세요 (선택)';
      commentInput.setAttribute('aria-label', `${item.userName || '신청자'} 결재 의견`);

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'btn btn-reject';
      rejectBtn.textContent = '반려';

      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.className = 'btn btn-approve';
      approveBtn.textContent = '승인';

      const handleDecision = async (decision) => {
        if (!state.currentUser) {
          return;
        }
        showBoxError(dom.approvalsError, '');
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        commentInput.disabled = true;

        try {
          await apiFetch(
            `/api/leave-requests/${encodeURIComponent(item.id)}/${decision}`,
            {
              method: 'POST',
              body: JSON.stringify({
                approverId: state.currentUser.id,
                comment: commentInput.value.trim(),
              }),
            }
          );
          showToast(decision === 'approve' ? '승인 처리되었습니다.' : '반려 처리되었습니다.');
          await loadUserData();
        } catch (err) {
          showBoxError(dom.approvalsError, err.message);
          approveBtn.disabled = false;
          rejectBtn.disabled = false;
          commentInput.disabled = false;
        }
      };

      approveBtn.addEventListener('click', () => handleDecision('approve'));
      rejectBtn.addEventListener('click', () => handleDecision('reject'));

      actions.append(commentInput, rejectBtn, approveBtn);
      card.append(top, meta, actions);
      return card;
    });

    dom.approvalsList.replaceChildren(...cards);
  }

  async function loadUserData() {
    const user = state.currentUser;
    if (!user) {
      renderBalance(null);
      renderMyRequests([], false);
      renderApprovals([], false);
      return;
    }

    const seq = ++state.loadSeq;
    const isManager = user.role === 'manager';

    showGlobalError('');
    renderMyRequests([], true);
    if (isManager) {
      renderApprovals([], true);
    }

    const encodedId = encodeURIComponent(user.id);
    const requests = [
      apiFetch(`/api/users/${encodedId}/balance`),
      apiFetch(`/api/leave-requests?userId=${encodedId}`),
      isManager
        ? apiFetch(`/api/approvals?approverId=${encodedId}`)
        : Promise.resolve([]),
    ];

    try {
      const [balance, myRequests, approvals] = await Promise.all(requests);
      if (seq !== state.loadSeq) {
        return;
      }
      state.balance = balance;
      state.myRequests = Array.isArray(myRequests) ? myRequests : [];
      state.approvals = Array.isArray(approvals) ? approvals : [];

      renderBalance(state.balance);
      renderMyRequests(state.myRequests, false);
      renderApprovals(state.approvals, false);
    } catch (err) {
      if (seq !== state.loadSeq) {
        return;
      }
      showGlobalError(err.message);
      renderMyRequests([], false);
      if (isManager) {
        renderApprovals([], false);
      }
    }
  }

  function populateUserSelect(users) {
    if (!Array.isArray(users) || users.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '등록된 사용자 없음';
      dom.userSelect.replaceChildren(opt);
      dom.userSelect.disabled = true;
      state.currentUser = null;
      renderHeaderForUser(null);
      return;
    }

    const options = users.map((u) => {
      const opt = document.createElement('option');
      opt.value = String(u.id);
      opt.textContent = `${u.name} (${u.team})`;
      return opt;
    });
    dom.userSelect.replaceChildren(...options);
    dom.userSelect.disabled = false;

    const storedId = readStoredUserId();
    const matched = users.find((u) => String(u.id) === storedId) || users[0];
    state.currentUser = matched;
    dom.userSelect.value = String(matched.id);
    writeStoredUserId(matched.id);
    renderHeaderForUser(matched);
  }

  async function initUsersAndLoad() {
    showGlobalError('');
    dom.userSelect.disabled = true;

    try {
      const users = await apiFetch('/api/users');
      state.users = Array.isArray(users) ? users : [];
      populateUserSelect(state.users);
      await loadUserData();
    } catch (err) {
      showGlobalError(err.message);
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '사용자 불러오기 실패';
      dom.userSelect.replaceChildren(opt);
      dom.userSelect.disabled = true;
    }
  }

  async function handleRequestSubmit(event) {
    event.preventDefault();
    if (!state.currentUser) {
      return;
    }

    showBoxError(dom.requestError, '');
    const type = dom.leaveType.value;
    const startDate = dom.startDate.value;
    const endDate = isHalfDay(type) ? startDate : dom.endDate.value;
    const reason = dom.leaveReason.value.trim();

    dom.submitRequestBtn.disabled = true;
    dom.submitRequestBtn.textContent = '신청 중...';

    try {
      await apiFetch('/api/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          userId: state.currentUser.id,
          type,
          startDate,
          endDate,
          reason,
        }),
      });
      dom.leaveReason.value = '';
      showToast('연차 신청이 접수되었습니다.');
      await loadUserData();
    } catch (err) {
      showBoxError(dom.requestError, err.message);
    } finally {
      dom.submitRequestBtn.disabled = false;
      dom.submitRequestBtn.textContent = '신청하기';
    }
  }

  function bindEvents() {
    dom.tabMyLeave.addEventListener('click', () => setActiveTab('my-leave'));
    dom.tabApprovals.addEventListener('click', () => setActiveTab('approvals'));

    dom.userSelect.addEventListener('change', async () => {
      const selectedId = dom.userSelect.value;
      const nextUser = state.users.find((u) => String(u.id) === selectedId) || null;
      if (!nextUser) {
        return;
      }
      state.currentUser = nextUser;
      writeStoredUserId(nextUser.id);
      showBoxError(dom.requestError, '');
      showBoxError(dom.approvalsError, '');
      renderHeaderForUser(nextUser);
      await loadUserData();
    });

    dom.focusRequestBtn.addEventListener('click', () => {
      setActiveTab('my-leave');
      dom.requestCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      dom.requestCard.classList.add('is-highlighted');
      window.setTimeout(() => {
        dom.requestCard.classList.remove('is-highlighted');
      }, 1200);
      dom.leaveType.focus();
    });

    dom.leaveType.addEventListener('change', syncDateConstraintsAndPreview);
    dom.startDate.addEventListener('change', syncDateConstraintsAndPreview);
    dom.endDate.addEventListener('change', syncDateConstraintsAndPreview);

    dom.resetFormBtn.addEventListener('click', resetRequestForm);
    dom.leaveRequestForm.addEventListener('submit', handleRequestSubmit);

    dom.globalRetryBtn.addEventListener('click', () => {
      if (state.users.length === 0) {
        initUsersAndLoad();
      } else {
        loadUserData();
      }
    });

    dom.toastCloseBtn.addEventListener('click', () => {
      if (state.toastTimer) {
        window.clearTimeout(state.toastTimer);
      }
      setVisible(dom.toast, false);
    });
  }

  function bootstrap() {
    bindEvents();
    resetRequestForm();
    initUsersAndLoad();
  }

  bootstrap();
})();
