// admin.js — админ-режим через Supabase Auth
// Вход: секретное сочетание «дж», выход: клавиша «ъ».
// Авторизация по email+паролю, проверка прав через таблицу public.profiles (is_admin).

(function () {
  'use strict';

  /**
   * @typedef {Window & typeof globalThis & {
   *   isAdmin?: () => Promise<boolean>,
   *   adminLogin?: (email: string, password: string) => Promise<boolean>,
   *   adminLogout?: () => Promise<void>,
   *   __supabaseClient?: any,
   *   __adminModal?: { open:()=>void, close:()=>void },
   *   __adminModalReady?: boolean
   * }} KadryWindow
   */

  /** @type {KadryWindow} */
  var G = /** @type {any} */ (window);

  // === Константы ===
  var PROJECT_URL = 'https://upanhirmxhfzpajvswoq.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYW5oaXJteGhmenBhanZzd29xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2NjIwNzcsImV4cCI6MjA3MjIzODA3N30.HhrccU3DfoLadflBmTxIDXJgrDQB3m2zLRX3vtRycGA';
  var AUTH_STORAGE_KEY = 'kadry-auth';

  function fire(name) {
    try { G.dispatchEvent(new CustomEvent(name)); } catch (_) {}
  }

  function setHtmlAdmin(on) {
    var root = document.documentElement;
    if (!root || !root.classList) return;
    console.log('[kadry][admin.js] setHtmlAdmin:', on);
    if (on) root.classList.add('is-admin');
    else root.classList.remove('is-admin');
  }

  // === Создаём (или переиспользуем) Supabase-клиент ===
  var supabase = (function () {
    try {
      if (G.__supabaseClient) return G.__supabaseClient;
      var supa = G.supabase;
      if (!supa || typeof supa.createClient !== 'function') return null;
      var client = supa.createClient(PROJECT_URL, ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: AUTH_STORAGE_KEY
        }
      });
      G.__supabaseClient = client;
      return client;
    } catch (e) {
      console.warn('supabase client init failed', e);
      return null;
    }
  })();

  // Детектор версии SDK (v1/v2)
  function isV2() {
    return !!(supabase && supabase.auth && !supabase.auth.signIn);
  }

  // Получить текущего пользователя (универсально для v1/v2)
  async function getCurrentUser() {
    if (!supabase || !supabase.auth) return null;
    try {
      if (isV2() && typeof supabase.auth.getUser === 'function') {
        var r = await supabase.auth.getUser();
        if (r && !r.error && r.data && r.data.user) return r.data.user;
        return null;
      }
      if (typeof supabase.auth.user === 'function') {
        // v1
        return supabase.auth.user();
      }
    } catch (e) {
      console.warn('getCurrentUser failed', e);
    }
    return null;
  }

  // Вход по email+паролю (v1/v2)
  async function signInEmailPassword(email, password) {
    if (!supabase || !supabase.auth) return { user: null, error: new Error('no client') };
    try {
      if (isV2() && typeof supabase.auth.signInWithPassword === 'function') {
        var r2 = await supabase.auth.signInWithPassword({ email: email, password: password });
        return { user: r2.data && r2.data.user || null, error: r2.error || null };
      }
      if (typeof supabase.auth.signIn === 'function') {
        var r1 = await supabase.auth.signIn({ email: email, password: password });
        return { user: r1.user || null, error: r1.error || null };
      }
      return { user: null, error: new Error('No signIn method') };
    } catch (e) {
      return { user: null, error: e };
    }
  }

  // Выход (v1/v2 одинаково)
  async function signOut() {
    if (!supabase || !supabase.auth || typeof supabase.auth.signOut !== 'function') return;
    try { await supabase.auth.signOut(); } catch (e) { console.warn('signOut error', e); }
  }

  var adminState = {
    checkedOnce: false,
    isAdmin: false
  };

  async function fetchIsAdmin() {
    if (!supabase) return false;
    try {
      var user = await getCurrentUser();
      if (!user || !user.id) return false;
      var res = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      if (res.error || !res.data) return false;
      return !!res.data.is_admin;
    } catch (e) {
      console.warn('isAdmin check failed', e);
      return false;
    }
  }

  async function refreshAdmin() {
    if (!supabase) {
      adminState.isAdmin = false;
      adminState.checkedOnce = true;
      setHtmlAdmin(false);
      fire('admin:disabled');
      return false;
    }
    try {
      var user = await getCurrentUser();
      if (!user) {
        if (adminState.isAdmin) {
          adminState.isAdmin = false;
          setHtmlAdmin(false);
          fire('admin:disabled');
        }
        adminState.checkedOnce = true;
        return false;
      }
      var ok = await fetchIsAdmin();
      adminState.isAdmin = ok;
      adminState.checkedOnce = true;
      setHtmlAdmin(ok);
      fire(ok ? 'admin:enabled' : 'admin:disabled');
      console.log('[kadry][admin.js] refreshAdmin result:', {
        userIsAdmin: ok,
        checkedOnce: adminState.checkedOnce
      });
      return ok;
    } catch (e) {
      console.error('refreshAdmin error', e);
      adminState.checkedOnce = true;
      adminState.isAdmin = false;
      setHtmlAdmin(false);
      fire('admin:disabled');
      return false;
    }
  }

  // === Публичный API ===
  async function isAdmin() {
    if (!adminState.checkedOnce) return await refreshAdmin();
    if (!adminState.isAdmin) return await refreshAdmin();
    return true;
  }

  async function adminLogin(email, password) {
    email = (email || '').trim().toLowerCase();
    password = (password || '').trim();
    if (!email || !password || !supabase) return false;
    var r = await signInEmailPassword(email, password);
    if (r.error || !r.user) {
      console.warn('adminLogin error', r.error);
      return false;
    }
    var ok = await refreshAdmin();
    if (!ok) {
      await signOut();
      return false;
    }
    return true;
  }

  async function adminLogout() {
    await signOut();
    adminState.isAdmin = false;
    adminState.checkedOnce = true;
    setHtmlAdmin(false);
    fire('admin:disabled');
  }

  G.isAdmin = isAdmin;
  G.adminLogin = adminLogin;
  G.adminLogout = adminLogout;

  // === Модалка логина ===
  function ensureModal() {
    if (document.getElementById('adminModal')) return;
    var wrap = document.createElement('div');
    wrap.id = 'adminModal';
    wrap.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:99999';

    var box = document.createElement('div');
    box.style.cssText = 'min-width:320px;max-width:90vw;background:#111827;color:#fff;border-radius:12px;padding:18px;border:1px solid #374151;box-shadow:0 10px 30px rgba(0,0,0,.35)';

    var h = document.createElement('div');
    h.textContent = 'Вход администратора';
    h.style.cssText = 'font-weight:700;font-size:18px;margin-bottom:10px';

    var p = document.createElement('div');
    p.textContent = 'Введите email и пароль администратора';
    p.style.cssText = 'opacity:.9;margin-bottom:10px';

    var email = document.createElement('input');
    email.type = 'email';
    email.placeholder = 'email';
    email.autocomplete = 'off';
    email.style.cssText = 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid #4b5563;background:#0b1220;color:#fff;outline:none;margin-bottom:8px';

    var pass = document.createElement('input');
    pass.type = 'password';
    pass.placeholder = 'Пароль';
    pass.autocomplete = 'off';
    pass.style.cssText = 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid #4b5563;background:#0b1220;color:#fff;outline:none;margin-bottom:8px';

    var err = document.createElement('div');
    err.id = 'adminErr';
    err.style.cssText = 'color:#fca5a5;min-height:18px;margin-bottom:6px;font-size:13px';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px';

    var btnCancel = document.createElement('button');
    btnCancel.textContent = 'Отмена';
    btnCancel.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #4b5563;border-radius:8px;padding:8px 12px;cursor:pointer';

    var btnOk = document.createElement('button');
    btnOk.textContent = 'Войти';
    btnOk.style.cssText = 'background:#2563eb;color:#fff;border:1px solid #2563eb;border-radius:8px;padding:8px 12px;cursor:pointer';

    row.appendChild(btnCancel);
    row.appendChild(btnOk);

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(email);
    box.appendChild(pass);
    box.appendChild(err);
    box.appendChild(row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);

    function close() {
      wrap.style.display = 'none';
      email.value = '';
      pass.value = '';
      err.textContent = '';
    }
    function open() {
      wrap.style.display = 'flex';
      setTimeout(function () { email.focus(); }, 0);
    }

    async function submit() {
      var em = (email.value || '').trim();
      var pw = (pass.value || '').trim();
      if (!em || !pw) {
        err.textContent = 'Введите email и пароль';
        return;
      }
      err.textContent = '';
      var ok = await adminLogin(em, pw);
      if (ok) {
        close();
      } else {
        err.textContent = 'Неверный логин или пароль, либо нет прав администратора';
      }
    }

    btnCancel.onclick = close;
    btnOk.onclick = submit;
    email.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); pass.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    pass.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };

    G.__adminModal = { open: open, close: close };
    G.__adminModalReady = true;
  }

  // === Секретная клавиатура: «дж» — вход, «ъ» — выход ===
  var seq = [];
  var lastTs = 0;
  var GAP = 700;

  G.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();

    // немедленный выход по «ъ»
    if (k === 'ъ') {
      adminLogout();
      seq = [];
      return;
    }

    // игнорируем ввод в полях
    var el = e.target;
    if (el && el.tagName) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    }
    if (e.isComposing) return;

    var now = Date.now();
    if (now - lastTs > GAP) seq = [];
    lastTs = now;
    seq.push(k);
    if (seq.length > 3) seq.shift();

    if (seq.length >= 2 && seq[0] === 'д' && seq[1] === 'ж') {
      ensureModal();
      if (G.__adminModal) G.__adminModal.open();
      seq = [];
      return;
    }
  });

  // При загрузке пробуем восстановить статус
  (async function restoreOnLoad() {
    await refreshAdmin();
  })();
})();
