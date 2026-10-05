(() => {
  'use strict';

  const state = {
    page: 'overview',
    meta: { jobTypes: [], companyTypes: [], statuses: [], cities: [], channels: [] },
    applications: [],
    dashboard: null,
    filters: { q: '', status: '', jobType: '', companyType: '', city: '' },
    toastTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const elements = {
    overviewPage: $('#overviewPage'),
    jobsPage: $('#jobsPage'),
    todayText: $('#todayText'),
    stats: {
      total: $('#statTotal'), totalHint: $('#statTotalHint'), week: $('#statWeek'),
      weekHint: $('#statWeekHint'), interviews: $('#statInterviews'), offers: $('#statOffers'),
      rejections: $('#statRejections'), noResponse: $('#statNoResponse'),
      interviewRate: $('#statInterviewRate'), interviewRateHint: $('#statInterviewRateHint'),
      offerRate: $('#statOfferRate'), offerRateHint: $('#statOfferRateHint')
    },
    recentList: $('#recentList'), searchInput: $('#searchInput'), statusFilter: $('#statusFilter'),
    jobTypeFilter: $('#jobTypeFilter'), companyTypeFilter: $('#companyTypeFilter'),
    cityFilter: $('#cityFilter'), filtersPanel: $('#filtersPanel'), filterToggle: $('#filterToggle'),
    filterCount: $('#filterCount'), clearFilters: $('#clearFilters'), listCount: $('#listCount'),
    loadingIndicator: $('#loadingIndicator'), tableBody: $('#applicationsTableBody'),
    desktopTablePanel: $('#desktopTablePanel'), mobileList: $('#applicationsMobileList'),
    emptyState: $('#emptyState'), dialog: $('#applicationDialog'), form: $('#applicationForm'),
    recordId: $('#recordId'), dialogTitle: $('#dialogTitle'), dialogKicker: $('#dialogKicker'),
    deleteButton: $('#deleteRecordButton'), saveButton: $('#saveButton'),
    cityOptions: $('#cityOptions'), channelOptions: $('#channelOptions'), toast: $('#toast')
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getToday() { return localDateString(new Date()); }

  function getWeekStart(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return localDateString(date);
  }

  function formatDate(dateString) {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${year}.${month}.${day}`;
  }

  function dateParts(dateString) {
    const [, month, day] = String(dateString || '').split('-');
    return { day: day || '--', month: month ? `${Number(month)}月` : '' };
  }

  function formatPercent(rate) {
    return `${Math.round(Number(rate || 0) * 1000) / 10}%`;
  }

  function debounce(fn, delay = 260) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  function showToast(message, type = 'success') {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast is-visible${type === 'error' ? ' is-error' : ''}`;
    state.toastTimer = setTimeout(() => { elements.toast.className = 'toast'; }, 2800);
  }

  function setLoading(loading) {
    elements.loadingIndicator.hidden = !loading;
    elements.searchInput.disabled = loading;
  }

  function setTodayText() {
    const formatted = new Intl.DateTimeFormat('zh-CN', {
      month: 'long', day: 'numeric', weekday: 'long'
    }).format(new Date());
    elements.todayText.textContent = `${formatted} · 所有数据已持久化保存`;
  }

  async function loadMeta() {
    const payload = await api('/api/meta');
    state.meta = payload.data;
    populateSelect(elements.statusFilter, state.meta.statuses, '全部状态');
    populateSelect(elements.jobTypeFilter, state.meta.jobTypes, '全部岗位');
    populateSelect(elements.companyTypeFilter, state.meta.companyTypes, '全部公司');
    populateSelect(elements.cityFilter, state.meta.cities, '全部城市');
    populateSelect($('#status'), state.meta.statuses, '请选择状态');
    populateSelect($('#jobType'), state.meta.jobTypes, '请选择岗位类型');
    populateSelect($('#companyType'), state.meta.companyTypes, '请选择公司类型');
    populateDatalist(elements.cityOptions, state.meta.cities);
    populateDatalist(elements.channelOptions, state.meta.channels);
    elements.statusFilter.value = state.filters.status;
    elements.jobTypeFilter.value = state.filters.jobType;
    elements.companyTypeFilter.value = state.filters.companyType;
    elements.cityFilter.value = state.filters.city;
  }

  function populateSelect(select, values, placeholder) {
    const current = select.value;
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
      values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    if (values.includes(current)) select.value = current;
  }

  function populateDatalist(list, values) {
    list.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
  }

  async function refreshDashboard() {
    const today = getToday();
    const weekStart = getWeekStart(today);
    const payload = await api(`/api/dashboard?today=${today}&weekStart=${weekStart}`);
    state.dashboard = payload.data;
    renderDashboard();
    renderRecent();
  }

  function renderDashboard() {
    const data = state.dashboard;
    if (!data) return;
    elements.stats.total.textContent = data.total;
    elements.stats.totalHint.textContent = `已投 ${data.delivered} · 待投 ${data.waiting}`;
    elements.stats.week.textContent = data.week;
    elements.stats.weekHint.textContent = `${formatDate(data.weekStart)} — ${formatDate(data.weekEnd)}`;
    elements.stats.interviews.textContent = data.interviews;
    elements.stats.offers.textContent = data.offers;
    elements.stats.rejections.textContent = data.rejections;
    elements.stats.noResponse.textContent = data.noResponse;
    elements.stats.interviewRate.textContent = formatPercent(data.interviewRate);
    elements.stats.offerRate.textContent = formatPercent(data.offerRate);
    elements.stats.interviewRateHint.textContent = `按已投 ${data.delivered} 条计算`;
    elements.stats.offerRateHint.textContent = `按已投 ${data.delivered} 条计算`;
  }

  function renderRecent() {
    const items = state.dashboard?.recent || [];
    if (!items.length) {
      elements.recentList.innerHTML = `
        <div class="empty-state" style="min-height:220px">
          <div class="empty-icon"><svg class="icon"><use href="#i-briefcase"></use></svg></div>
          <h3>还没有投递记录</h3>
          <p>点击“新增岗位”，第一条记录只需约 30 秒。</p>
          <button class="button button-primary" type="button" data-action="create">新增岗位</button>
        </div>`;
      return;
    }
    elements.recentList.innerHTML = items.map((item) => {
      const date = dateParts(item.applicationDate);
      return `
        <button class="recent-item" type="button" data-action="edit" data-id="${item.id}">
          <span class="recent-date"><span><b>${escapeHtml(date.day)}</b>${escapeHtml(date.month)}</span></span>
          <span class="recent-main">
            <strong>${escapeHtml(item.companyName)}</strong>
            <p>${escapeHtml(item.jobTitle)}</p>
            <small>${escapeHtml(item.location || '地点未填')} · ${escapeHtml(item.channel || '渠道未填')}</small>
          </span>
          <span class="status-badge" data-status="${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
        </button>`;
    }).join('');
  }

  async function refreshApplications() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(state.filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const payload = await api(`/api/applications?${params.toString()}`);
      state.applications = payload.data;
      renderApplications(payload.meta?.total ?? payload.data.length);
    } finally {
      setLoading(false);
    }
  }

  function statusOptions(selected) {
    return state.meta.statuses.map((status) =>
      `<option value="${escapeHtml(status)}"${status === selected ? ' selected' : ''}>${escapeHtml(status)}</option>`
    ).join('');
  }

  function quickStatusSelect(item) {
    return `<select class="quick-status" data-id="${item.id}" data-status="${escapeHtml(item.status)}" aria-label="快速修改 ${escapeHtml(item.companyName)} 的状态">${statusOptions(item.status)}</select>`;
  }

  function renderApplications(total) {
    const items = state.applications;
    elements.listCount.textContent = `共 ${total ?? items.length} 条记录`;
    elements.emptyState.hidden = items.length > 0;
    elements.desktopTablePanel.hidden = items.length === 0;
    elements.mobileList.hidden = items.length === 0;

    elements.tableBody.innerHTML = items.map((item) => {
      const jobLink = safeHttpUrl(item.jobUrl);
      return `
        <tr data-id="${item.id}">
          <td class="company-cell">
            <strong class="job-company">${escapeHtml(item.companyName)}</strong>
            <span class="job-title">${escapeHtml(item.jobTitle)}</span>
          </td>
          <td class="date-cell">${escapeHtml(formatDate(item.applicationDate))}</td>
          <td class="type-cell">
            <span>${escapeHtml(item.jobType)}</span>
            <small>${escapeHtml(item.companyType)}</small>
          </td>
          <td class="location-cell">
            <span>${escapeHtml(item.location)}</span>
            <small>${escapeHtml(item.channel)}</small>
          </td>
          <td class="salary-cell">${escapeHtml(item.salaryRange || '—')}</td>
          <td>${quickStatusSelect(item)}</td>
          <td class="row-actions">
            ${jobLink ? `<a class="icon-button link-button" href="${escapeHtml(jobLink)}" target="_blank" rel="noopener noreferrer" aria-label="打开岗位链接"><svg class="icon"><use href="#i-external"></use></svg></a>` : ''}
            <button class="icon-button" type="button" data-action="edit" data-id="${item.id}" aria-label="编辑"><svg class="icon"><use href="#i-edit"></use></svg></button>
            <button class="icon-button danger" type="button" data-action="delete" data-id="${item.id}" aria-label="删除"><svg class="icon"><use href="#i-trash"></use></svg></button>
          </td>
        </tr>`;
    }).join('');

    elements.mobileList.innerHTML = items.map((item) => {
      const jobLink = safeHttpUrl(item.jobUrl);
      return `
        <article class="job-card" data-id="${item.id}">
          <div class="job-card-top">
            <div class="job-card-heading">
              <strong class="job-company">${escapeHtml(item.companyName)}</strong>
              <span class="job-title">${escapeHtml(item.jobTitle)}</span>
            </div>
            ${quickStatusSelect(item)}
          </div>
          <div class="job-meta">
            <span class="meta-chip">${escapeHtml(item.jobType)}</span>
            <span class="meta-chip">${escapeHtml(item.companyType)}</span>
            <span class="meta-chip">${escapeHtml(item.location)}</span>
            <span class="meta-chip">${escapeHtml(item.channel)}</span>
            ${item.salaryRange ? `<span class="meta-chip">${escapeHtml(item.salaryRange)}</span>` : ''}
          </div>
          <div class="job-card-footer">
            <span class="job-date">投递于 ${escapeHtml(formatDate(item.applicationDate))}</span>
            <div class="card-actions">
              ${jobLink ? `<a class="icon-button link-button" href="${escapeHtml(jobLink)}" target="_blank" rel="noopener noreferrer" aria-label="打开岗位链接"><svg class="icon"><use href="#i-external"></use></svg></a>` : ''}
              <button class="icon-button" type="button" data-action="edit" data-id="${item.id}" aria-label="编辑"><svg class="icon"><use href="#i-edit"></use></svg></button>
              <button class="icon-button danger" type="button" data-action="delete" data-id="${item.id}" aria-label="删除"><svg class="icon"><use href="#i-trash"></use></svg></button>
            </div>
          </div>
        </article>`;
    }).join('');
  }

  function openCreateDialog() {
    elements.form.reset();
    elements.recordId.value = '';
    $('#applicationDate').value = getToday();
    $('#status').value = '待投';
    elements.dialogTitle.textContent = '新增岗位';
    elements.dialogKicker.textContent = '新增记录';
    elements.deleteButton.hidden = true;
    elements.dialog.showModal();
    requestAnimationFrame(() => $('#companyName').focus());
  }

  function openEditDialog(id) {
    const item = state.applications.find((application) => application.id === Number(id)) ||
      state.dashboard?.recent?.find((application) => application.id === Number(id));
    if (!item) {
      showToast('未找到该岗位记录', 'error');
      return;
    }
    elements.form.reset();
    elements.recordId.value = item.id;
    $('#applicationDate').value = item.applicationDate;
    $('#companyName').value = item.companyName;
    $('#jobTitle').value = item.jobTitle;
    $('#jobType').value = item.jobType;
    $('#companyType').value = item.companyType;
    $('#channel').value = item.channel;
    $('#location').value = item.location;
    $('#salaryRange').value = item.salaryRange || '';
    $('#jobUrl').value = item.jobUrl || '';
    $('#status').value = item.status;
    $('#rejectionReason').value = item.rejectionReason || '';
    $('#notes').value = item.notes || '';
    elements.dialogTitle.textContent = item.companyName;
    elements.dialogKicker.textContent = '编辑记录';
    elements.deleteButton.hidden = false;
    elements.dialog.showModal();
  }

  function collectForm() {
    return {
      applicationDate: $('#applicationDate').value,
      companyName: $('#companyName').value.trim(),
      jobTitle: $('#jobTitle').value.trim(),
      jobType: $('#jobType').value,
      companyType: $('#companyType').value,
      channel: $('#channel').value.trim(),
      location: $('#location').value.trim(),
      salaryRange: $('#salaryRange').value.trim(),
      jobUrl: $('#jobUrl').value.trim(),
      status: $('#status').value,
      rejectionReason: $('#rejectionReason').value.trim(),
      notes: $('#notes').value.trim()
    };
  }

  function setSaving(saving) {
    elements.saveButton.disabled = saving;
    elements.deleteButton.disabled = saving;
    elements.saveButton.textContent = saving ? '保存中…' : '保存岗位';
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    if (!elements.form.checkValidity()) {
      elements.form.reportValidity();
      return;
    }
    const id = Number(elements.recordId.value || 0);
    setSaving(true);
    try {
      await api(id ? `/api/applications/${id}` : '/api/applications', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(collectForm())
      });
      elements.dialog.close();
      showToast(id ? '岗位记录已更新' : '岗位记录已新增');
      await Promise.all([loadMeta(), refreshDashboard(), refreshApplications()]);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(id) {
    const item = state.applications.find((application) => application.id === Number(id));
    const label = item ? `“${item.companyName} · ${item.jobTitle}”` : '这条记录';
    if (!window.confirm(`确定删除${label}吗？删除后无法恢复。`)) return;
    try {
      await api(`/api/applications/${id}`, { method: 'DELETE' });
      if (elements.dialog.open) elements.dialog.close();
      showToast('岗位记录已删除');
      await Promise.all([loadMeta(), refreshDashboard(), refreshApplications()]);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function changeStatus(id, status, select) {
    const previous = state.applications.find((item) => item.id === Number(id));
    if (select) select.disabled = true;
    try {
      await api(`/api/applications/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      if (previous) previous.status = status;
      if (select) select.dataset.status = status;
      showToast(`状态已更新为“${status}”`);
      await Promise.all([refreshDashboard(), refreshApplications()]);
    } catch (error) {
      showToast(error.message, 'error');
      if (previous && select) {
        select.value = previous.status;
        select.dataset.status = previous.status;
      }
    } finally {
      if (select) select.disabled = false;
    }
  }

  function updateFilterCount() {
    const count = Object.values(state.filters).filter(Boolean).length;
    elements.filterCount.hidden = !count;
    elements.filterCount.textContent = String(count);
  }

  function syncFiltersFromInputs() {
    state.filters = {
      q: elements.searchInput.value.trim(),
      status: elements.statusFilter.value,
      jobType: elements.jobTypeFilter.value,
      companyType: elements.companyTypeFilter.value,
      city: elements.cityFilter.value
    };
    updateFilterCount();
  }

  function showPage(page, updateHash = true, loadJobs = true) {
    state.page = page;
    if (updateHash) history.replaceState(null, '', '#' + page);
    elements.overviewPage.hidden = page !== 'overview';
    elements.jobsPage.hidden = page !== 'jobs';
    $$('[data-page]').forEach((button) => button.classList.toggle('is-active', button.dataset.page === page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'jobs' && loadJobs && !state.applications.length) refreshApplications().catch((error) => showToast(error.message, 'error'));
  }

  function bindEvents() {
    $$('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
    ['#headerAddButton', '#overviewAddButton', '#jobsAddButton', '#emptyAddButton'].forEach((selector) => {
      $(selector)?.addEventListener('click', openCreateDialog);
    });
    $('#viewAllButton').addEventListener('click', () => showPage('jobs'));
    $('#dialogCloseButton').addEventListener('click', () => elements.dialog.close());
    $('#cancelButton').addEventListener('click', () => elements.dialog.close());
    elements.deleteButton.addEventListener('click', () => deleteRecord(elements.recordId.value));
    elements.form.addEventListener('submit', handleFormSubmit);
    elements.dialog.addEventListener('click', (event) => {
      if (event.target === elements.dialog) elements.dialog.close();
    });

    elements.filterToggle.addEventListener('click', () => {
      const open = elements.filtersPanel.classList.toggle('is-open');
      elements.filterToggle.setAttribute('aria-expanded', String(open));
    });

    elements.searchInput.addEventListener('input', debounce(() => {
      syncFiltersFromInputs();
      refreshApplications().catch((error) => showToast(error.message, 'error'));
    }));

    [elements.statusFilter, elements.jobTypeFilter, elements.companyTypeFilter, elements.cityFilter].forEach((select) => {
      select.addEventListener('change', () => {
        syncFiltersFromInputs();
        refreshApplications().catch((error) => showToast(error.message, 'error'));
      });
    });

    elements.clearFilters.addEventListener('click', () => {
      elements.searchInput.value = '';
      elements.statusFilter.value = '';
      elements.jobTypeFilter.value = '';
      elements.companyTypeFilter.value = '';
      elements.cityFilter.value = '';
      syncFiltersFromInputs();
      refreshApplications().catch((error) => showToast(error.message, 'error'));
    });

    const handleAction = (event) => {
      const actionTarget = event.target.closest('[data-action]');
      if (!actionTarget) return;
      const action = actionTarget.dataset.action;
      const id = actionTarget.dataset.id;
      if (action === 'create') openCreateDialog();
      if (action === 'edit') openEditDialog(id);
      if (action === 'delete') deleteRecord(id);
    };
    elements.recentList.addEventListener('click', handleAction);
    elements.tableBody.addEventListener('click', handleAction);
    elements.mobileList.addEventListener('click', handleAction);

    const handleStatusChange = (event) => {
      const select = event.target.closest('.quick-status');
      if (select) changeStatus(select.dataset.id, select.value, select);
    };
    elements.tableBody.addEventListener('change', handleStatusChange);
    elements.mobileList.addEventListener('change', handleStatusChange);
  }

  async function init() {
    setTodayText();
    bindEvents();
    showPage(window.location.hash === '#jobs' ? 'jobs' : 'overview', false, false);
    try {
      await loadMeta();
      await Promise.all([refreshDashboard(), refreshApplications()]);
    } catch (error) {
      showToast(`数据加载失败：${error.message}`, 'error');
    }
  }

  init();
})();
