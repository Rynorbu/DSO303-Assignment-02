/* ExamHub – single-page app (plain JavaScript, no build step).
 *
 * Roles: students (sit exams, upload assignments, see results), tutors (build exams, mark, release
 * results, collect assignments) and admins (users, schedules).
 * Auth on AWS: Amazon Cognito ID token -> "Authorization: Bearer" on /api/* (API Gateway JWT authorizer).
 * Local development (backend/local/server.js): window.APP_CONFIG.localMode = true, no Cognito.
 */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById('app');
  const AUTOSAVE_MS = 30000;
  const MAX_UPLOAD = 50 * 1024 * 1024;

  // =====================================================================================
  // Utilities
  // =====================================================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const fmtScore = (v) => (v === null || v === undefined ? '—' : String(Math.round(Number(v) * 10) / 10));
  const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const tf = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const fmtDate = (d) => (d ? dtf.format(new Date(d)) : '—');
  const fmtTime = (d) => (d ? tf.format(new Date(d)) : '—');
  function fmtRel(d) {
    if (!d) return '—';
    const s = (new Date(d).getTime() - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 60) return rtf.format(Math.round(s), 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    return fmtDate(d);
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }
  const initials = (email) => String(email || '?').replace(/@.*/, '').split(/[._+-]/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
  const pct = (a, b) => (Number(b) > 0 ? Math.round((Number(a) / Number(b)) * 1000) / 10 : null);
  const wordCount = (t) => (String(t || '').trim() ? String(t).trim().split(/\s+/).length : 0);
  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
    localGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    localSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    localDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // =====================================================================================
  // Icons (inline SVG, stroke style)
  // =====================================================================================
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    exam: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    cloud: '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
    cloudOff: '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M3 3l18 18"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    zip: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M10 6h1M10 9h1M10 12h1M10 15h2v3h-2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // =====================================================================================
  // UI building blocks
  // =====================================================================================
  const pill = (text, tone = '', dot = true) => `<span class="pill ${tone} ${dot ? '' : 'no-dot'}">${esc(text)}</span>`;
  const stat = (ic, tone, value, label) => `<div class="card stat"><div class="stat-icon ${tone}">${icon(ic)}</div><div><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div></div>`;
  const empty = (ic, title, text, action = '') => `<div class="empty"><div class="empty-icon">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
  const skeleton = (h = 120, n = 1) => Array.from({ length: n }, () => `<div class="skeleton" style="height:${h}px"></div>`).join('');
  const loadingPage = () => `<div class="stack">${skeleton(32)}<div class="grid grid-stats">${skeleton(84, 4)}</div>${skeleton(220)}</div>`;

  function pageHead({ title, subtitle = '', crumbs = [], actions = '' }) {
    const c = crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(([label, href]) => (href ? `<a href="#${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join(icon('right'))}</nav>` : '';
    return `${c}<div class="page-head"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div><div class="row">${actions}</div></div>`;
  }

  function errorState(el, err, retry) {
    el.innerHTML = `<div class="card">${empty('alert', 'Something went wrong', err.message || 'Could not load this page.', '<button class="btn btn-secondary" data-retry>' + icon('refresh') + 'Try again</button>')}</div>`;
    $('[data-retry]', el).onclick = retry || render;
  }

  function toast(message, type = 'info', timeout = 4500) {
    const root = $('#toasts');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'info')}<div>${esc(message)}</div><button aria-label="Dismiss">${icon('x')}</button>`;
    t.querySelector('button').onclick = () => t.remove();
    root.appendChild(t);
    if (timeout) setTimeout(() => t.remove(), timeout);
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.html = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>${label ? esc(label) : ''}`;
    } else if (btn.dataset.html !== undefined) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.html;
      delete btn.dataset.html;
    }
  }

  // Accessible modal dialog. Resolves with the onConfirm result, or false if cancelled.
  function modal({ title, body = '', ic, tone = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false, wide = false, hideCancel = false, onConfirm }) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      const previous = document.activeElement;
      root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">${ic ? `<div class="modal-icon ${tone}">${icon(ic)}</div>` : ''}<div><h2 id="modal-title">${esc(title)}</h2></div></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${hideCancel ? '' : `<button class="btn btn-secondary" data-act="cancel">${esc(cancelText)}</button>`}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button></div></div></div>`;
      const dialog = $('.modal', root);
      const okBtn = $('[data-act="ok"]', root);
      const close = (value) => {
        document.removeEventListener('keydown', onKey, true);
        root.innerHTML = '';
        if (previous && previous.focus) previous.focus();
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(false); }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); okBtn.click(); }
      };
      document.addEventListener('keydown', onKey, true);
      $('.modal-backdrop', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) close(false); });
      const cancel = $('[data-act="cancel"]', root);
      if (cancel) cancel.onclick = () => close(false);
      okBtn.onclick = async () => {
        if (!onConfirm) return close(true);
        setBusy(okBtn, true);
        try {
          const result = await onConfirm(dialog);
          if (result === false) { setBusy(okBtn, false); return; }
          close(result === undefined ? true : result);
        } catch (err) {
          setBusy(okBtn, false);
          const box = $('[data-modal-error]', dialog);
          if (box) { box.hidden = false; box.innerHTML = `${icon('alert')}<div>${esc(err.message)}</div>`; } else toast(err.message, 'error');
        }
      };
      (dialog.querySelector('input, textarea, select') || okBtn).focus();
    });
  }
  const modalError = '<div class="alert danger" data-modal-error hidden></div>';

  // =====================================================================================
  // Theme
  // =====================================================================================
  const THEMES = ['system', 'light', 'dark'];
  const getTheme = () => {
    try { const t = localStorage.getItem('theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
  };
  function applyTheme(t) {
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  }
  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    try { if (next === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', next); } catch { /* ignore */ }
    applyTheme(next);
    toast(`Theme: ${next}`);
    $$('[data-theme-btn]').forEach((b) => { b.innerHTML = themeIcon(); });
  }
  const themeIcon = () => icon({ system: 'monitor', light: 'sun', dark: 'moon' }[getTheme()]);
  applyTheme(getTheme());

  // =====================================================================================
  // Authentication (Cognito on AWS, simple role picker locally)
  // =====================================================================================
  const COGNITO_ERRORS = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'Incorrect email or password.',
    InvalidPasswordException: 'That password does not meet the rules: at least 10 characters with upper case, lower case and a number.',
    PasswordResetRequiredException: 'Your password must be reset. Please contact an administrator.',
    TooManyRequestsException: 'Too many attempts. Please wait a minute and try again.',
    LimitExceededException: 'Too many attempts. Please wait a minute and try again.',
    UserNotConfirmedException: 'Your account is not confirmed yet. Contact an administrator.',
  };

  async function cognito(target, body) {
    let res;
    try {
      res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
        body: JSON.stringify(body),
      });
    } catch { throw new Error('Cannot reach the sign-in service. Check your internet connection.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const type = String(data.__type || '').split('#').pop();
      if (type === 'NotAuthorizedException' && /expired/i.test(data.message || '')) throw new Error('Your temporary password has expired. Ask an administrator to send a new invite.');
      throw new Error(COGNITO_ERRORS[type] || data.message || 'Sign-in failed');
    }
    return data;
  }

  function decodeJwt(token) {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  }

  function saveSession(auth) {
    const claims = decodeJwt(auth.IdToken);
    const prev = store.get('session') || {};
    store.set('session', {
      idToken: auth.IdToken,
      refreshToken: auth.RefreshToken || prev.refreshToken,
      email: claims.email,
      groups: claims['cognito:groups'] || [],
      exp: claims.exp * 1000,
    });
  }

  function localSignIn(email, group) {
    const claims = { email, 'cognito:groups': [group] };
    const token = btoa(unescape(encodeURIComponent(JSON.stringify(claims)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('session', { idToken: token, email, groups: [group], exp: Date.now() + 12 * 3600 * 1000 });
  }

  async function refreshSession() {
    const s = store.get('session');
    if (cfg.localMode || !s?.refreshToken) throw new Error('Your session has expired. Please sign in again.');
    const data = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: cfg.userPoolClientId, AuthParameters: { REFRESH_TOKEN: s.refreshToken },
    });
    saveSession(data.AuthenticationResult);
  }

  function signOut(message) {
    stopExam();
    store.del('session');
    if (message) toast(message);
    location.hash = '#/';
    render();
  }

  const session = () => store.get('session');
  function role() {
    const g = session()?.groups || [];
    if (g.includes('admins')) return 'admin';
    if (g.includes('tutors')) return 'tutor';
    if (g.includes('students')) return 'student';
    return null;
  }

  // =====================================================================================
  // API client
  // =====================================================================================
  async function api(method, path, body, retried = false) {
    const s = session();
    if (s && !cfg.localMode && Date.now() > s.exp - 60000 && !retried) { try { await refreshSession(); } catch { /* handled on 401 */ } }
    let res;
    try {
      res = await fetch(`${cfg.apiBase || '/api'}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session()?.idToken || ''}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      const err = new Error('Network error – check your internet connection.');
      err.network = true;
      throw err;
    }
    if (res.status === 401 && !retried) {
      try { await refreshSession(); return api(method, path, body, true); } catch { signOut('Your session has expired. Please sign in again.'); throw new Error('Session expired'); }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // =====================================================================================
  // Router
  // =====================================================================================
  const NAV = {
    student: [['/', 'Dashboard', 'home'], ['/exams', 'My exams', 'exam'], ['/assignments', 'Assignments', 'upload'], ['/results', 'Results', 'award']],
    tutor: [['/', 'Dashboard', 'home'], ['/exams', 'Exams', 'exam'], ['/assignments', 'Assignments', 'upload']],
    admin: [['/', 'Dashboard', 'home'], ['/users', 'Users', 'users'], ['/schedules', 'Exam schedules', 'calendar']],
  };
  const ROLE_LABEL = { student: 'Student', tutor: 'Tutor', admin: 'Administrator' };

  const ROUTES = {
    student: [
      ['/', studentDashboard], ['/exams', studentExams], ['/take/:id', takeExam, { bare: true }],
      ['/assignments', studentAssignments], ['/results', studentResults],
    ],
    tutor: [
      ['/', tutorDashboard], ['/exams', tutorExams], ['/exams/new', examBuilder], ['/exams/:id', tutorExamDetail],
      ['/exams/:id/mark/:aid', markAttempt], ['/assignments', tutorAssignments], ['/assignments/:id', tutorAssignmentDetail],
    ],
    admin: [['/', adminDashboard], ['/users', adminUsers], ['/schedules', adminSchedules]],
  };

  function matchRoute(list, path) {
    for (const [pattern, page, opts = {}] of list) {
      const names = [];
      const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
      const m = path.match(re);
      if (m) return { page, opts, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }

  const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const navigate = (path) => { if (currentPath() === path) render(); else location.hash = `#${path}`; };

  function render() {
    if (EXAM && !currentPath().startsWith('/take/')) stopExam(true);
    $('#modal-root').innerHTML = '';
    if (!session()) return loginPage();
    const r = role();
    if (!r) {
      app.innerHTML = `<div class="auth-main" style="min-height:100vh"><div class="card card-pad" style="max-width:440px">${empty('shield', 'No role assigned', 'Your account is not in the students, tutors or admins group yet. Ask an administrator to add you.', '<button class="btn btn-secondary" data-signout>Sign out</button>')}</div></div>`;
      $('[data-signout]').onclick = () => signOut();
      return;
    }
    const path = currentPath();
    const match = matchRoute(ROUTES[r], path);
    if (match?.opts.bare) return match.page(null, match.params);
    const main = renderShell(r, path);
    if (!match) {
      main.innerHTML = `<div class="card">${empty('search', 'Page not found', 'That page does not exist.', '<a class="btn btn-primary" href="#/">Go to dashboard</a>')}</div>`;
      return;
    }
    window.scrollTo(0, 0);
    Promise.resolve(match.page(main, match.params)).catch((err) => errorState(main, err));
  }

  function renderShell(r, path) {
    const s = session();
    const active = (href) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));
    const links = NAV[r].map(([href, label, ic]) => `<a href="#${href}" class="${active(href) ? 'active' : ''}" ${active(href) ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('');
    const mobileLinks = NAV[r].map(([href, label]) => `<a href="#${href}" class="${active(href) ? 'active' : ''}">${label}</a>`).join('');
    app.innerHTML = `${cfg.localMode ? '<div class="local-banner">Local development mode – data stays on this computer</div>' : ''}
      <div class="shell">
        <aside class="sidebar" aria-label="Main navigation">
          <div class="brand"><div class="brand-mark">${icon('cap')}</div><div>ExamHub<small>University exam platform</small></div></div>
          <nav class="nav">${links}</nav>
          <div class="sidebar-foot">
            <div class="user-chip"><div class="avatar">${esc(initials(s.email))}</div><div class="who"><b title="${esc(s.email)}">${esc(s.email)}</b><span class="muted tiny">${ROLE_LABEL[r]}</span></div></div>
            <div class="row" style="gap:6px">
              <button class="btn btn-ghost btn-sm" data-theme-btn title="Change theme" aria-label="Change theme">${themeIcon()}</button>
              <button class="btn btn-ghost btn-sm" data-signout style="flex:1;justify-content:flex-start">${icon('logout')}Sign out</button>
            </div>
          </div>
        </aside>
        <div>
          <header class="topbar-mobile">
            <div class="brand" style="padding:0"><div class="brand-mark">${icon('cap')}</div>ExamHub</div>
            <div class="row" style="gap:4px">
              <button class="btn btn-ghost btn-icon btn-sm" data-theme-btn aria-label="Change theme">${themeIcon()}</button>
              <button class="btn btn-ghost btn-icon btn-sm" data-signout aria-label="Sign out">${icon('logout')}</button>
            </div>
          </header>
          <nav class="mobile-nav" aria-label="Main navigation">${mobileLinks}</nav>
          <main class="content" id="main"></main>
        </div>
      </div>`;
    $$('[data-signout]').forEach((b) => { b.onclick = () => signOut(); });
    $$('[data-theme-btn]').forEach((b) => { b.onclick = cycleTheme; });
    return $('#main');
  }

  // =====================================================================================
  // Login
  // =====================================================================================
  function loginPage() {
    const feature = (ic, title, text) => `<div class="feature"><div class="fi">${icon(ic)}</div><div><b>${title}</b><div style="opacity:.8;font-size:14px">${text}</div></div></div>`;
    app.innerHTML = `<div class="auth">
      <section class="auth-hero">
        <div class="brand"><div class="brand-mark">${icon('cap')}</div><div>ExamHub<small>University exam platform</small></div></div>
        <div>
          <h1>Exams and assignments, all in one place.</h1>
          <p>Sit timed exams, submit coursework and get your results – securely, from any device.</p>
        </div>
        <div class="features">
          ${feature('clock', 'Timed exams with autosave', 'Answers are saved every 30 seconds, even if your connection drops.')}
          ${feature('upload', 'Assignment uploads', 'PDF or ZIP up to 50 MB, straight to encrypted storage.')}
          ${feature('award', 'Fast, fair results', 'Multiple-choice questions are marked automatically, and you get an email when results are out.')}
        </div>
        <small style="opacity:.6">Secured with Amazon Cognito · Encrypted in transit and at rest</small>
      </section>
      <main class="auth-main">
        <div class="auth-card stack">
          ${cfg.localMode ? '<div class="local-banner" style="border-radius:8px">Local development mode</div>' : ''}
          <div><h2 id="auth-title">Sign in</h2><p class="muted" id="auth-sub">Use your university email address.</p></div>
          <div class="alert danger" id="auth-error" hidden></div>
          <form id="login-form" class="stack" novalidate>
            <label class="field"><span>Email</span><input class="input" type="email" name="email" required autocomplete="username" placeholder="you@university.edu"></label>
            <label class="field"><span>Password</span>
              <div class="input-group"><input class="input" type="password" name="password" ${cfg.localMode ? '' : 'required'} autocomplete="current-password" placeholder="${cfg.localMode ? 'Not needed locally' : '••••••••••'}">
              <button type="button" class="btn btn-ghost btn-icon" data-toggle-pw aria-label="Show password">${icon('eye')}</button></div></label>
            ${cfg.localMode ? `<div class="field"><span>Sign in as</span><div class="segmented" role="radiogroup">
              <label><input type="radio" name="role" value="students" checked><span>${icon('cap')}Student</span></label>
              <label><input type="radio" name="role" value="tutors"><span>${icon('pen')}Tutor</span></label>
              <label><input type="radio" name="role" value="admins"><span>${icon('shield')}Admin</span></label></div>
              <span class="hint">Locally there is no Cognito, so you choose the role.</span></div>` : ''}
            <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in</button>
          </form>
          <form id="newpw-form" class="stack" hidden novalidate>
            <div class="alert info">${icon('info')}<div>This is your first sign-in. Choose a new password with at least 10 characters, including upper case, lower case and a number.</div></div>
            <label class="field"><span>New password</span><input class="input" type="password" name="password" required minlength="10" autocomplete="new-password"></label>
            <label class="field"><span>Confirm new password</span><input class="input" type="password" name="confirm" required autocomplete="new-password"></label>
            <button class="btn btn-primary btn-lg btn-block" type="submit">Set password and continue</button>
          </form>
          <p class="muted small" style="text-align:center">Trouble signing in? Contact your exams office.</p>
        </div>
      </main></div>`;

    const errBox = $('#auth-error');
    const showError = (msg) => { errBox.hidden = !msg; errBox.innerHTML = msg ? `${icon('alert')}<div>${esc(msg)}</div>` : ''; };
    $('[data-toggle-pw]').onclick = (e) => {
      const input = $('#login-form [name=password]');
      input.type = input.type === 'password' ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
    };
    let challenge = null;

    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return showError('Enter a valid email address.');
      showError('');
      if (cfg.localMode) { localSignIn(email, f.role.value); location.hash = '#/'; render(); return; }
      if (!f.password.value) return showError('Enter your password.');
      const btn = f.querySelector('[type=submit]');
      setBusy(btn, true, 'Signing in…');
      try {
        const data = await cognito('InitiateAuth', {
          AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cfg.userPoolClientId,
          AuthParameters: { USERNAME: email, PASSWORD: f.password.value },
        });
        if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
          challenge = { session: data.Session, username: data.ChallengeParameters?.USER_ID_FOR_SRP || email };
          f.hidden = true;
          $('#newpw-form').hidden = false;
          $('#auth-title').textContent = 'Set your password';
          $('#auth-sub').textContent = email;
          $('#newpw-form [name=password]').focus();
          return;
        }
        saveSession(data.AuthenticationResult);
        location.hash = '#/';
        render();
      } catch (err) { showError(err.message); } finally { setBusy(btn, false); }
    });

    $('#newpw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.password.value.length < 10) return showError('The password must be at least 10 characters.');
      if (f.password.value !== f.confirm.value) return showError('The two passwords do not match.');
      showError('');
      const btn = f.querySelector('[type=submit]');
      setBusy(btn, true, 'Saving…');
      try {
        const data = await cognito('RespondToAuthChallenge', {
          ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: cfg.userPoolClientId, Session: challenge.session,
          ChallengeResponses: { USERNAME: challenge.username, NEW_PASSWORD: f.password.value },
        });
        saveSession(data.AuthenticationResult);
        toast('Password set. Welcome!', 'success');
        location.hash = '#/';
        render();
      } catch (err) { showError(err.message); } finally { setBusy(btn, false); }
    });
    $('#login-form [name=email]').focus();
  }

  // =====================================================================================
  // Shared status helpers
  // =====================================================================================
  function examWindow(e) {
    const now = Date.now();
    if (e.opens_at && new Date(e.opens_at) > now) return 'scheduled';
    if (e.closes_at && new Date(e.closes_at) < now) return 'closed';
    return 'open';
  }

  function studentExamState(e) {
    const w = examWindow(e);
    if (e.attempt_status === 'in_progress') {
      if (new Date(e.deadline) < Date.now()) return { key: 'done', label: 'Time up – submitting', tone: 'warning' };
      return { key: 'active', label: 'In progress', tone: 'warning', action: 'Resume exam' };
    }
    if (e.attempt_status) return e.results_released ? { key: 'done', label: 'Results available', tone: 'success', results: true } : { key: 'done', label: 'Submitted', tone: 'info' };
    if (w === 'scheduled') return { key: 'upcoming', label: `Opens ${fmtRel(e.opens_at)}`, tone: '' };
    if (w === 'closed') return { key: 'done', label: 'Missed', tone: 'danger' };
    return { key: 'active', label: 'Available now', tone: 'success', action: 'Start exam' };
  }

  function tutorExamPill(e) {
    if (e.results_released) return pill('Results released', 'success');
    const w = examWindow(e);
    if (w === 'scheduled') return pill('Scheduled', 'info');
    if (w === 'closed') return pill('Closed', 'warning');
    return pill('Open', 'brand');
  }

  const ATTEMPT_STATUS = {
    in_progress: ['Sitting exam', 'warning'],
    submitted: ['Auto-marking…', 'info'],
    awaiting_manual: ['Needs marking', 'warning'],
    marked: ['Marked', 'success'],
  };
  const attemptPill = (s) => pill(...(ATTEMPT_STATUS[s] || [s, '']));

  function windowText(e) {
    if (!e.opens_at && !e.closes_at) return 'Always open';
    if (e.opens_at && e.closes_at) return `${fmtDate(e.opens_at)} – ${fmtDate(e.closes_at)}`;
    return e.opens_at ? `Opens ${fmtDate(e.opens_at)}` : `Closes ${fmtDate(e.closes_at)}`;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function scoreTone(p) {
    if (p === null) return 'var(--text-3)';
    if (p >= 70) return 'var(--success)';
    if (p >= 50) return 'var(--brand)';
    if (p >= 40) return 'var(--warning)';
    return 'var(--danger)';
  }
  const scoreRing = (p, label) => `<div class="score-ring" style="--p:${p || 0};--c:${scoreTone(p)}"><div><div><b>${p === null ? '—' : `${Math.round(p)}%`}</b><div class="tiny muted">${esc(label || '')}</div></div></div></div>`;

  // =====================================================================================
  // STUDENT
  // =====================================================================================
  async function studentDashboard(el) {
    el.innerHTML = loadingPage();
    const [exams, assignments, results] = await Promise.all([api('GET', '/exams'), api('GET', '/assignments'), api('GET', '/results')]);
    const states = exams.map((e) => ({ e, s: studentExamState(e) }));
    const active = states.filter((x) => x.s.key === 'active');
    const inProgress = states.filter((x) => x.e.attempt_status === 'in_progress' && x.s.action);
    const upcoming = states.filter((x) => x.s.key === 'upcoming');
    const toSubmit = assignments.filter((a) => !a.my_last_submission && (!a.due_at || new Date(a.due_at) > Date.now()));
    el.innerHTML = `${pageHead({ title: `${greeting()} 👋`, subtitle: 'Here is what needs your attention.' })}
      ${inProgress.length ? `<div class="alert warning" style="margin-bottom:16px">${icon('clock')}<div><b>You have an exam in progress.</b> The timer is still running – <a href="#/take/${esc(inProgress[0].e.id)}">resume ${esc(inProgress[0].e.title)}</a>.</div></div>` : ''}
      <div class="grid grid-stats">
        ${stat('exam', 'brand', active.length, 'Exams available')}
        ${stat('calendar', 'info', upcoming.length, 'Upcoming exams')}
        ${stat('upload', 'warning', toSubmit.length, 'Assignments to submit')}
        ${stat('award', 'success', results.length, 'Results released')}
      </div>
      <div class="section-title"><h2>Exams</h2><a href="#/exams" class="small">View all</a></div>
      <div class="grid grid-3" id="dash-exams">${[...active, ...upcoming].slice(0, 3).map(({ e, s }) => studentExamCard(e, s)).join('') || `<div class="card" style="grid-column:1/-1">${empty('exam', 'No exams right now', 'When a tutor publishes an exam for you, it will appear here.')}</div>`}</div>
      <div class="grid grid-2" style="margin-top:28px">
        <div class="card"><div class="card-head"><h2>Assignments due</h2><a href="#/assignments" class="small">View all</a></div>
          <div class="card-body stack-sm">${toSubmit.slice(0, 4).map((a) => `<div class="spread"><div><b>${esc(a.title)}</b><div class="muted small">${a.due_at ? `Due ${fmtDate(a.due_at)}` : 'No deadline'}</div></div>${duePill(a)}</div>`).join('<div class="divider"></div>') || '<p class="muted">Nothing to submit. 🎉</p>'}</div></div>
        <div class="card"><div class="card-head"><h2>Latest results</h2><a href="#/results" class="small">View all</a></div>
          <div class="card-body stack-sm">${results.slice(0, 4).map((r) => `<div class="spread"><div><b>${esc(r.title)}</b><div class="muted small">${fmtScore(r.total_score)} / ${fmtScore(r.max_score)} marks</div></div>${pill(`${r.percent ?? '—'}%`, r.percent >= 50 ? 'success' : 'danger', false)}</div>`).join('<div class="divider"></div>') || '<p class="muted">No results released yet.</p>'}</div></div>
      </div>`;
    bindStudentExamActions(el, exams);
  }

  function studentExamCard(e, s) {
    return `<div class="card item-card">
      <div class="spread" style="align-items:flex-start"><h3>${esc(e.title)}</h3>${pill(s.label, s.tone)}</div>
      ${e.description ? `<p class="muted small">${esc(e.description)}</p>` : ''}
      <div class="meta">
        <span>${icon('clock')}${esc(e.duration_minutes)} min</span>
        <span>${icon('exam')}${plural(e.question_count, 'question')} · ${fmtScore(e.total_marks)} marks</span>
        ${e.closes_at ? `<span>${icon('calendar')}Closes ${fmtDate(e.closes_at)}</span>` : ''}
        ${e.attempt_status === 'in_progress' ? `<span>${icon('alert')}Time left: ${fmtRel(e.deadline).replace(/^in /, '')}</span>` : ''}
      </div>
      <div class="actions">
        ${s.action ? `<button class="btn btn-primary" data-start="${esc(e.id)}">${s.action}</button>` : ''}
        ${s.results ? '<a class="btn btn-secondary" href="#/results">View result</a>' : ''}
      </div></div>`;
  }

  function bindStudentExamActions(el, exams) {
    $$('[data-start]', el).forEach((btn) => {
      btn.onclick = async () => {
        const e = exams.find((x) => x.id === btn.dataset.start);
        if (e.attempt_status === 'in_progress') return navigate(`/take/${e.id}`);
        const ok = await modal({
          title: `Start "${e.title}"?`, ic: 'clock', confirmText: 'Start exam',
          body: `<div class="stack-sm">
            <dl class="kv"><dt>Time allowed</dt><dd><b>${esc(e.duration_minutes)} minutes</b></dd><dt>Questions</dt><dd>${esc(e.question_count)} (${fmtScore(e.total_marks)} marks)</dd>${e.closes_at ? `<dt>Must finish by</dt><dd>${fmtDate(e.closes_at)}</dd>` : ''}</dl>
            <div class="alert info" style="margin-top:8px">${icon('info')}<div>The timer starts when you click <b>Start exam</b> and keeps running even if you close the browser. Your answers are saved automatically every 30 seconds.</div></div></div>`,
        });
        if (ok) navigate(`/take/${e.id}`);
      };
    });
  }

  async function studentExams(el) {
    el.innerHTML = loadingPage();
    const exams = await api('GET', '/exams');
    const groups = { active: [], upcoming: [], done: [] };
    exams.forEach((e) => { const s = studentExamState(e); groups[s.key].push({ e, s }); });
    let tab = groups.active.length || !groups.upcoming.length ? 'active' : 'upcoming';
    const draw = () => {
      el.innerHTML = `${pageHead({ title: 'My exams', subtitle: 'Exams you can sit now, upcoming exams and past attempts.' })}
        <div class="tabs" role="tablist">
          ${[['active', 'Available'], ['upcoming', 'Upcoming'], ['done', 'Completed']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}" data-tab="${k}">${l}${pill(groups[k].length, '', false)}</button>`).join('')}
        </div>
        <div class="grid grid-3">${groups[tab].map(({ e, s }) => studentExamCard(e, s)).join('') || `<div class="card" style="grid-column:1/-1">${empty('exam', 'Nothing here', tab === 'active' ? 'No exams are open for you right now.' : tab === 'upcoming' ? 'No upcoming exams are scheduled.' : 'You have not completed any exams yet.')}</div>`}</div>`;
      $$('[data-tab]', el).forEach((b) => { b.onclick = () => { tab = b.dataset.tab; draw(); }; });
      bindStudentExamActions(el, exams);
    };
    draw();
  }

  // ---------------------------------------------------------------- Exam taking
  let EXAM = null;

  const isAnswered = (q, answers) => {
    const v = answers[q.id];
    return q.type === 'mcq' ? v !== undefined && v !== null && v !== '' : String(v || '').trim().length > 0;
  };

  async function takeExam(_, { id }) {
    app.innerHTML = `<div class="exam-shell"><div class="success-screen"><span class="spinner" style="width:32px;height:32px"></span><p class="muted">Opening your exam…</p></div></div>`;
    let data;
    try {
      data = await api('POST', `/exams/${encodeURIComponent(id)}/start`);
    } catch (err) {
      app.innerHTML = `<div class="exam-shell"><div class="card success-screen">${empty('alert', 'Could not open the exam', err.message, '<a class="btn btn-primary" href="#/exams">Back to my exams</a>')}</div></div>`;
      return;
    }
    if (data.status !== 'in_progress') {
      toast('You have already submitted this exam.');
      navigate('/exams');
      return;
    }
    const offset = Date.now() - new Date(data.serverTime).getTime(); // corrects a wrong PC clock
    const localKey = `attempt-${data.attemptId}`;
    const local = store.localGet(localKey);
    const serverAnswers = data.answers || {};
    const answers = { ...serverAnswers, ...(local?.answers || {}) }; // local copy is never older than the server copy
    EXAM = {
      id, attemptId: data.attemptId, title: data.title, totalMarks: data.totalMarks,
      questions: data.questions, answers, localKey,
      flagged: new Set(local?.flagged || []),
      current: Math.min(local?.current || 0, data.questions.length - 1),
      deadline: new Date(data.deadline).getTime() + offset,
      dirty: JSON.stringify(answers) !== JSON.stringify(serverAnswers),
      lastSaved: data.lastSavedAt, saveState: data.lastSavedAt ? 'saved' : 'idle',
      warned: {}, timers: [], submitting: false,
    };
    renderExamShell();
    EXAM.timers.push(setInterval(saveAnswers, AUTOSAVE_MS), setInterval(tick, 1000));
    document.addEventListener('keydown', examKeys);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', beforeUnload);
    tick();
    if (EXAM.dirty) saveAnswers();
  }

  function renderExamShell() {
    app.innerHTML = `<div class="exam-shell">
      <header class="exam-top">
        <div class="title"><div class="brand-mark" style="width:30px;height:30px">${icon('exam')}</div><h1>${esc(EXAM.title)}</h1></div>
        <div class="tools">
          <span class="save-chip" id="save-chip" aria-live="polite"></span>
          <span class="timer" id="timer" role="timer" aria-label="Time remaining">--:--</span>
          <button class="btn btn-primary" id="open-submit">${icon('send')}<span>Submit</span></button>
        </div>
        <div class="exam-progress"><span id="progress-text"></span><div class="progress"><div id="progress-bar"></div></div><button class="btn btn-ghost btn-sm" id="exit-exam">Exit</button></div>
      </header>
      <div class="exam-body">
        <aside class="card qnav" aria-label="Question navigator">
          <h3>Questions</h3>
          <div class="qnav-grid" id="qnav"></div>
          <div class="legend"><span><i></i>Not answered</span><span><i class="a"></i>Answered</span><span><i class="f"></i>Flagged for review</span></div>
          <div class="divider" style="margin:14px 0"></div>
          <p class="tiny muted">Answers save automatically every 30 seconds and are also kept on this device.</p>
        </aside>
        <main class="card qpanel" id="qpanel"></main>
      </div></div>`;
    $('#open-submit').onclick = openSubmitDialog;
    $('#exit-exam').onclick = async () => {
      const ok = await modal({
        title: 'Leave the exam?', ic: 'alert', tone: 'danger', confirmText: 'Save and leave', cancelText: 'Keep working',
        body: '<p>Your answers will be saved, but <b>the timer keeps running</b>. You can come back and resume until the time runs out.</p>',
      });
      if (!ok) return;
      await saveAnswers();
      navigate('/exams');
    };
    $('#qnav').onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) goTo(Number(b.dataset.q)); };
    renderQuestion();
    renderNav();
    updateSaveChip();
  }

  function renderQuestion() {
    const q = EXAM.questions[EXAM.current];
    const n = EXAM.questions.length;
    const value = EXAM.answers[q.id];
    const flagged = EXAM.flagged.has(q.id);
    const letters = 'ABCDEFGHIJ';
    const body = q.type === 'mcq'
      ? `<div class="options" role="radiogroup" aria-label="Answer options">${q.options.map((o, i) => `
          <label class="option ${value === o ? 'selected' : ''}"><input type="radio" name="opt" value="${esc(o)}" ${value === o ? 'checked' : ''}>
          <span class="key">${letters[i]}</span><span>${esc(o)}</span></label>`).join('')}</div>
          ${value !== undefined && value !== '' ? '<div><button class="btn btn-ghost btn-sm" data-act="clear">Clear my answer</button></div>' : ''}`
      : `<label class="field"><span class="sr-only">Your answer</span><textarea class="textarea" id="short-answer" rows="12" placeholder="Type your answer here…">${esc(value || '')}</textarea></label>
          <div class="spread small muted"><span id="word-count">${plural(wordCount(value), 'word')}</span><span>Saved automatically</span></div>`;
    const panel = $('#qpanel');
    panel.innerHTML = `
      <div class="qhead">
        <div class="row" style="gap:8px">${pill(`Question ${EXAM.current + 1} of ${n}`, 'brand', false)}${pill(`${q.marks} mark${q.marks === 1 ? '' : 's'}`, '', false)}${pill(q.type === 'mcq' ? 'Multiple choice' : 'Short answer', '', false)}</div>
        <button class="btn ${flagged ? 'btn-secondary' : 'btn-ghost'} btn-sm" data-act="flag" aria-pressed="${flagged}">${icon('flag')}${flagged ? 'Flagged' : 'Flag for review'}</button>
      </div>
      <div class="qtext">${esc(q.text)}</div>
      ${body}
      <div class="qfoot">
        <button class="btn btn-secondary" data-act="prev" ${EXAM.current === 0 ? 'disabled' : ''}>${icon('left')}Previous</button>
        <span class="muted tiny" style="align-self:center;text-align:center">Keys: <span class="kbd">←</span> <span class="kbd">→</span> move${q.type === 'mcq' ? `, <span class="kbd">A</span>–<span class="kbd">${letters[q.options.length - 1]}</span> choose` : ''}</span>
        ${EXAM.current === n - 1 ? `<button class="btn btn-primary" data-act="review">Review &amp; submit${icon('right')}</button>` : `<button class="btn btn-primary" data-act="next">Next${icon('right')}</button>`}
      </div>`;
    panel.onchange = (e) => { if (e.target.name === 'opt') setAnswer(q.id, e.target.value, true); };
    panel.oninput = (e) => {
      if (e.target.id === 'short-answer') {
        setAnswer(q.id, e.target.value, false);
        $('#word-count').textContent = plural(wordCount(e.target.value), 'word');
      }
    };
    panel.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'prev') goTo(EXAM.current - 1);
      if (act === 'next') goTo(EXAM.current + 1);
      if (act === 'review') openSubmitDialog();
      if (act === 'clear') setAnswer(q.id, '', true);
      if (act === 'flag') {
        if (EXAM.flagged.has(q.id)) EXAM.flagged.delete(q.id); else EXAM.flagged.add(q.id);
        persistLocal();
        renderQuestion();
        renderNav();
      }
    };
  }

  function setAnswer(qid, value, rerender) {
    if (value === '') delete EXAM.answers[qid]; else EXAM.answers[qid] = value;
    EXAM.dirty = true;
    persistLocal();
    if (EXAM.saveState !== 'offline') { EXAM.saveState = 'unsaved'; updateSaveChip(); }
    if (rerender) renderQuestion();
    renderNav();
  }

  function persistLocal() {
    store.localSet(EXAM.localKey, { answers: EXAM.answers, flagged: [...EXAM.flagged], current: EXAM.current, at: Date.now() });
  }

  function goTo(i) {
    if (i < 0 || i >= EXAM.questions.length) return;
    EXAM.current = i;
    persistLocal();
    renderQuestion();
    renderNav();
    $('#qpanel').scrollIntoView({ block: 'nearest' });
    const firstInput = $('#short-answer');
    if (firstInput) firstInput.focus();
  }

  function renderNav() {
    const answered = EXAM.questions.filter((q) => isAnswered(q, EXAM.answers)).length;
    $('#qnav').innerHTML = EXAM.questions.map((q, i) => `<button class="${isAnswered(q, EXAM.answers) ? 'answered' : ''} ${EXAM.flagged.has(q.id) ? 'flagged' : ''} ${i === EXAM.current ? 'current' : ''}" data-q="${i}" aria-label="Question ${i + 1}${isAnswered(q, EXAM.answers) ? ', answered' : ''}${EXAM.flagged.has(q.id) ? ', flagged' : ''}">${i + 1}</button>`).join('');
    $('#progress-text').textContent = `${answered} of ${EXAM.questions.length} answered`;
    $('#progress-bar').style.width = `${(answered / EXAM.questions.length) * 100}%`;
  }

  function updateSaveChip() {
    const chip = $('#save-chip');
    if (!chip || !EXAM) return;
    const states = {
      idle: ['', 'cloud', 'Not saved yet'],
      unsaved: ['', 'cloud', 'Unsaved changes'],
      saving: ['', null, 'Saving…'],
      saved: ['ok', 'checkCircle', `Saved ${fmtTime(EXAM.lastSaved)}`],
      offline: ['warn', 'cloudOff', 'Offline – kept on this device, retrying'],
    };
    const [cls, ic, text] = states[EXAM.saveState];
    chip.className = `save-chip ${cls}`;
    chip.innerHTML = `${ic ? icon(ic) : '<span class="spinner" style="width:14px;height:14px"></span>'}<span>${esc(text)}</span>`;
    chip.title = text;
  }

  async function saveAnswers() {
    if (!EXAM || EXAM.saving || !EXAM.dirty || EXAM.submitting) return;
    const exam = EXAM;
    const snapshot = JSON.stringify(exam.answers);
    exam.saving = true;
    exam.saveState = 'saving';
    updateSaveChip();
    try {
      const { savedAt } = await api('PUT', `/attempts/${exam.attemptId}/answers`, { answers: JSON.parse(snapshot) });
      exam.lastSaved = savedAt;
      exam.dirty = JSON.stringify(exam.answers) !== snapshot;
      exam.saveState = exam.dirty ? 'unsaved' : 'saved';
    } catch (err) {
      if (err.status === 409) { exam.saving = false; return finishExam(true, 'This attempt was closed by the server (the time is up).'); }
      exam.saveState = 'offline'; // network blip or AZ failover: answers are safe in localStorage, retry next tick
    } finally {
      exam.saving = false;
      if (EXAM === exam) updateSaveChip();
    }
  }

  function tick() {
    if (!EXAM) return;
    const left = Math.max(0, EXAM.deadline - Date.now());
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    const t = $('#timer');
    if (!t) return;
    t.innerHTML = `${icon('clock')}${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    t.className = `timer ${left < 5 * 60000 ? 'danger' : left < 10 * 60000 ? 'warn' : ''}`;
    for (const [mins, msg] of [[10, '10 minutes left.'], [5, '5 minutes left – start wrapping up.'], [1, '1 minute left! Your answers will be submitted automatically.']]) {
      if (left <= mins * 60000 && left > (mins * 60000) - 5000 && !EXAM.warned[mins]) { EXAM.warned[mins] = true; toast(msg, mins <= 1 ? 'error' : 'info', 6000); }
    }
    if (left === 0 && !EXAM.submitting) submitExam(true);
  }

  async function openSubmitDialog() {
    const qs = EXAM.questions;
    const unanswered = qs.map((q, i) => (isAnswered(q, EXAM.answers) ? null : i + 1)).filter(Boolean);
    const flagged = qs.map((q, i) => (EXAM.flagged.has(q.id) ? i + 1 : null)).filter(Boolean);
    const ok = await modal({
      title: 'Submit your exam?', ic: 'send', confirmText: 'Submit exam', cancelText: 'Keep working',
      body: `<div class="stack">
        <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px;text-align:center">
          <div class="card card-pad" style="padding:12px"><div class="stat-value">${qs.length - unanswered.length}</div><div class="tiny muted">Answered</div></div>
          <div class="card card-pad" style="padding:12px"><div class="stat-value" style="color:${unanswered.length ? 'var(--danger)' : 'inherit'}">${unanswered.length}</div><div class="tiny muted">Unanswered</div></div>
          <div class="card card-pad" style="padding:12px"><div class="stat-value" style="color:${flagged.length ? 'var(--warning)' : 'inherit'}">${flagged.length}</div><div class="tiny muted">Flagged</div></div>
        </div>
        ${unanswered.length ? `<div class="alert warning">${icon('alert')}<div>Unanswered: question${unanswered.length > 1 ? 's' : ''} ${unanswered.join(', ')}.</div></div>` : '<div class="alert success">' + icon('checkCircle') + '<div>You have answered every question.</div></div>'}
        ${flagged.length ? `<div class="alert info">${icon('flag')}<div>Flagged for review: ${flagged.join(', ')}.</div></div>` : ''}
        <p>Once submitted, you can't change your answers.</p></div>`,
    });
    if (ok) submitExam(false);
  }

  async function submitExam(auto) {
    if (!EXAM || EXAM.submitting) return;
    const exam = EXAM;
    exam.submitting = true;
    const btn = $('#open-submit');
    setBusy(btn, true, 'Submitting…');
    try {
      await api('POST', `/attempts/${exam.attemptId}/submit`, { answers: exam.answers });
      finishExam(auto);
    } catch (err) {
      if (err.status === 409) return finishExam(true, 'Your time was up, so the answers saved so far were submitted.');
      exam.submitting = false;
      setBusy(btn, false);
      toast(`Could not submit: ${err.message} Retrying…`, 'error');
      if (auto) setTimeout(() => submitExam(true), 5000);
    }
  }

  function finishExam(auto, note) {
    if (!EXAM) return;
    const { title, localKey } = EXAM;
    store.localDel(localKey);
    stopExam(false);
    app.innerHTML = `<div class="exam-shell"><div class="card success-screen">
      <div class="big-icon">${icon('check')}</div>
      <h1>${auto ? 'Time is up – exam submitted' : 'Exam submitted'}</h1>
      <p class="muted">${esc(title)} · ${fmtDate(new Date())}</p>
      ${note ? `<div class="alert info">${icon('info')}<div>${esc(note)}</div></div>` : ''}
      <p>Multiple-choice questions are marked automatically. You will get an <b>email</b> when your tutor releases the results.</p>
      <div class="row" style="justify-content:center"><a class="btn btn-primary" href="#/">Back to dashboard</a><a class="btn btn-secondary" href="#/exams">My exams</a></div>
    </div></div>`;
  }

  function stopExam(saveFirst) {
    if (!EXAM) return;
    if (saveFirst && EXAM.dirty) saveAnswers(); // fire-and-forget; answers are also in localStorage
    EXAM.timers.forEach(clearInterval);
    document.removeEventListener('keydown', examKeys);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', beforeUnload);
    EXAM = null;
  }

  function examKeys(e) {
    if (!EXAM || $('#modal-root').children.length) return;
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'radio') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(EXAM.current + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(EXAM.current - 1); }
    const q = EXAM.questions[EXAM.current];
    const idx = 'abcdefghij'.indexOf(e.key.toLowerCase());
    if (q.type === 'mcq' && e.key.length === 1 && idx >= 0 && idx < q.options.length) { e.preventDefault(); setAnswer(q.id, q.options[idx], true); }
  }
  function onVisibility() { if (document.visibilityState === 'hidden') saveAnswers(); }
  function beforeUnload(e) { if (EXAM?.dirty) { e.preventDefault(); e.returnValue = ''; } }

  // ---------------------------------------------------------------- Student assignments
  function duePill(a) {
    const due = a.due_at ? new Date(a.due_at) : null;
    if (a.my_last_submission) {
      const late = due && new Date(a.my_last_submission) > due;
      return pill(late ? 'Submitted late' : 'Submitted', late ? 'warning' : 'success');
    }
    if (!due) return pill('No deadline', '');
    const ms = due - Date.now();
    if (ms < 0) return pill('Overdue', 'danger');
    if (ms < 48 * 3600000) return pill(`Due ${fmtRel(due)}`, 'warning');
    return pill(`Due ${fmtRel(due)}`, 'info');
  }

  const fileIcon = (name) => `<div class="file-icon ${/\.zip$/i.test(name || '') ? 'zip' : ''}">${icon(/\.zip$/i.test(name || '') ? 'zip' : 'file')}</div>`;

  async function studentAssignments(el) {
    el.innerHTML = loadingPage();
    const list = await api('GET', '/assignments');
    el.innerHTML = `${pageHead({ title: 'Assignments', subtitle: 'Upload your work as a PDF or ZIP file (up to 50 MB). You can upload a new version at any time before the deadline.' })}
      <div class="grid grid-2">${list.map((a) => `
        <div class="card item-card" data-assignment="${esc(a.id)}">
          <div class="spread" style="align-items:flex-start"><h3>${esc(a.title)}</h3>${duePill(a)}</div>
          ${a.description ? `<p class="muted small" style="white-space:pre-wrap">${esc(a.description)}</p>` : ''}
          <div class="meta"><span>${icon('calendar')}${a.due_at ? `Due ${fmtDate(a.due_at)}` : 'No deadline'}</span>${a.tutor_email ? `<span>${icon('user')}${esc(a.tutor_email)}</span>` : ''}</div>
          ${a.my_last_submission ? `<div class="upload-state"><div class="file-row">${fileIcon(a.my_last_file)}<div style="min-width:0"><div class="fname">${esc(a.my_last_file || 'Your file')}</div><div class="tiny muted">${fmtBytes(a.my_last_size)} · submitted ${fmtRel(a.my_last_submission)}</div></div><span style="margin-left:auto;color:var(--success)">${icon('checkCircle')}</span></div></div>` : ''}
          <div data-upload-area>${dropzone(a)}</div>
        </div>`).join('') || `<div class="card" style="grid-column:1/-1">${empty('inbox', 'No assignments yet', 'Assignments from your tutors will appear here.')}</div>`}</div>`;
    $$('[data-assignment]', el).forEach((card) => bindDropzone(card, card.dataset.assignment));
  }

  const dropzone = (a) => `<label class="dropzone">${icon('upload')}<b>${a.my_last_submission ? 'Upload a new version' : 'Drop your PDF or ZIP here'}</b><span class="small">or click to choose a file · max 50 MB</span><input type="file" accept=".pdf,.zip,application/pdf,application/zip"></label>`;

  function bindDropzone(card, assignmentId) {
    const zone = $('.dropzone', card);
    if (!zone) return;
    const input = $('input[type=file]', zone);
    input.onchange = () => { if (input.files[0]) uploadFile(card, assignmentId, input.files[0]); };
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) uploadFile(card, assignmentId, f);
    });
  }

  // Walkthrough 2: ask the API for a presigned POST, then send the file directly to S3.
  async function uploadFile(card, assignmentId, file) {
    const area = $('[data-upload-area]', card);
    if (!/\.(pdf|zip)$/i.test(file.name)) return toast('Only PDF or ZIP files can be uploaded.', 'error');
    if (file.size > MAX_UPLOAD) return toast(`That file is ${fmtBytes(file.size)}. The limit is 50 MB.`, 'error');
    if (file.size === 0) return toast('That file is empty.', 'error');
    area.innerHTML = `<div class="upload-state"><div class="file-row">${fileIcon(file.name)}<div style="min-width:0;flex:1"><div class="fname">${esc(file.name)}</div><div class="tiny muted" data-status>Preparing secure upload…</div></div><button class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div><div class="progress"><div style="width:0%"></div></div></div>`;
    const bar = $('.progress > div', area);
    const status = $('[data-status]', area);
    let xhr;
    $('[data-cancel]', area).onclick = () => { if (xhr) xhr.abort(); };
    const reset = () => { area.innerHTML = dropzone({ my_last_submission: true }); bindDropzone(card, assignmentId); };
    try {
      const { url, fields } = await api('POST', `/assignments/${assignmentId}/upload-url`, { fileName: file.name, size: file.size });
      const form = new FormData();
      Object.entries(fields).forEach(([k, val]) => form.append(k, val));
      form.append('file', file); // must be the last field
      const started = Date.now();
      await new Promise((resolve, reject) => {
        xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const p = ev.loaded / ev.total;
          const secs = (Date.now() - started) / 1000;
          const speed = ev.loaded / Math.max(secs, 0.1);
          const remaining = (ev.total - ev.loaded) / Math.max(speed, 1);
          bar.style.width = `${(p * 100).toFixed(1)}%`;
          status.textContent = `${Math.round(p * 100)}% · ${fmtBytes(ev.loaded)} of ${fmtBytes(ev.total)} · ${fmtBytes(speed)}/s${p < 1 ? ` · about ${Math.ceil(remaining)}s left` : ''}`;
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 400 || xhr.status === 403 ? 'The upload was rejected (the file may be too large or the link expired). Please try again.' : `Upload failed (${xhr.status}).`)));
        xhr.onerror = () => reject(new Error('Upload failed – check your connection and try again.'));
        xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { cancelled: true }));
        xhr.send(form);
      });
      bar.parentElement.classList.add('success');
      bar.style.width = '100%';
      status.innerHTML = `<span style="color:var(--success)">Uploaded successfully – your tutor has been notified.</span>`;
      $('[data-cancel]', area).remove();
      toast(`${file.name} uploaded.`, 'success');
      setTimeout(() => { if (document.body.contains(card)) render(); }, 1800);
    } catch (err) {
      toast(err.message, err.cancelled ? 'info' : 'error');
      reset();
    }
  }

  // ---------------------------------------------------------------- Student results
  async function studentResults(el) {
    el.innerHTML = loadingPage();
    const results = await api('GET', '/results');
    el.innerHTML = `${pageHead({ title: 'Results', subtitle: 'Results appear here once your tutor releases them. You also get an email.' })}
      <div class="stack">${results.map((r) => `
        <div class="card card-pad stack">
          <div class="row" style="gap:20px;align-items:center">
            ${scoreRing(r.percent, `${fmtScore(r.total_score)}/${fmtScore(r.max_score)}`)}
            <div class="stack-sm" style="flex:1;min-width:200px">
              <h2>${esc(r.title)}</h2>
              <div class="muted small">Submitted ${fmtDate(r.submitted_at)}</div>
              <div class="row" style="gap:8px">${pill(`Multiple choice: ${fmtScore(r.mcq_score)}`, '', false)}${r.manual_score !== null ? pill(`Written: ${fmtScore(r.manual_score)}`, '', false) : ''}</div>
            </div>
          </div>
          ${r.feedback ? `<div class="alert info">${icon('pen')}<div><b>Feedback from your tutor</b><div style="white-space:pre-wrap;margin-top:4px">${esc(r.feedback)}</div></div></div>` : ''}
          <details class="disclosure"><summary>${icon('right')}Question-by-question breakdown</summary>
            <div class="breakdown" style="margin-top:12px">${r.breakdown.map((b, i) => breakdownItem(b, i)).join('')}</div>
          </details>
        </div>`).join('') || `<div class="card">${empty('award', 'No results yet', 'When a tutor releases results for an exam you sat, they will appear here.')}</div>`}</div>`;
  }

  function breakdownItem(b, i) {
    if (b.type === 'mcq') {
      return `<div class="bq ${b.correct ? 'correct' : 'wrong'}">
        <div class="spread"><b>${i + 1}. ${esc(b.text)}</b>${pill(`${fmtScore(b.awarded)} / ${fmtScore(b.marks)}`, b.correct ? 'success' : 'danger', false)}</div>
        <div class="small">${b.correct ? icon('checkCircle') : icon('xCircle')} Your answer: <b>${esc(b.answer ?? 'No answer')}</b></div>
        ${b.correct ? '' : `<div class="small muted">Correct answer: <b>${esc(b.correctAnswer)}</b></div>`}</div>`;
    }
    return `<div class="bq manual"><div class="spread"><b>${i + 1}. ${esc(b.text)}</b>${pill(`${fmtScore(b.awarded)} / ${fmtScore(b.marks)}`, 'info', false)}</div>
      <div class="answer-box">${esc(b.answer || 'No answer')}</div></div>`;
  }

  // =====================================================================================
  // TUTOR
  // =====================================================================================
  async function tutorDashboard(el) {
    el.innerHTML = loadingPage();
    const [exams, assignments] = await Promise.all([api('GET', '/exams'), api('GET', '/assignments')]);
    const toMark = exams.filter((e) => e.awaiting_marking > 0);
    const ready = exams.filter((e) => !e.results_released && e.submitted > 0 && e.awaiting_marking === 0 && e.submitted === e.attempts);
    el.innerHTML = `${pageHead({ title: `${greeting()} 👋`, subtitle: 'Your exams and coursework at a glance.', actions: `<a class="btn btn-secondary" href="#/assignments">${icon('upload')}Assignments</a><a class="btn btn-primary" href="#/exams/new">${icon('plus')}Create exam</a>` })}
      <div class="grid grid-stats">
        ${stat('exam', 'brand', exams.length, 'Exams')}
        ${stat('clock', 'info', exams.filter((e) => examWindow(e) === 'open' && !e.results_released).length, 'Open now')}
        ${stat('pen', 'warning', exams.reduce((s, e) => s + e.awaiting_marking, 0), 'Attempts to mark')}
        ${stat('inbox', 'success', assignments.reduce((s, a) => s + a.submissions, 0), 'Assignment uploads')}
      </div>
      <div class="grid grid-2" style="margin-top:24px">
        <div class="card"><div class="card-head"><h2>Needs marking</h2>${toMark.length ? pill(toMark.length, 'warning', false) : ''}</div><div class="card-body stack-sm">
          ${toMark.map((e) => `<div class="spread"><div><b>${esc(e.title)}</b><div class="muted small">${plural(e.awaiting_marking, 'attempt')} waiting</div></div><a class="btn btn-secondary btn-sm" href="#/exams/${esc(e.id)}">Mark</a></div>`).join('<div class="divider"></div>') || '<p class="muted">All caught up. 🎉</p>'}
        </div></div>
        <div class="card"><div class="card-head"><h2>Ready to release</h2></div><div class="card-body stack-sm">
          ${ready.map((e) => `<div class="spread"><div><b>${esc(e.title)}</b><div class="muted small">${plural(e.submitted, 'submission')} · average ${e.average_percent ?? '—'}%</div></div><a class="btn btn-secondary btn-sm" href="#/exams/${esc(e.id)}">Review</a></div>`).join('<div class="divider"></div>') || '<p class="muted">Nothing is waiting to be released.</p>'}
        </div></div>
      </div>
      <div class="section-title"><h2>Recent exams</h2><a class="small" href="#/exams">View all</a></div>
      ${examsTable(exams.slice(0, 5))}`;
    bindRowLinks(el);
  }

  function examsTable(exams, showTutor = false) {
    if (!exams.length) return `<div class="card">${empty('exam', 'No exams yet', 'Create your first exam to get started.', '<a class="btn btn-primary" href="#/exams/new">' + icon('plus') + 'Create exam</a>')}</div>`;
    return `<div class="card table-wrap"><table class="table"><thead><tr><th>Exam</th>${showTutor ? '<th>Tutor</th>' : ''}<th>Status</th><th>Window</th><th class="num">Questions</th><th class="num">Submitted</th><th class="num">Avg</th><th></th></tr></thead><tbody>
      ${exams.map((e) => `<tr class="clickable" data-href="/exams/${esc(e.id)}"><td><b>${esc(e.title)}</b><div class="muted tiny">${esc(e.duration_minutes)} min · ${fmtScore(e.total_marks)} marks</div></td>${showTutor ? `<td class="small">${esc(e.tutor_email)}</td>` : ''}
        <td>${tutorExamPill(e)}${e.awaiting_marking ? ` ${pill(`${e.awaiting_marking} to mark`, 'warning', false)}` : ''}</td><td class="small muted">${windowText(e)}</td>
        <td class="num">${esc(e.question_count)}</td><td class="num">${esc(e.submitted)}/${esc(e.attempts)}</td><td class="num">${e.average_percent === null ? '—' : `${e.average_percent}%`}</td><td>${icon('right')}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function bindRowLinks(el) {
    $$('[data-href]', el).forEach((row) => { row.onclick = (e) => { if (!e.target.closest('a,button,input')) navigate(row.dataset.href); }; });
  }

  async function tutorExams(el) {
    el.innerHTML = loadingPage();
    const exams = await api('GET', '/exams');
    el.innerHTML = `${pageHead({ title: 'Exams', subtitle: 'Create exams, follow attempts, mark and release results.', actions: `<a class="btn btn-primary" href="#/exams/new">${icon('plus')}Create exam</a>` })}
      <div class="row" style="margin-bottom:14px"><div class="search" style="flex:1;max-width:360px">${icon('search')}<input class="input" placeholder="Search exams…" id="exam-search" aria-label="Search exams"></div></div>
      <div id="exam-table">${examsTable(exams)}</div>`;
    bindRowLinks(el);
    $('#exam-search', el).oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $('#exam-table', el).innerHTML = examsTable(exams.filter((x) => x.title.toLowerCase().includes(q)));
      bindRowLinks(el);
    };
  }

  // ---------------------------------------------------------------- Exam builder
  const SAMPLE_QUESTIONS = [
    { type: 'mcq', text: 'Which AWS service stores the assignment files?', options: ['Amazon S3', 'Amazon SQS', 'Amazon SES', 'Amazon EBS'], answer: 0, marks: 2 },
    { type: 'mcq', text: 'What does RDS Multi-AZ provide?', options: ['A synchronous standby database in another Availability Zone', 'A read replica in another region', 'Automatic sharding', 'Nothing extra'], answer: 0, marks: 2 },
    { type: 'mcq', text: 'Which service buffers marking work so that peaks do not overload the database?', options: ['Amazon SQS', 'Amazon Route 53', 'AWS WAF', 'Amazon CloudFront'], answer: 0, marks: 2 },
    { type: 'short', text: 'Explain why presigned URLs are used for 50 MB assignment uploads.', marks: 6 },
  ];
  const newQid = () => `q${Math.random().toString(36).slice(2, 9)}`;
  const newQuestion = (type) => (type === 'mcq'
    ? { id: newQid(), type, text: '', options: ['', '', '', ''], answer: 0, marks: 1 }
    : { id: newQid(), type, text: '', marks: 5 });

  function examBuilder(el) {
    const draft = store.localGet('exam-draft');
    const B = draft || { title: '', description: '', duration: 60, opensAt: '', closesAt: '', questions: [] };
    const saveDraft = () => store.localSet('exam-draft', B);

    el.innerHTML = `${pageHead({ title: 'Create exam', crumbs: [['Exams', '/exams'], ['New exam']], subtitle: 'Add the exam details and questions, then publish it to students.' })}
      ${draft ? `<div class="alert info" style="margin-bottom:16px">${icon('info')}<div style="flex:1">We restored the draft you were working on.</div><button class="btn btn-ghost btn-sm" id="discard-draft">Discard draft</button></div>` : ''}
      <div class="grid builder-layout">
        <div class="stack">
          <div class="card"><div class="card-head"><h2>Details</h2></div><div class="card-body stack">
            <label class="field"><span>Exam title</span><input class="input" data-b="title" maxlength="200" placeholder="e.g. Cloud Computing – Mid-term exam" value="${esc(B.title)}"></label>
            <label class="field"><span>Instructions for students <span class="hint">(optional)</span></span><textarea class="textarea" data-b="description" rows="2" maxlength="2000" placeholder="e.g. Answer all questions. Calculators are not allowed.">${esc(B.description)}</textarea></label>
            <div class="form-grid">
              <label class="field"><span>Duration (minutes)</span><input class="input" type="number" min="1" max="480" data-b="duration" value="${esc(B.duration)}"></label>
              <label class="field"><span>Opens <span class="hint">(optional)</span></span><input class="input" type="datetime-local" data-b="opensAt" value="${esc(B.opensAt)}"></label>
              <label class="field"><span>Closes <span class="hint">(optional)</span></span><input class="input" type="datetime-local" data-b="closesAt" value="${esc(B.closesAt)}"></label>
            </div>
            <p class="hint muted small">Students can start any time between "Opens" and "Closes". Each student gets the full duration, but must finish by the closing time.</p>
          </div></div>
          <div class="spread"><h2>Questions</h2><div class="row" style="gap:8px">
            <button class="btn btn-secondary btn-sm" data-add="mcq">${icon('plus')}Multiple choice</button>
            <button class="btn btn-secondary btn-sm" data-add="short">${icon('plus')}Short answer</button></div></div>
          <div id="q-list" class="stack"></div>
          <details class="disclosure card card-pad"><summary>${icon('right')}Import questions from JSON</summary>
            <div class="stack" style="margin-top:12px"><p class="small muted">Paste an array like <span class="mono">[{"type":"mcq","text":"…","options":["A","B"],"answer":"A","marks":2},{"type":"short","text":"…","marks":5}]</span></p>
            <textarea class="textarea mono" id="import-json" rows="5"></textarea><div><button class="btn btn-secondary btn-sm" id="import-btn">Import questions</button></div></div>
          </details>
        </div>
        <aside><div class="card card-pad builder-summary stack" id="summary"></div></aside>
      </div>`;

    const list = $('#q-list', el);
    const letters = 'ABCDEFGHIJ';
    const drawQuestions = () => {
      list.innerHTML = B.questions.map((q, i) => `
        <div class="q-card" data-qi="${i}">
          <div class="q-card-head">
            <span class="qnum">${i + 1}</span>
            <select class="select" data-f="type" style="width:auto;min-height:34px" aria-label="Question type"><option value="mcq" ${q.type === 'mcq' ? 'selected' : ''}>Multiple choice</option><option value="short" ${q.type === 'short' ? 'selected' : ''}>Short answer</option></select>
            <label class="input-group small muted" style="margin-left:auto">Marks <input class="input" type="number" min="1" max="100" step="1" data-f="marks" value="${esc(q.marks)}" style="width:76px;min-height:34px"></label>
            <button class="btn btn-ghost btn-icon btn-sm" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
            <button class="btn btn-ghost btn-icon btn-sm" data-act="down" ${i === B.questions.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
            <button class="btn btn-ghost btn-icon btn-sm" data-act="remove" aria-label="Delete question" style="color:var(--danger)">${icon('trash')}</button>
          </div>
          <div class="q-card-body">
            <label class="field"><span>Question</span><textarea class="textarea" data-f="text" rows="2" placeholder="Type the question…">${esc(q.text)}</textarea></label>
            ${q.type === 'mcq' ? `<div class="stack-sm"><span class="label">Options <span class="hint">– tick the correct answer</span></span>
              ${q.options.map((o, j) => `<div class="opt-row ${q.answer === j ? 'is-correct' : ''}">
                <label class="correct" title="Mark as correct"><input type="radio" name="correct-${q.id}" data-f="answer" value="${j}" ${q.answer === j ? 'checked' : ''}>${letters[j]}</label>
                <input class="input" data-f="option" data-oi="${j}" value="${esc(o)}" placeholder="Option ${letters[j]}">
                <button class="btn btn-ghost btn-icon btn-sm" data-act="remove-opt" data-oi="${j}" ${q.options.length <= 2 ? 'disabled' : ''} aria-label="Remove option">${icon('x')}</button></div>`).join('')}
              ${q.options.length < 10 ? `<div><button class="btn btn-ghost btn-sm" data-act="add-opt">${icon('plus')}Add option</button></div>` : ''}</div>`
              : `<div class="alert info">${icon('info')}<div>Students type a written answer. You mark it after the exam (0–${esc(q.marks)} marks).</div></div>`}
          </div></div>`).join('') || `<div class="card">${empty('exam', 'No questions yet', 'Add multiple-choice or short-answer questions, or start from a sample.', `<div class="row" style="justify-content:center"><button class="btn btn-primary" data-add="mcq">${icon('plus')}Add a question</button><button class="btn btn-secondary" id="load-sample">Load sample questions</button></div>`)}</div>`;
      const sample = $('#load-sample', el);
      if (sample) sample.onclick = () => { B.questions = SAMPLE_QUESTIONS.map((q) => ({ ...q, id: newQid(), options: q.options ? [...q.options] : undefined })); changed(true); };
      $$('[data-add]', list).forEach(bindAdd);
    };

    const toPayloadQuestions = () => B.questions.map((q) => (q.type === 'mcq'
      ? { id: q.id, type: 'mcq', text: q.text.trim(), options: q.options.map((o) => o.trim()), answer: (q.options[q.answer] || '').trim(), marks: Number(q.marks) }
      : { id: q.id, type: 'short', text: q.text.trim(), marks: Number(q.marks) }));

    const validate = () => {
      const errors = [];
      if (!B.title.trim()) errors.push('Add an exam title.');
      const d = Number(B.duration);
      if (!(d >= 1 && d <= 480 && Number.isInteger(d))) errors.push('Duration must be a whole number between 1 and 480 minutes.');
      if (B.opensAt && B.closesAt && new Date(B.closesAt) <= new Date(B.opensAt)) errors.push('"Closes" must be after "Opens".');
      if (!B.questions.length) errors.push('Add at least one question.');
      B.questions.forEach((q, i) => {
        const n = `Question ${i + 1}`;
        if (!q.text.trim()) errors.push(`${n}: type the question.`);
        if (!(Number(q.marks) >= 1 && Number(q.marks) <= 100)) errors.push(`${n}: marks must be 1–100.`);
        if (q.type === 'mcq') {
          const opts = q.options.map((o) => o.trim());
          if (opts.some((o) => !o)) errors.push(`${n}: fill in every option (or remove empty ones).`);
          else if (new Set(opts).size !== opts.length) errors.push(`${n}: options must be different.`);
        }
      });
      return errors;
    };

    const drawSummary = (showErrors = false) => {
      const mcq = B.questions.filter((q) => q.type === 'mcq').length;
      const total = B.questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
      const errors = validate();
      $('#summary', el).innerHTML = `<h2>Summary</h2>
        <dl class="kv"><dt>Questions</dt><dd><b>${B.questions.length}</b> (${mcq} multiple choice, ${B.questions.length - mcq} short)</dd>
        <dt>Total marks</dt><dd><b>${total}</b></dd><dt>Duration</dt><dd>${esc(B.duration || '—')} min</dd>
        <dt>Auto-marked</dt><dd>${total ? Math.round((B.questions.filter((q) => q.type === 'mcq').reduce((s, q) => s + Number(q.marks || 0), 0) / total) * 100) : 0}% of marks</dd></dl>
        ${showErrors && errors.length ? `<div class="alert danger">${icon('alert')}<div><b>Please fix:</b><ul style="margin:6px 0 0;padding-left:18px">${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>` : ''}
        <button class="btn btn-primary btn-block" id="publish">${icon('send')}Publish exam</button>
        <a class="btn btn-ghost btn-block" href="#/exams">Cancel</a>
        <p class="tiny muted">Drafts are saved on this device automatically.</p>`;
      $('#publish', el).onclick = publish;
    };

    const changed = (redraw) => { saveDraft(); if (redraw) drawQuestions(); drawSummary(); };

    const bindAdd = (btn) => { btn.onclick = () => { B.questions.push(newQuestion(btn.dataset.add)); changed(true); const cards = $$('.q-card', list); cards[cards.length - 1]?.querySelector('textarea')?.focus(); }; };
    $$('[data-add]', el).forEach(bindAdd);

    el.addEventListener('input', (e) => {
      const b = e.target.dataset.b;
      if (b) { B[b] = e.target.value; changed(false); return; }
      const card = e.target.closest('[data-qi]');
      if (!card) return;
      const q = B.questions[Number(card.dataset.qi)];
      const f = e.target.dataset.f;
      if (f === 'text') q.text = e.target.value;
      if (f === 'marks') q.marks = e.target.value;
      if (f === 'option') q.options[Number(e.target.dataset.oi)] = e.target.value;
      changed(false);
    });
    list.addEventListener('change', (e) => {
      const card = e.target.closest('[data-qi]');
      if (!card) return;
      const q = B.questions[Number(card.dataset.qi)];
      if (e.target.dataset.f === 'answer') { q.answer = Number(e.target.value); changed(true); }
      if (e.target.dataset.f === 'type') {
        const fresh = newQuestion(e.target.value);
        B.questions[Number(card.dataset.qi)] = { ...fresh, id: q.id, text: q.text };
        changed(true);
      }
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('[data-qi]');
      if (!btn || !card) return;
      const i = Number(card.dataset.qi);
      const q = B.questions[i];
      const act = btn.dataset.act;
      if (act === 'remove') B.questions.splice(i, 1);
      if (act === 'up' && i > 0) [B.questions[i - 1], B.questions[i]] = [B.questions[i], B.questions[i - 1]];
      if (act === 'down' && i < B.questions.length - 1) [B.questions[i + 1], B.questions[i]] = [B.questions[i], B.questions[i + 1]];
      if (act === 'add-opt') q.options.push('');
      if (act === 'remove-opt') {
        const j = Number(btn.dataset.oi);
        q.options.splice(j, 1);
        if (q.answer === j) q.answer = 0; else if (q.answer > j) q.answer -= 1;
      }
      changed(true);
    });

    const discard = $('#discard-draft', el);
    if (discard) discard.onclick = () => { store.localDel('exam-draft'); render(); };

    $('#import-btn', el).onclick = () => {
      try {
        const arr = JSON.parse($('#import-json', el).value);
        if (!Array.isArray(arr)) throw new Error('The JSON must be an array of questions.');
        const imported = arr.map((q) => (q.type === 'mcq'
          ? { id: newQid(), type: 'mcq', text: String(q.text || ''), options: (q.options || []).map(String), answer: Math.max(0, (q.options || []).indexOf(q.answer)), marks: Number(q.marks) || 1 }
          : { id: newQid(), type: 'short', text: String(q.text || ''), marks: Number(q.marks) || 5 }));
        B.questions.push(...imported);
        changed(true);
        toast(`Imported ${plural(imported.length, 'question')}.`, 'success');
      } catch (err) { toast(`Could not import: ${err.message}`, 'error'); }
    };

    async function publish() {
      const errors = validate();
      if (errors.length) { drawSummary(true); $('#summary', el).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      const btn = $('#publish', el);
      setBusy(btn, true, 'Publishing…');
      try {
        const { id } = await api('POST', '/exams', {
          title: B.title.trim(), description: B.description.trim() || null, durationMinutes: Number(B.duration),
          opensAt: fromLocalInput(B.opensAt), closesAt: fromLocalInput(B.closesAt), questions: toPayloadQuestions(),
        });
        store.localDel('exam-draft');
        toast('Exam published.', 'success');
        navigate(`/exams/${id}`);
      } catch (err) {
        setBusy(btn, false);
        toast(err.message, 'error');
      }
    }

    drawQuestions();
    drawSummary();
  }

  // ---------------------------------------------------------------- Tutor exam detail
  async function tutorExamDetail(el, { id }) {
    el.innerHTML = loadingPage();
    const { exam, attempts } = await api('GET', `/exams/${encodeURIComponent(id)}/attempts`);
    const submitted = attempts.filter((a) => a.status !== 'in_progress');
    const marked = attempts.filter((a) => a.status === 'marked');
    const awaiting = attempts.filter((a) => a.status === 'awaiting_manual');
    const sitting = attempts.filter((a) => a.status === 'in_progress');
    const percents = marked.map((a) => pct(a.total_score, a.max_score)).filter((p) => p !== null);
    const avg = percents.length ? Math.round((percents.reduce((s, p) => s + p, 0) / percents.length) * 10) / 10 : null;
    const buckets = Array(10).fill(0);
    percents.forEach((p) => { buckets[Math.min(9, Math.floor(p / 10))] += 1; });
    const maxBucket = Math.max(1, ...buckets);
    const mcqCount = exam.questions.filter((q) => q.type === 'mcq').length;
    let tab = 'students';

    const canRelease = !exam.results_released && submitted.length > 0 && !awaiting.length && !sitting.length && !submitted.some((a) => a.status === 'submitted');
    const releaseHint = exam.results_released ? 'Results have been released.'
      : !submitted.length ? 'No submissions yet.'
        : sitting.length ? `${plural(sitting.length, 'student')} still sitting the exam.`
          : awaiting.length ? `${plural(awaiting.length, 'attempt')} still need marking.` : 'Ready to release.';

    const draw = () => {
      el.innerHTML = `${pageHead({
        title: esc(exam.title),
        crumbs: [['Exams', '/exams'], [exam.title]],
        subtitle: `${tutorExamPill(exam)} &nbsp; ${esc(exam.duration_minutes)} min · ${plural(exam.questions.length, 'question')} · ${fmtScore(exam.total_marks)} marks · ${windowText(exam)}`,
        actions: `${!attempts.length ? `<button class="btn btn-ghost" id="delete-exam" style="color:var(--danger)">${icon('trash')}Delete</button>` : ''}
          <button class="btn btn-secondary" id="edit-schedule">${icon('calendar')}Schedule</button>
          <button class="btn btn-primary" id="release" ${canRelease ? '' : 'disabled'} title="${esc(releaseHint)}">${icon('send')}${exam.results_released ? 'Results released' : 'Release results'}</button>`,
      })}
        ${exam.description ? `<div class="card card-pad muted small" style="margin-bottom:16px;white-space:pre-wrap">${esc(exam.description)}</div>` : ''}
        ${awaiting.length ? `<div class="alert warning" style="margin-bottom:16px">${icon('pen')}<div style="flex:1">${plural(awaiting.length, 'attempt')} need${awaiting.length === 1 ? 's' : ''} short answers marked before you can release results.</div><a class="btn btn-secondary btn-sm" href="#/exams/${esc(exam.id)}/mark/${esc(awaiting[0].id)}">Start marking</a></div>` : ''}
        ${!exam.results_released && submitted.length && !awaiting.length && !sitting.length ? `<div class="alert success" style="margin-bottom:16px">${icon('checkCircle')}<div>Every attempt is marked. Release the results to email students.</div></div>` : ''}
        <div class="grid grid-stats">
          ${stat('users', 'brand', attempts.length, 'Students started')}
          ${stat('send', 'info', submitted.length, 'Submitted')}
          ${stat('pen', 'warning', awaiting.length, 'Need marking')}
          ${stat('chart', 'success', avg === null ? '—' : `${avg}%`, 'Average score')}
        </div>
        ${percents.length ? `<div class="card card-pad" style="margin-top:16px"><div class="spread"><h3>Score distribution</h3><span class="muted small">${plural(percents.length, 'marked attempt')}</span></div>
          <div class="bars" aria-label="Score distribution">${buckets.map((b) => `<div class="bar" style="height:${(b / maxBucket) * 100}%;opacity:${b ? 1 : 0.25}"><span>${b || ''}</span></div>`).join('')}</div>
          <div class="bars-x">${buckets.map((_, i) => `<span>${i * 10}${i === 9 ? '+' : ''}</span>`).join('')}</div></div>` : ''}
        <div class="tabs" style="margin-top:24px" role="tablist">
          <button class="${tab === 'students' ? 'active' : ''}" data-tab="students">Students${pill(attempts.length, '', false)}</button>
          <button class="${tab === 'questions' ? 'active' : ''}" data-tab="questions">Questions${pill(exam.questions.length, '', false)}</button>
        </div>
        <div id="tab-body">${tab === 'students' ? attemptsTable() : questionsList()}</div>`;
      $$('[data-tab]', el).forEach((b) => { b.onclick = () => { tab = b.dataset.tab; draw(); }; });
      bindRowLinks(el);
      $('#release', el).onclick = release;
      $('#edit-schedule', el).onclick = editSchedule;
      const del = $('#delete-exam', el);
      if (del) del.onclick = deleteExam;
    };

    const attemptsTable = () => (attempts.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>Student</th><th>Status</th><th>Submitted</th><th class="num">Auto</th><th class="num">Written</th><th class="num">Total</th><th></th></tr></thead><tbody>
      ${attempts.map((a) => `<tr ${a.status !== 'in_progress' ? `class="clickable" data-href="/exams/${esc(exam.id)}/mark/${esc(a.id)}"` : ''}>
        <td><div class="row" style="gap:10px;flex-wrap:nowrap"><div class="avatar" style="width:30px;height:30px;font-size:11px">${esc(initials(a.student_email))}</div><span>${esc(a.student_email)}</span></div></td>
        <td>${attemptPill(a.status)}</td>
        <td class="small muted nowrap">${a.submitted_at ? fmtDate(a.submitted_at) : `Last saved ${a.last_saved_at ? fmtRel(a.last_saved_at) : 'never'}`}</td>
        <td class="num">${fmtScore(a.mcq_score)}</td><td class="num">${fmtScore(a.manual_score)}</td>
        <td class="num"><b>${a.total_score !== null && a.status === 'marked' ? `${fmtScore(a.total_score)}/${fmtScore(a.max_score)}` : '—'}</b></td>
        <td>${a.status === 'in_progress' ? '' : `<a class="btn btn-${a.status === 'awaiting_manual' ? 'primary' : 'secondary'} btn-sm" href="#/exams/${esc(exam.id)}/mark/${esc(a.id)}">${a.status === 'awaiting_manual' ? 'Mark' : 'Review'}</a>`}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card">${empty('users', 'No attempts yet', 'Students who start this exam will appear here, with live status.')}</div>`);

    const questionsList = () => `<div class="stack">${exam.questions.map((q, i) => `<div class="card card-pad stack-sm">
        <div class="spread"><b>${i + 1}. ${esc(q.text)}</b><div class="row" style="gap:6px">${pill(q.type === 'mcq' ? 'Multiple choice' : 'Short answer', '', false)}${pill(`${q.marks} marks`, 'brand', false)}</div></div>
        ${q.type === 'mcq' ? `<div class="stack-sm">${q.options.map((o) => `<div class="small" style="${o === q.answer ? 'color:var(--success);font-weight:600' : ''}">${o === q.answer ? icon('checkCircle') : icon('x', 'muted')} ${esc(o)}</div>`).join('')}</div>` : '<p class="small muted">Marked by the tutor.</p>'}
      </div>`).join('')}<p class="small muted">${mcqCount} of ${exam.questions.length} questions are marked automatically.</p></div>`;

    async function release() {
      const ok = await modal({
        title: 'Release results?', ic: 'send', confirmText: 'Release and email students',
        body: `<p><b>${plural(submitted.length, 'student')}</b> will be able to see their result and question breakdown, and will receive an email.</p><p style="margin-top:8px">This can't be undone.</p>${modalError}`,
        onConfirm: () => api('POST', `/exams/${exam.id}/release`),
      });
      if (ok) { toast('Results released. Emails are on their way.', 'success'); render(); }
    }

    async function editSchedule() {
      const ok = await modal({
        title: 'Exam schedule', ic: 'calendar', confirmText: 'Save schedule',
        body: `<div class="stack"><label class="field"><span>Opens</span><input class="input" type="datetime-local" name="opensAt" value="${toLocalInput(exam.opens_at)}"></label>
          <label class="field"><span>Closes</span><input class="input" type="datetime-local" name="closesAt" value="${toLocalInput(exam.closes_at)}"></label>
          <p class="small muted">Leave both empty to keep the exam always open.</p>${modalError}</div>`,
        onConfirm: (d) => api('PUT', `/exams/${exam.id}/schedule`, { opensAt: fromLocalInput($('[name=opensAt]', d).value), closesAt: fromLocalInput($('[name=closesAt]', d).value) }),
      });
      if (ok) { toast('Schedule saved.', 'success'); render(); }
    }

    async function deleteExam() {
      const ok = await modal({
        title: 'Delete this exam?', ic: 'trash', tone: 'danger', danger: true, confirmText: 'Delete exam',
        body: `<p>"${esc(exam.title)}" will be permanently deleted. Nobody has attempted it yet.</p>${modalError}`,
        onConfirm: () => api('DELETE', `/exams/${exam.id}`),
      });
      if (ok) { toast('Exam deleted.'); navigate('/exams'); }
    }

    draw();
  }

  // ---------------------------------------------------------------- Marking
  async function markAttempt(el, { id, aid }) {
    el.innerHTML = loadingPage();
    const { exam, attempts } = await api('GET', `/exams/${encodeURIComponent(id)}/attempts`);
    const a = attempts.find((x) => x.id === aid);
    if (!a) { el.innerHTML = `<div class="card">${empty('search', 'Attempt not found', 'It may have been removed.', `<a class="btn btn-primary" href="#/exams/${esc(id)}">Back to exam</a>`)}</div>`; return; }
    const shortQs = exam.questions.filter((q) => q.type === 'short');
    const mcqMax = exam.questions.filter((q) => q.type === 'mcq').reduce((s, q) => s + Number(q.marks), 0);
    const marks = { ...(a.manual_marks || {}) };
    const next = attempts.find((x) => x.id !== a.id && x.status === 'awaiting_manual');
    const locked = a.status === 'in_progress' || a.status === 'submitted';

    el.innerHTML = `${pageHead({
      title: `Marking: ${esc(a.student_email)}`,
      crumbs: [['Exams', '/exams'], [exam.title, `/exams/${exam.id}`], [a.student_email]],
      subtitle: `${attemptPill(a.status)} &nbsp; Submitted ${fmtDate(a.submitted_at)}`,
    })}
      ${a.status === 'in_progress' ? `<div class="alert warning" style="margin-bottom:16px">${icon('clock')}<div>The student is still sitting the exam.</div></div>` : ''}
      ${a.status === 'submitted' ? `<div class="alert info" style="margin-bottom:16px">${icon('refresh')}<div style="flex:1">Multiple-choice answers are being marked automatically. This takes a few seconds.</div><button class="btn btn-secondary btn-sm" data-reload>Refresh</button></div>` : ''}
      ${exam.results_released ? `<div class="alert info" style="margin-bottom:16px">${icon('info')}<div>Results have already been released. Changes are visible to the student immediately.</div></div>` : ''}
      <div class="grid builder-layout">
        <div class="stack">${exam.questions.map((q, i) => {
          const ans = a.answers?.[q.id];
          if (q.type === 'mcq') {
            const correct = ans === q.answer;
            return `<div class="bq ${correct ? 'correct' : 'wrong'} card"><div class="spread"><b>${i + 1}. ${esc(q.text)}</b>${pill(`${correct ? q.marks : 0} / ${q.marks}`, correct ? 'success' : 'danger', false)}</div>
              <div class="small">${correct ? icon('checkCircle') : icon('xCircle')} Answer: <b>${esc(ans ?? 'No answer')}</b>${correct ? '' : ` <span class="muted">· correct: ${esc(q.answer)}</span>`}</div><div class="tiny muted">Marked automatically</div></div>`;
          }
          return `<div class="bq manual card"><div class="spread"><b>${i + 1}. ${esc(q.text)}</b>${pill('Short answer', 'info', false)}</div>
            <div class="answer-box">${esc(ans || 'No answer')}</div>
            <div class="spread"><span class="tiny muted">${plural(wordCount(ans), 'word')}</span>
              <div class="input-group"><button class="btn btn-ghost btn-sm" data-quick="${esc(q.id)}" data-v="0" ${locked ? 'disabled' : ''}>0</button><button class="btn btn-ghost btn-sm" data-quick="${esc(q.id)}" data-v="${q.marks / 2}" ${locked ? 'disabled' : ''}>½</button><button class="btn btn-ghost btn-sm" data-quick="${esc(q.id)}" data-v="${q.marks}" ${locked ? 'disabled' : ''}>Full</button>
              <input class="input" type="number" min="0" max="${esc(q.marks)}" step="0.5" data-mark="${esc(q.id)}" value="${marks[q.id] ?? ''}" style="width:84px" aria-label="Marks for question ${i + 1}" ${locked ? 'disabled' : ''}><span class="muted">/ ${esc(q.marks)}</span></div></div></div>`;
        }).join('')}</div>
        <aside><div class="card card-pad builder-summary stack" id="mark-summary"></div></aside>
      </div>`;

    const drawSummary = () => {
      const manual = shortQs.reduce((s, q) => s + (Number(marks[q.id]) || 0), 0);
      const done = shortQs.filter((q) => marks[q.id] !== undefined && marks[q.id] !== '').length;
      const total = Number(a.mcq_score || 0) + manual;
      const p = pct(total, exam.total_marks);
      $('#mark-summary', el).innerHTML = `<div class="row" style="gap:16px">${scoreRing(p, `${fmtScore(total)}/${fmtScore(exam.total_marks)}`)}<div class="stack-sm"><h3>Total</h3><span class="small muted">${done} of ${shortQs.length} written answers marked</span></div></div>
        <dl class="kv"><dt>Auto-marked</dt><dd>${fmtScore(a.mcq_score)} / ${mcqMax}</dd><dt>Written</dt><dd>${fmtScore(manual)} / ${shortQs.reduce((s, q) => s + Number(q.marks), 0)}</dd></dl>
        <label class="field"><span>Feedback to the student <span class="hint">(optional)</span></span><textarea class="textarea" id="feedback" rows="4" maxlength="5000" ${locked ? 'disabled' : ''}>${esc(feedbackValue)}</textarea></label>
        <button class="btn btn-primary btn-block" id="save-marks" ${locked ? 'disabled' : ''}>${icon('check')}Save marks</button>
        ${next ? `<button class="btn btn-secondary btn-block" id="save-next" ${locked ? 'disabled' : ''}>Save &amp; mark next${icon('right')}</button>` : ''}
        <a class="btn btn-ghost btn-block" href="#/exams/${esc(exam.id)}">Back to exam</a>`;
      $('#feedback', el).oninput = (e) => { feedbackValue = e.target.value; };
      $('#save-marks', el).onclick = (e) => save(e.currentTarget, false);
      const sn = $('#save-next', el);
      if (sn) sn.onclick = (e) => save(e.currentTarget, true);
    };
    let feedbackValue = a.feedback || '';

    el.addEventListener('input', (e) => {
      const qid = e.target.dataset.mark;
      if (!qid) return;
      if (e.target.value === '') delete marks[qid]; else marks[qid] = Number(e.target.value);
      drawSummary();
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-quick]');
      if (b) { marks[b.dataset.quick] = Number(b.dataset.v); $(`[data-mark="${b.dataset.quick}"]`, el).value = b.dataset.v; drawSummary(); }
      if (e.target.closest('[data-reload]')) render();
    });

    async function save(btn, goNext) {
      for (const q of shortQs) {
        const m = marks[q.id];
        if (m !== undefined && (m < 0 || m > q.marks || Number.isNaN(m))) return toast(`Marks for "${q.text.slice(0, 40)}…" must be between 0 and ${q.marks}.`, 'error');
      }
      setBusy(btn, true, 'Saving…');
      try {
        const res = await api('POST', `/attempts/${a.id}/mark`, { marks, feedback: feedbackValue });
        toast(res.status === 'marked' ? `Saved – total ${fmtScore(res.totalScore)}/${fmtScore(res.maxScore)}.` : 'Saved. Some written answers are still unmarked.', 'success');
        if (goNext && next) navigate(`/exams/${exam.id}/mark/${next.id}`); else render();
      } catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
    }

    drawSummary();
  }

  // ---------------------------------------------------------------- Tutor assignments
  async function tutorAssignments(el) {
    el.innerHTML = loadingPage();
    const list = await api('GET', '/assignments');
    el.innerHTML = `${pageHead({ title: 'Assignments', subtitle: 'Collect coursework as PDF or ZIP uploads. You get an email for every submission.', actions: `<button class="btn btn-primary" id="new-assignment">${icon('plus')}New assignment</button>` })}
      <div class="grid grid-3">${list.map((a) => `<div class="card item-card clickable" data-href="/assignments/${esc(a.id)}">
          <div class="spread" style="align-items:flex-start"><h3>${esc(a.title)}</h3>${a.due_at && new Date(a.due_at) < Date.now() ? pill('Closed', 'warning') : pill('Open', 'success')}</div>
          ${a.description ? `<p class="muted small">${esc(a.description.length > 140 ? `${a.description.slice(0, 140)}…` : a.description)}</p>` : ''}
          <div class="meta"><span>${icon('calendar')}${a.due_at ? `Due ${fmtDate(a.due_at)}` : 'No deadline'}</span><span>${icon('inbox')}${plural(a.students_submitted, 'student')} submitted</span></div>
          <div class="actions"><span class="btn btn-secondary btn-sm">View submissions${icon('right')}</span></div></div>`).join('')
        || `<div class="card" style="grid-column:1/-1">${empty('inbox', 'No assignments yet', 'Create an assignment and students can upload their work straight away.')}</div>`}</div>`;
    bindRowLinks(el);
    $('#new-assignment', el).onclick = async () => {
      const id = await modal({
        title: 'New assignment', ic: 'upload', confirmText: 'Create assignment', wide: true,
        body: `<div class="stack"><label class="field"><span>Title</span><input class="input" name="title" maxlength="200" placeholder="e.g. Assignment 1 – AWS architecture report"></label>
          <label class="field"><span>Instructions <span class="hint">(optional)</span></span><textarea class="textarea" name="description" rows="4" maxlength="5000" placeholder="What should students submit?"></textarea></label>
          <label class="field"><span>Due date <span class="hint">(optional – late uploads are allowed but marked as late)</span></span><input class="input" type="datetime-local" name="dueAt"></label>${modalError}</div>`,
        onConfirm: async (d) => {
          const title = $('[name=title]', d).value.trim();
          if (!title) throw new Error('Add a title.');
          const res = await api('POST', '/assignments', { title, description: $('[name=description]', d).value.trim() || null, dueAt: fromLocalInput($('[name=dueAt]', d).value) });
          return res.id;
        },
      });
      if (id) { toast('Assignment created.', 'success'); navigate(`/assignments/${id}`); }
    };
  }

  async function tutorAssignmentDetail(el, { id }) {
    el.innerHTML = loadingPage();
    const { assignment: a, submissions } = await api('GET', `/assignments/${encodeURIComponent(id)}/submissions`);
    const students = new Set(submissions.map((s) => s.student_email)).size;
    const late = submissions.filter((s) => s.late).length;
    const table = (rows) => (rows.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>Student</th><th>File</th><th class="num">Size</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((s) => `<tr><td>${esc(s.student_email || 'Unknown')}</td><td><div class="file-row">${fileIcon(s.file_name)}<span class="fname" style="max-width:260px">${esc(s.file_name)}</span></div></td>
        <td class="num">${fmtBytes(s.size_bytes)}</td><td class="small nowrap">${fmtDate(s.submitted_at)}<div class="tiny muted">${fmtRel(s.submitted_at)}</div></td>
        <td>${s.late ? pill('Late', 'warning') : pill('On time', 'success')}</td>
        <td><a class="btn btn-secondary btn-sm" href="${esc(s.downloadUrl)}" target="_blank" rel="noopener">${icon('download')}Download</a></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card">${empty('inbox', 'No submissions yet', 'Uploads appear here (and in your email) as soon as students submit.')}</div>`);
    el.innerHTML = `${pageHead({ title: esc(a.title), crumbs: [['Assignments', '/assignments'], [a.title]], subtitle: a.due_at ? `Due ${fmtDate(a.due_at)} (${fmtRel(a.due_at)})` : 'No deadline', actions: `<button class="btn btn-secondary" data-reload>${icon('refresh')}Refresh</button>` })}
      ${a.description ? `<div class="card card-pad small" style="margin-bottom:16px;white-space:pre-wrap">${esc(a.description)}</div>` : ''}
      <div class="grid grid-stats" style="margin-bottom:20px">${stat('users', 'brand', students, 'Students submitted')}${stat('inbox', 'info', submissions.length, 'Files received')}${stat('clock', 'warning', late, 'Late uploads')}</div>
      <div class="row" style="margin-bottom:14px"><div class="search" style="flex:1;max-width:360px">${icon('search')}<input class="input" placeholder="Search by student or file…" id="sub-search" aria-label="Search submissions"></div></div>
      <div id="sub-table">${table(submissions)}</div>`;
    $('[data-reload]', el).onclick = render;
    $('#sub-search', el).oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $('#sub-table', el).innerHTML = table(submissions.filter((s) => `${s.student_email} ${s.file_name}`.toLowerCase().includes(q)));
    };
  }

  // =====================================================================================
  // ADMIN
  // =====================================================================================
  async function adminDashboard(el) {
    el.innerHTML = loadingPage();
    const [users, exams] = await Promise.all([api('GET', '/admin/users'), api('GET', '/exams')]);
    const upcoming = exams.filter((e) => examWindow(e) !== 'closed' && !e.results_released).slice(0, 6);
    el.innerHTML = `${pageHead({ title: `${greeting()} 👋`, subtitle: 'Platform overview.', actions: `<a class="btn btn-secondary" href="#/schedules">${icon('calendar')}Schedules</a><a class="btn btn-primary" href="#/users">${icon('plus')}Add users</a>` })}
      <div class="grid grid-stats">
        ${stat('cap', 'brand', users.students.length, 'Students')}
        ${stat('pen', 'info', users.tutors.length, 'Tutors')}
        ${stat('shield', 'warning', users.admins.length, 'Administrators')}
        ${stat('exam', 'success', exams.length, 'Exams')}
      </div>
      <div class="section-title"><h2>Open and upcoming exams</h2><a class="small" href="#/schedules">Manage schedules</a></div>
      ${upcoming.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>Exam</th><th>Tutor</th><th>Status</th><th>Window</th><th class="num">Submitted</th></tr></thead><tbody>
        ${upcoming.map((e) => `<tr><td><b>${esc(e.title)}</b></td><td class="small">${esc(e.tutor_email)}</td><td>${tutorExamPill(e)}</td><td class="small muted">${windowText(e)}</td><td class="num">${e.submitted}/${e.attempts}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card">${empty('calendar', 'Nothing scheduled', 'Exams created by tutors will appear here.')}</div>`}`;
  }

  async function adminUsers(el) {
    el.innerHTML = loadingPage();
    const users = await api('GET', '/admin/users');
    const all = ['students', 'tutors', 'admins'].flatMap((g) => users[g].map((u) => ({ ...u, group: g })));
    let tab = 'all';
    let query = '';
    const roleTone = { students: 'brand', tutors: 'info', admins: 'warning' };
    const statusPill = (s) => (s === 'CONFIRMED' ? pill('Active', 'success') : s === 'FORCE_CHANGE_PASSWORD' ? pill('Invite sent', 'warning') : pill(s === 'LOCAL' ? 'Local' : s, ''));

    el.innerHTML = `${pageHead({ title: 'Users', subtitle: 'Create accounts for students, tutors and administrators. New users get an email with a temporary password.' })}
      <div class="grid grid-2" style="margin-bottom:24px">
        <div class="card"><div class="card-head"><h2>Add a user</h2></div><form class="card-body stack" id="add-user" novalidate>
          <label class="field"><span>Email</span><input class="input" type="email" name="email" required placeholder="name@university.edu"></label>
          <div class="field"><span>Role</span><div class="segmented">
            <label><input type="radio" name="group" value="students" checked><span>Student</span></label>
            <label><input type="radio" name="group" value="tutors"><span>Tutor</span></label>
            <label><input type="radio" name="group" value="admins"><span>Admin</span></label></div></div>
          <div><button class="btn btn-primary" type="submit">${icon('mail')}Create &amp; send invite</button></div></form></div>
        <div class="card"><div class="card-head"><h2>Add many users</h2></div><div class="card-body stack">
          <label class="field"><span>Emails <span class="hint">– one per line, or separated by commas</span></span><textarea class="textarea mono" id="bulk-emails" rows="4" placeholder="student1@university.edu&#10;student2@university.edu"></textarea></label>
          <div class="row"><select class="select" id="bulk-group" style="width:auto"><option value="students">Students</option><option value="tutors">Tutors</option><option value="admins">Admins</option></select>
          <button class="btn btn-secondary" id="bulk-add">${icon('users')}Add all</button><span class="small muted" id="bulk-status"></span></div></div></div>
      </div>
      <div class="spread" style="margin-bottom:12px">
        <div class="tabs" style="margin:0;border:0" id="user-tabs"></div>
        <div class="search" style="min-width:240px">${icon('search')}<input class="input" id="user-search" placeholder="Search users…" aria-label="Search users"></div>
      </div>
      <div id="user-table"></div>`;

    const drawTable = () => {
      const counts = { all: all.length, students: users.students.length, tutors: users.tutors.length, admins: users.admins.length };
      $('#user-tabs', el).innerHTML = [['all', 'All'], ['students', 'Students'], ['tutors', 'Tutors'], ['admins', 'Admins']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${l}${pill(counts[k], '', false)}</button>`).join('');
      $$('[data-tab]', el).forEach((b) => { b.onclick = () => { tab = b.dataset.tab; drawTable(); }; });
      const rows = all.filter((u) => (tab === 'all' || u.group === tab) && String(u.email).toLowerCase().includes(query));
      $('#user-table', el).innerHTML = rows.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th></tr></thead><tbody>
        ${rows.map((u) => `<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap"><div class="avatar" style="width:30px;height:30px;font-size:11px">${esc(initials(u.email))}</div>${esc(u.email)}</div></td><td>${pill(u.group.replace(/s$/, ''), roleTone[u.group], false)}</td><td>${statusPill(u.status)}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="card">${empty('users', 'No users found', query ? 'Try a different search.' : 'Add your first user above.')}</div>`;
    };
    drawTable();
    $('#user-search', el).oninput = (e) => { query = e.target.value.toLowerCase(); drawTable(); };

    $('#add-user', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Enter a valid email address.', 'error');
      const btn = f.querySelector('[type=submit]');
      setBusy(btn, true, 'Creating…');
      try {
        await api('POST', '/admin/users', { email, group: f.group.value });
        toast(`${email} created. An invite email is on its way.`, 'success');
        render();
      } catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
    });

    $('#bulk-add', el).onclick = async (e) => {
      const emails = [...new Set($('#bulk-emails', el).value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
      const bad = emails.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      if (!emails.length) return toast('Paste at least one email.', 'error');
      if (bad.length) return toast(`Not valid: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`, 'error');
      const group = $('#bulk-group', el).value;
      const btn = e.currentTarget;
      setBusy(btn, true, 'Adding…');
      const failed = [];
      for (let i = 0; i < emails.length; i++) {
        $('#bulk-status', el).textContent = `${i + 1} of ${emails.length}…`;
        try { await api('POST', '/admin/users', { email: emails[i], group }); } catch (err) { failed.push(`${emails[i]} (${err.message})`); }
      }
      setBusy(btn, false);
      if (failed.length) {
        await modal({ title: `Added ${emails.length - failed.length} of ${emails.length}`, ic: 'alert', tone: 'danger', hideCancel: true, confirmText: 'OK', body: `<p>These could not be added:</p><ul>${failed.map((f) => `<li class="small">${esc(f)}</li>`).join('')}</ul>` });
      } else toast(`Added ${plural(emails.length, 'user')}.`, 'success');
      render();
    };
  }

  async function adminSchedules(el) {
    el.innerHTML = loadingPage();
    const exams = await api('GET', '/exams');
    el.innerHTML = `${pageHead({ title: 'Exam schedules', subtitle: 'Set when each exam opens and closes. Changes apply immediately.' })}
      <div class="row" style="margin-bottom:14px"><div class="search" style="flex:1;max-width:360px">${icon('search')}<input class="input" placeholder="Search exams or tutors…" id="sched-search" aria-label="Search"></div></div>
      ${exams.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>Exam</th><th>Status</th><th>Opens</th><th>Closes</th><th></th></tr></thead><tbody>
        ${exams.map((e) => `<tr data-id="${esc(e.id)}" data-search="${esc(`${e.title} ${e.tutor_email}`.toLowerCase())}">
          <td><b>${esc(e.title)}</b><div class="tiny muted">${esc(e.tutor_email)} · ${esc(e.duration_minutes)} min · ${e.submitted}/${e.attempts} submitted</div></td>
          <td>${tutorExamPill(e)}</td>
          <td><input class="input" type="datetime-local" name="opensAt" value="${toLocalInput(e.opens_at)}" style="min-width:200px"></td>
          <td><input class="input" type="datetime-local" name="closesAt" value="${toLocalInput(e.closes_at)}" style="min-width:200px"></td>
          <td><button class="btn btn-secondary btn-sm" data-save disabled>Save</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card">${empty('calendar', 'No exams yet', 'Exams created by tutors will appear here.')}</div>`}`;
    $$('tr[data-id]', el).forEach((tr) => {
      const btn = $('[data-save]', tr);
      $$('input', tr).forEach((i) => { i.oninput = () => { btn.disabled = false; btn.className = 'btn btn-primary btn-sm'; }; });
      btn.onclick = async () => {
        setBusy(btn, true);
        try {
          await api('PUT', `/exams/${tr.dataset.id}/schedule`, { opensAt: fromLocalInput($('[name=opensAt]', tr).value), closesAt: fromLocalInput($('[name=closesAt]', tr).value) });
          setBusy(btn, false);
          btn.disabled = true;
          btn.className = 'btn btn-secondary btn-sm';
          btn.textContent = 'Saved';
          toast('Schedule updated.', 'success');
        } catch (err) { setBusy(btn, false); toast(err.message, 'error'); }
      };
    });
    const search = $('#sched-search', el);
    if (search) search.oninput = (e) => { const q = e.target.value.toLowerCase(); $$('tr[data-id]', el).forEach((tr) => { tr.hidden = !tr.dataset.search.includes(q); }); };
  }

  // =====================================================================================
  // Start
  // =====================================================================================
  window.addEventListener('hashchange', render);
  render();
})();
