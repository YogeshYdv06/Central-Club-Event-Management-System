console.log("CampusConnect script.js loaded");
/* CampusConnect – dashboard interactivity */
(() => {
  'use strict';
 
  /* ---------- Helpers ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const refreshIcons = () => window.lucide && window.lucide.createIcons();
 
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cc_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('cc_' + k, JSON.stringify(v)); } catch { /* ignore */ } }
  };
 
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const parseDate = str => {            // "28 Oct 2026"
    const [d, m, y] = str.trim().split(/\s+/);
    return new Date(+y, MONTHS[m.slice(0, 3).toLowerCase()], +d, 23, 59, 59);
  };
 
  /* ---------- Injected styles (toast, modal, dropdowns, helpers) ---------- */
  const style = document.createElement('style');
  style.textContent = `
    [hidden]{display:none!important}
    .user{position:relative;cursor:pointer}
    .dropdown{position:absolute;top:calc(100% + 12px);right:0;z-index:50;min-width:230px;padding:8px;
      background:#141a5c;border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.45)}
    .dropdown.wide{width:320px}
    .dropdown .dd-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;font-weight:600}
    .dropdown .dd-head button{background:none;border:0;color:#7aa2ff;font-size:12px;cursor:pointer}
    .dropdown button.dd-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:0;border-radius:8px;
      background:none;color:var(--text);font:inherit;cursor:pointer;text-align:left}
    .dropdown button.dd-item:hover{background:rgba(255,255,255,.08)}
    .dd-note{display:flex;gap:10px;padding:10px;border-radius:8px;font-size:13px}
    .dd-note.unread{background:rgba(99,102,241,.18)}
    .dd-note .dot{margin-top:4px}
    .dd-empty{padding:16px;text-align:center;color:var(--muted)}
    .toasts{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:10px;z-index:100}
    .toast{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;background:#1e2a78;
      border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.4);animation:tIn .25s ease}
    .toast.success{border-color:var(--success)}.toast.error{border-color:var(--error)}
    .toast.out{opacity:0;transform:translateX(20px);transition:.25s}
    @keyframes tIn{from{opacity:0;transform:translateY(10px)}}
    .modal-wrap{position:fixed;inset:0;display:grid;place-items:center;background:rgba(5,8,30,.7);z-index:90;padding:16px}
    .modal{width:min(420px,100%);padding:24px;border-radius:16px;background:#141a5c;border:1px solid var(--border);
      box-shadow:0 20px 50px rgba(0,0,0,.5)}
    .modal h3{margin-bottom:8px}.modal p{color:#c8d0f5;margin-bottom:18px;line-height:1.5}
    .modal .actions{display:flex;justify-content:flex-end;gap:10px}
    .modal button{padding:9px 16px;border:0;border-radius:8px;font:600 13px 'Inter';color:#fff;cursor:pointer}
    .modal .cancel{background:rgba(255,255,255,.12)}.modal .ok{background:linear-gradient(90deg,#4f46e5,#6366f1)}
    .btn[disabled]{opacity:.55;cursor:not-allowed;filter:grayscale(.6)}
    .btn.registered{background:rgba(16,185,129,.25);border:1px solid var(--success)}
    .no-results{padding:14px;text-align:center;color:var(--muted)}
    .tile,.action,nav a,.activity li{cursor:pointer}
  `;
  document.head.appendChild(style);
 
  /* ---------- Toasts ---------- */
  const toastBox = Object.assign(document.createElement('div'), { className: 'toasts' });
  toastBox.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastBox);
 
  function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    toastBox.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3000);
  }
 
  /* ---------- Confirm modal ---------- */
  function confirmBox(title, text, okLabel = 'Confirm') {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${esc(title)}</h3><p>${esc(text)}</p>
          <div class="actions"><button class="cancel">Cancel</button><button class="ok">${esc(okLabel)}</button></div>
        </div>`;
      const close = v => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(false); };
      wrap.addEventListener('click', e => { if (e.target === wrap) close(false); });
      $('.cancel', wrap).onclick = () => close(false);
      $('.ok', wrap).onclick = () => close(true);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      $('.ok', wrap).focus();
    });
  }
 
  /* ---------- State ---------- */
  const BASE = { clubs: 4, events: 3, credits: 12, certs: 2, maxCredits: 20 };
  const state = {
    registered: store.get('registered', []),   // titles registered through this UI
    credits: BASE.credits
  };
 
  const statEls = $$('.stats .stat b');        // clubs, events, credits, certificates
  const creditText = $('.progress-box > b');
  const creditBar  = $('.progress-box .bar i');
 
  function animateNumber(el, to, ms = 700) {
    const start = performance.now();
    const step = now => {
      const p = Math.min((now - start) / ms, 1);
      el.textContent = pad(Math.round(to * p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
 
  function renderStats(animate = false) {
    const values = [BASE.clubs, BASE.events + state.registered.length, state.credits, BASE.certs];
    statEls.forEach((el, i) => animate ? animateNumber(el, values[i]) : (el.textContent = pad(values[i])));
    creditText.textContent = `${state.credits} / ${BASE.maxCredits}`;
    creditBar.style.transition = 'width .8s ease';
    creditBar.style.width = Math.min(100, (state.credits / BASE.maxCredits) * 100) + '%';
  }
 
  /* ---------- Greeting ---------- */
  (function greet() {
    const h = new Date().getHours();
    const g = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
    const name = $('.user strong').textContent.trim();
    $('.hero h1').textContent = `${g}, ${name}! 👋`;
  })();
 
  /* ---------- Activity feed ---------- */
  function addActivity(icon, color, text) {
    const ul = $('.activity ul');
    const li = document.createElement('li');
    li.innerHTML = `<span class="ico ${color}"><i data-lucide="${icon}"></i></span>${esc(text)}<time>Just now</time><i data-lucide="chevron-right"></i>`;
    ul.prepend(li);
    while (ul.children.length > 5) ul.lastElementChild.remove();
    refreshIcons();
  }
 
  /* ---------- Notifications ---------- */
  const notes = $$('.notes li').map((li, i) => ({
    id: i,
    text: $('strong', li).textContent,
    time: $('small', li).textContent,
    color: li.querySelector('.dot').style.getPropertyValue('--c') || '#6366f1',
    read: false
  }));
  let noteId = notes.length;
  const badge = $('.badge');
 
  function renderNotes() {
    const unread = notes.filter(n => !n.read).length;
    badge.textContent = unread;
    badge.hidden = unread === 0;
 
    $('.notes').innerHTML = notes.slice(0, 5).map(n => `
      <li><i class="dot" style="--c:${n.color}"></i><div><strong>${esc(n.text)}</strong><small>${esc(n.time)}</small></div></li>`).join('');
 
    const list = $('.dd-notes');
    if (list) {
      list.innerHTML = notes.length ? notes.map(n => `
        <div class="dd-note ${n.read ? '' : 'unread'}"><i class="dot" style="--c:${n.color}"></i>
        <div><strong>${esc(n.text)}</strong><br><small>${esc(n.time)}</small></div></div>`).join('')
        : '<div class="dd-empty">No notifications</div>';
    }
  }
 
  function addNotification(text, color = '#6366f1') {
    notes.unshift({ id: noteId++, text, time: 'Just now', color, read: false });
    renderNotes();
  }
 
  /* Bell dropdown */
  const bell = $('.bell');
  const bellMenu = document.createElement('div');
  bellMenu.className = 'dropdown wide';
  bellMenu.hidden = true;
  bellMenu.innerHTML = `<div class="dd-head">Notifications<button type="button" class="mark">Mark all read</button></div><div class="dd-notes"></div>`;
  bell.appendChild(bellMenu);
 
  /* User dropdown */
  const userBox = $('.user');
  const userMenu = document.createElement('div');
  userMenu.className = 'dropdown';
  userMenu.hidden = true;
  userMenu.innerHTML = `
    <button type="button" class="dd-item" data-act="profile"><i data-lucide="user"></i>My Profile</button>
    <button type="button" class="dd-item" data-act="settings"><i data-lucide="settings"></i>Settings</button>
    <button type="button" class="dd-item" data-act="reset"><i data-lucide="rotate-ccw"></i>Reset demo data</button>
    <button type="button" class="dd-item" data-act="logout"><i data-lucide="log-out"></i>Log out</button>`;
  userBox.appendChild(userMenu);
 
  function closeMenus(except) {
    [bellMenu, userMenu].forEach(m => { if (m !== except) m.hidden = true; });
  }
 
  bell.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target.closest('.dropdown')) return;
    const open = bellMenu.hidden;
    closeMenus(bellMenu);
    bellMenu.hidden = !open;
  });
  $('.mark', bellMenu).addEventListener('click', e => {
    e.stopPropagation();
    notes.forEach(n => n.read = true);
    renderNotes();
    toast('All notifications marked as read', 'success');
  });
 
  userBox.addEventListener('click', async e => {
    e.stopPropagation();
    const item = e.target.closest('.dd-item');
    if (!item) {
      const open = userMenu.hidden;
      closeMenus(userMenu);
      userMenu.hidden = !open;
      return;
    }
    userMenu.hidden = true;
    const act = item.dataset.act;
    if (act === 'reset') {
      if (await confirmBox('Reset demo data?', 'This clears your event registrations on this device.', 'Reset')) {
        store.set('registered', []);
        location.reload();
      }
    } else if (act === 'logout') {
      toast('Logout is not connected to a backend yet');
    } else {
      toast(`${item.textContent.trim()} page coming soon`);
    }
  });
 
  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
 
  /* ---------- Events: register / cancel ---------- */
  const eventCards = $$('.events-cards .event');
 
  function setButton(btn, registered) {
    const label = registered ? 'Registered' : 'Register Now';
    const iconName = registered ? 'check' : 'arrow-right';
    btn.classList.toggle('registered', registered);
    btn.innerHTML = `${label} <i data-lucide="${iconName}"></i>`;
    refreshIcons();
  }
 
  eventCards.forEach(card => {
    const title = $('h4', card).textContent.trim();
    const dateStr = $('p', card).textContent.trim();
    const btn = $('.btn', card);
    const isPast = parseDate(dateStr) < new Date();
 
    if (isPast) {                                   // closed events
      btn.disabled = true;
      btn.innerHTML = 'Event Closed <i data-lucide="lock"></i>';
      return;
    }
    if (state.registered.includes(title)) setButton(btn, true);
 
    btn.addEventListener('click', async () => {
      const already = state.registered.includes(title);
      if (!already) {
        if (!(await confirmBox(`Register for ${title}?`, `${dateStr} • ${$$('p', card)[2].textContent.trim()}`, 'Register'))) return;
        state.registered.push(title);
        setButton(btn, true);
        addActivity('calendar-check', 'c-cyan', `You registered for ${title}`);
        addNotification(`Registration confirmed: ${title}`, '#10b981');
        toast(`Registered for ${title}`, 'success');
      } else {
        if (!(await confirmBox(`Cancel registration?`, `You will be removed from ${title}.`, 'Cancel registration'))) return;
        state.registered = state.registered.filter(t => t !== title);
        setButton(btn, false);
        addActivity('x-circle', 'c-amber', `You cancelled ${title}`);
        toast(`Registration cancelled for ${title}`, 'error');
      }
      store.set('registered', state.registered);
      renderStats(true);
    });
  });
 
  /* Right-column event list → scroll to matching card */
  $$('.event-list li').forEach(li => {
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      const name = $('strong', li).textContent.trim();
      const card = eventCards.find(c => $('h4', c).textContent.trim() === name);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.animate([{ boxShadow: '0 0 0 3px #06B6D4' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200 });
      } else {
        toast(`${name}: registration opens soon`);
      }
    });
  });
 
  /* ---------- Navigation, tiles, quick actions ---------- */
  const navLinks = $$('nav a');
  function goTo(label) {
    const key = label.toLowerCase();
    navLinks.forEach(a => a.classList.toggle('active', a.textContent.trim().toLowerCase() === key));
    if (key === 'dashboard') return window.scrollTo({ top: 0, behavior: 'smooth' });
    if (key.includes('event')) return $('.events-cards').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${label} page coming soon`);
  }
 
  navLinks.forEach(a => a.addEventListener('click', e => { e.preventDefault(); goTo(a.textContent.trim()); }));
  $$('.tile').forEach(t => t.addEventListener('click', e => { e.preventDefault(); goTo($('h3', t).textContent.trim()); }));
 
  const actionMap = {
    'browse clubs': 'Clubs', 'view events': 'Events',
    'my certificates': 'Certificates / Credits', 'my credits': 'Certificates / Credits'
  };
  $$('.action').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    goTo(actionMap[a.textContent.trim().toLowerCase()] || a.textContent.trim());
  }));
 
  $('.settings').addEventListener('click', e => { e.preventDefault(); toast('Settings page coming soon'); });
  $$('.link').forEach(l => l.addEventListener('click', e => {
    e.preventDefault();
    if (l.closest('.events-cards')) goTo('Events'); else toast('Full view coming soon');
  }));
  $$('.activity li').forEach(li => li.addEventListener('click', () => toast($$('time', li)[0] ? li.childNodes[1].textContent.trim() : 'Activity')));
 
  /* ---------- Live search ---------- */
  const searchInput = $('.search input');
  const searchables = [
    ['.events-cards .event', '.grid3'],
    ['.event-list li', '.event-list'],
    ['.activity li', '.activity ul']
  ];
 
  function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    let total = 0;
    searchables.forEach(([sel, parentSel]) => {
      const items = $$(sel);
      let shown = 0;
      items.forEach(el => {
        const match = !q || el.textContent.toLowerCase().includes(q);
        el.hidden = !match;
        if (match) shown++;
      });
      total += shown;
      const parent = $(parentSel);
      let msg = parent.parentElement.querySelector(':scope > .no-results[data-for="' + sel + '"]');
      if (q && shown === 0) {
        if (!msg) {
          msg = Object.assign(document.createElement('div'), { className: 'no-results', textContent: 'No matches found' });
          msg.dataset.for = sel;
          parent.after(msg);
        }
      } else if (msg) msg.remove();
    });
    return total;
  }
 
  let timer;
  searchInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 150); });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchInput.value = ''; runSearch(); searchInput.blur(); }
  });
  document.addEventListener('keydown', e => {                    // "/" focuses search
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });
 
  /* ---------- Init ---------- */
  renderNotes();
  renderStats(true);
  refreshIcons();
})();
 