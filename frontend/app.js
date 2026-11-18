/* Exam platform single-page app (no build step, no framework).
 * Auth: Amazon Cognito (USER_PASSWORD_AUTH over HTTPS) -> ID token sent to /api/* as Bearer token.
 */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');
  const toIso = (local) => (local ? new Date(local).toISOString() : null);
  const AUTOSAVE_MS = 30000;

  // ---------------- storage helpers (never throw) ----------------
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
    localGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    localSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    localDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = isError ? 'error' : '';
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ---------------- Cognito ----------------
  async function cognito(target, body) {
    const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.__type || 'Sign-in failed');
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

  async function refreshSession() {
    const s = store.get('session');
    if (!s?.refreshToken) throw new Error('Session expired');
    const data = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: cfg.userPoolClientId,
      AuthParameters: { REFRESH_TOKEN: s.refreshToken },
    });
    saveSession(data.AuthenticationResult);
  }

  let pendingChallenge = null;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const data = await cognito('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cfg.userPoolClientId,
        AuthParameters: { USERNAME: f.email.value.trim(), PASSWORD: f.password.value },
      });
      if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        pendingChallenge = { session: data.Session, username: data.ChallengeParameters.USER_ID_FOR_SRP || f.email.value.trim() };
        f.hidden = true;
        $('#newpw-form').hidden = false;
        return;
      }
      saveSession(data.AuthenticationResult);
      route();
    } catch (err) { toast(err.message, true); }
  });

  $('#newpw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await cognito('RespondToAuthChallenge', {
        ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: cfg.userPoolClientId, Session: pendingChallenge.session,
        ChallengeResponses: { USERNAME: pendingChallenge.username, NEW_PASSWORD: e.target.password.value },
      });
      saveSession(data.AuthenticationResult);
      e.target.hidden = true;
      $('#login-form').hidden = false;
      route();
    } catch (err) { toast(err.message, true); }
  });

  $('#logout').addEventListener('click', () => { store.del('session'); stopExam(); route(); });

  // ---------------- API ----------------
  async function api(method, path, body, retried) {
    const s = store.get('session');
    if (s && Date.now() > s.exp - 60000 && !retried) { try { await refreshSession(); } catch { /* handled below */ } }
    const session = store.get('session');
    const res = await fetch(`${cfg.apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.idToken || ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      try { await refreshSession(); return api(method, path, body, true); } catch { store.del('session'); route(); }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.message || `Request failed (${res.status})`); err.status = res.status; throw err; }
    return data;
  }

  // ---------------- routing ----------------
  const views = ['#login-view', '#student-view', '#exam-view', '#tutor-view', '#admin-view'];
  function show(id) { views.forEach((v) => { $(v).hidden = v !== id; }); }

  function role(groups) {
    if (groups.includes('admins')) return 'admin';
    if (groups.includes('tutors')) return 'tutor';
    if (groups.includes('students')) return 'student';
    return null;
  }

  function route() {
    const s = store.get('session');
    if (!s) { $('#whoami').hidden = true; show('#login-view'); return; }
    const r = role(s.groups);
    $('#whoami').hidden = false;
    $('#user-email').textContent = s.email;
    $('#user-role').textContent = r || 'no role';
    if (r === 'student') { show('#student-view'); loadStudent(); }
    else if (r === 'tutor') { show('#tutor-view'); loadTutor(); }
    else if (r === 'admin') { show('#admin-view'); loadAdmin(); }
    else { show('#login-view'); toast('Your account has no role yet. Ask an administrator.', true); }
  }

  // ---------------- student ----------------
  async function loadStudent() {
    try {
      const [exams, assignments, results] = await Promise.all([api('GET', '/exams'), api('GET', '/assignments'), api('GET', '/results')]);
      $('#student-exams tbody').innerHTML = exams.map((e) => {
        const status = e.attempt_status || 'not started';
        const closed = e.closes_at && new Date(e.closes_at) < new Date();
        const canStart = !closed && (!e.attempt_status || e.attempt_status === 'in_progress');
        return `<tr><td>${esc(e.title)}</td><td>${esc(e.duration_minutes)} min</td><td>${esc(status)}</td>
          <td>${canStart ? `<button data-start="${esc(e.id)}">${e.attempt_status ? 'Resume' : 'Start'}</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">No exams available.</td></tr>';

      $('#student-assignments tbody').innerHTML = assignments.map((a) => `<tr><td>${esc(a.title)}</td><td>${fmtDate(a.due_at)}</td>
        <td>${fmtDate(a.my_last_submission)}</td>
        <td><input type="file" accept=".pdf,.zip" data-upload="${esc(a.id)}"></td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No assignments.</td></tr>';

      $('#student-results tbody').innerHTML = results.map((r) => `<tr><td>${esc(r.title)}</td>
        <td>${r.total_score != null ? `${esc(r.total_score)} / ${esc(r.max_score)}` : '—'}</td><td>${esc(r.status)}</td></tr>`).join('')
        || '<tr><td colspan="3" class="muted">No results released yet.</td></tr>';
    } catch (err) { toast(err.message, true); }
  }

  $('#student-exams').addEventListener('click', (e) => { const id = e.target.dataset.start; if (id) startExam(id); });

  // Walkthrough 2: get a presigned POST from the API, then upload the file directly to S3.
  $('#student-assignments').addEventListener('change', async (e) => {
    const assignmentId = e.target.dataset.upload;
    const file = e.target.files?.[0];
    if (!assignmentId || !file) return;
    if (file.size > 50 * 1024 * 1024) { toast('File is larger than 50 MB', true); e.target.value = ''; return; }
    try {
      const { url, fields } = await api('POST', `/assignments/${assignmentId}/upload-url`, { fileName: file.name });
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      form.append('file', file); // must be the last field
      const bar = $('#upload-progress');
      bar.hidden = false; bar.value = 0;
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.value = (ev.loaded / ev.total) * 100; };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload rejected by S3 (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('Upload failed - check your connection'));
        xhr.send(form);
      });
      bar.hidden = true;
      toast(`Uploaded ${file.name}. Your tutor will be notified.`);
      setTimeout(loadStudent, 2000);
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });

  // ---------------- exam taking (walkthrough 1) ----------------
  let exam = null; // { attemptId, deadline(ms), questions, answers, dirty, timers }

  function stopExam() {
    if (!exam) return;
    clearInterval(exam.saveTimer); clearInterval(exam.tickTimer);
    window.removeEventListener('beforeunload', beforeUnload);
    exam = null;
  }
  function beforeUnload(e) { if (exam?.dirty) { e.preventDefault(); e.returnValue = ''; } }

  async function startExam(examId) {
    try {
      const data = await api('POST', `/exams/${examId}/start`);
      if (data.status !== 'in_progress') { toast('This exam has already been submitted.'); return; }
      const offset = Date.now() - new Date(data.serverTime).getTime(); // correct for a wrong PC clock
      const localKey = `attempt-${data.attemptId}`;
      const local = store.localGet(localKey);
      exam = {
        attemptId: data.attemptId, localKey,
        deadline: new Date(data.deadline).getTime() + offset,
        questions: data.questions,
        answers: { ...(data.answers || {}), ...(local?.answers || {}) }, // local copy is never older
        dirty: !!local,
      };
      renderExam(data.title);
      show('#exam-view');
      exam.saveTimer = setInterval(() => saveAnswers(false), AUTOSAVE_MS);
      exam.tickTimer = setInterval(tick, 1000);
      window.addEventListener('beforeunload', beforeUnload);
      tick();
      $('#save-status').textContent = data.lastSavedAt ? `Last saved ${new Date(data.lastSavedAt).toLocaleTimeString()}` : 'Not saved yet';
    } catch (err) { toast(err.message, true); }
  }

  function renderExam(title) {
    $('#exam-title').textContent = title;
    $('#exam-form').innerHTML = exam.questions.map((q, i) => {
      const a = exam.answers[q.id];
      const body = q.type === 'mcq'
        ? q.options.map((o) => `<label><input type="radio" name="${esc(q.id)}" value="${esc(o)}" ${a === o ? 'checked' : ''}> ${esc(o)}</label>`).join('')
        : `<textarea name="${esc(q.id)}" rows="5">${esc(a || '')}</textarea>`;
      return `<div class="question"><p>${i + 1}. ${esc(q.text)} <span class="muted">(${esc(q.marks)} marks)</span></p>${body}</div>`;
    }).join('');
  }

  $('#exam-form').addEventListener('input', (e) => {
    if (!exam || !e.target.name) return;
    exam.answers[e.target.name] = e.target.value;
    exam.dirty = true;
    store.localSet(exam.localKey, { answers: exam.answers, at: Date.now() }); // instant local backup
    $('#save-status').textContent = 'Unsaved changes';
  });

  async function saveAnswers(manual) {
    if (!exam || (!exam.dirty && !manual)) return;
    const snapshot = { ...exam.answers };
    try {
      const { savedAt } = await api('PUT', `/attempts/${exam.attemptId}/answers`, { answers: snapshot });
      if (exam) {
        exam.dirty = JSON.stringify(snapshot) !== JSON.stringify(exam.answers);
        $('#save-status').innerHTML = `<span class="ok">Saved ${new Date(savedAt).toLocaleTimeString()}</span>`;
      }
    } catch (err) {
      if (err.status === 409) { toast('Time is up - this attempt is closed.', true); finishExam(); return; }
      // Network blip or AZ failover in progress: answers are safe in localStorage, retry on next tick.
      $('#save-status').innerHTML = '<span class="warn">Offline - saved on this device, retrying…</span>';
    }
  }

  function tick() {
    if (!exam) return;
    const left = Math.max(0, exam.deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const t = $('#exam-timer');
    t.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    t.classList.toggle('low', left < 5 * 60000);
    if (left === 0) submitExam(true);
  }

  async function submitExam(auto) {
    if (!exam || exam.submitting) return;
    if (!auto && !confirmSubmit()) return;
    exam.submitting = true;
    try {
      await api('POST', `/attempts/${exam.attemptId}/submit`, { answers: exam.answers });
      toast(auto ? 'Time is up - your exam was submitted.' : 'Exam submitted.');
    } catch (err) {
      if (err.status !== 409) { toast(`Submit failed: ${err.message}. Retrying…`, true); exam.submitting = false; return; }
    }
    finishExam();
  }

  // A visible inline confirmation instead of window.confirm()
  function confirmSubmit() {
    const btn = $('#submit-exam');
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.textContent = 'Click again to confirm';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Submit exam'; }, 4000);
    return false;
  }

  function finishExam() {
    if (exam) store.localDel(exam.localKey);
    stopExam();
    route();
  }

  $('#save-now').addEventListener('click', () => saveAnswers(true));
  $('#submit-exam').addEventListener('click', () => submitExam(false));

  // ---------------- tutor ----------------
  const SAMPLE_QUESTIONS = [
    { id: 'q1', type: 'mcq', text: 'Which AWS service stores assignment files?', options: ['Amazon S3', 'Amazon SQS', 'Amazon SES'], answer: 'Amazon S3', marks: 2 },
    { id: 'q2', type: 'mcq', text: 'What does Multi-AZ RDS provide?', options: ['A synchronous standby in another AZ', 'Read replicas in another region', 'Nothing'], answer: 'A synchronous standby in another AZ', marks: 2 },
    { id: 'q3', type: 'short', text: 'Explain why presigned URLs are used for large uploads.', marks: 6 },
  ];
  $('#create-exam-form').questions.value = JSON.stringify(SAMPLE_QUESTIONS, null, 2);

  async function loadTutor() {
    try {
      const [exams, assignments] = await Promise.all([api('GET', '/exams'), api('GET', '/assignments')]);
      $('#tutor-exams tbody').innerHTML = exams.map((e) => `<tr><td>${esc(e.title)}</td>
        <td>${fmtDate(e.opens_at)} → ${fmtDate(e.closes_at)}</td><td>${esc(e.attempts)}</td><td>${e.results_released ? 'Yes' : 'No'}</td>
        <td><button class="secondary" data-attempts="${esc(e.id)}" data-title="${esc(e.title)}">Attempts</button>
            ${e.results_released ? '' : `<button data-release="${esc(e.id)}">Release results</button>`}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No exams yet.</td></tr>';
      $('#tutor-assignments tbody').innerHTML = assignments.map((a) => `<tr><td>${esc(a.title)}</td><td>${fmtDate(a.due_at)}</td>
        <td>${esc(a.submissions)}</td><td><button class="secondary" data-subs="${esc(a.id)}" data-title="${esc(a.title)}">View</button></td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No assignments yet.</td></tr>';
    } catch (err) { toast(err.message, true); }
  }

  $('#tutor-exams').addEventListener('click', async (e) => {
    const { attempts, release, title } = e.target.dataset;
    try {
      if (release) {
        await api('POST', `/exams/${release}/release`);
        toast('Results released - emails are being sent.');
        loadTutor();
      } else if (attempts) {
        const rows = await api('GET', `/exams/${attempts}/attempts`);
        $('#attempts-panel').hidden = false;
        $('#attempts-title').textContent = `Attempts: ${title}`;
        $('#attempts-table tbody').innerHTML = rows.map((r) => {
          const shorts = (r.questions || []).filter((q) => q.type === 'short')
            .map((q) => `<pre class="answer"><b>${esc(q.id)}:</b> ${esc(r.answers?.[q.id] || '—')}</pre>`).join('');
          const canMark = r.status !== 'in_progress';
          return `<tr><td>${esc(r.student_email)}</td><td>${esc(r.status)}</td><td>${esc(r.mcq_score ?? '—')}</td><td>${shorts || '—'}</td>
            <td>${canMark ? `<input type="number" min="0" step="0.5" value="${esc(r.manual_score ?? '')}" data-mark="${esc(r.id)}" style="width:80px">` : ''}</td>
            <td>${r.total_score != null ? `${esc(r.total_score)} / ${esc(r.max_score)}` : '—'}</td></tr>`;
        }).join('') || '<tr><td colspan="6" class="muted">No attempts yet.</td></tr>';
      }
    } catch (err) { toast(err.message, true); }
  });

  $('#attempts-table').addEventListener('change', async (e) => {
    const id = e.target.dataset.mark;
    if (!id) return;
    try {
      const { totalScore } = await api('POST', `/attempts/${id}/mark`, { manualScore: Number(e.target.value) });
      e.target.closest('tr').lastElementChild.textContent = totalScore;
      toast('Mark saved');
    } catch (err) { toast(err.message, true); }
  });

  $('#create-exam-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    let questions;
    try { questions = JSON.parse(f.questions.value); } catch { toast('Questions must be valid JSON', true); return; }
    try {
      await api('POST', '/exams', {
        title: f.title.value, durationMinutes: Number(f.durationMinutes.value),
        opensAt: toIso(f.opensAt.value), closesAt: toIso(f.closesAt.value), questions,
      });
      toast('Exam created');
      f.title.value = '';
      loadTutor();
    } catch (err) { toast(err.message, true); }
  });

  $('#create-assignment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/assignments', { title: e.target.title.value, dueAt: toIso(e.target.dueAt.value) });
      toast('Assignment created');
      e.target.reset();
      loadTutor();
    } catch (err) { toast(err.message, true); }
  });

  $('#tutor-assignments').addEventListener('click', async (e) => {
    const { subs, title } = e.target.dataset;
    if (!subs) return;
    try {
      const rows = await api('GET', `/assignments/${subs}/submissions`);
      $('#submissions-panel').hidden = false;
      $('#submissions-title').textContent = `Submissions: ${title}`;
      $('#submissions-table tbody').innerHTML = rows.map((r) => `<tr><td>${esc(r.student_email || r.id)}</td>
        <td>${(r.size_bytes / 1048576).toFixed(1)} MB</td><td>${fmtDate(r.submitted_at)}</td>
        <td><a href="${esc(r.downloadUrl)}" target="_blank" rel="noopener">Download</a></td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No submissions yet.</td></tr>';
    } catch (err) { toast(err.message, true); }
  });

  // ---------------- admin ----------------
  async function loadAdmin() {
    try {
      const [users, exams] = await Promise.all([api('GET', '/admin/users'), api('GET', '/exams')]);
      $('#admin-users').innerHTML = Object.entries(users).map(([g, list]) => `<h3>${esc(g)} (${list.length})</h3>
        <p class="muted">${list.map((u) => `${esc(u.email)} <small>[${esc(u.status)}]</small>`).join(', ') || 'none'}</p>`).join('');
      const toLocal = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
      $('#admin-exams tbody').innerHTML = exams.map((e) => `<tr data-id="${esc(e.id)}"><td>${esc(e.title)}</td><td>${esc(e.tutor_email)}</td>
        <td><input type="datetime-local" name="opensAt" value="${toLocal(e.opens_at)}"></td>
        <td><input type="datetime-local" name="closesAt" value="${toLocal(e.closes_at)}"></td>
        <td><button data-schedule="1">Save</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No exams.</td></tr>';
    } catch (err) { toast(err.message, true); }
  }

  $('#create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/admin/users', { email: e.target.email.value.trim(), group: e.target.group.value });
      toast('User created - Cognito has emailed a temporary password.');
      e.target.reset();
      loadAdmin();
    } catch (err) { toast(err.message, true); }
  });

  $('#admin-exams').addEventListener('click', async (e) => {
    if (!e.target.dataset.schedule) return;
    const tr = e.target.closest('tr');
    try {
      await api('PUT', `/exams/${tr.dataset.id}/schedule`, {
        opensAt: toIso(tr.querySelector('[name=opensAt]').value), closesAt: toIso(tr.querySelector('[name=closesAt]').value),
      });
      toast('Schedule updated');
    } catch (err) { toast(err.message, true); }
  });

  route();
})();
