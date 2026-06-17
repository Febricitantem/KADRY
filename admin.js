// admin.js — единый Supabase Auth-слой Kadry
// Email Magic Link / OTP, общий Supabase-клиент, профиль пользователя и проверка profiles.is_admin.

(function () {
  'use strict';

  /**
   * @typedef {Window & typeof globalThis & {
   *   isAdmin?: () => Promise<boolean>,
   *   adminLogin?: (email: string, password?: string) => Promise<boolean>,
   *   adminLogout?: () => Promise<void>,
   *   kadrySignInWithEmail?: (email: string) => Promise<{ok:boolean,error?:any}>,
   *   kadrySignOut?: () => Promise<void>,
   *   kadryGetAuthState?: () => Promise<any>,
   *   kadryRefreshAuthUI?: () => Promise<any>,
   *   kadryIsAuthenticated?: () => Promise<boolean>,
   *   kadryRequireAuth?: (message?: string) => Promise<boolean>,
   *   __supabaseClient?: any,
   *   __kadryAuthModal?: { open:(mode?:string)=>void, close:()=>void },
   *   __adminModal?: { open:()=>void, close:()=>void },
   *   __adminModalReady?: boolean
   * }} KadryWindow
   */

  /** @type {KadryWindow} */
  var G = /** @type {any} */ (window);

  var PROJECT_URL = 'https://upanhirmxhfzpajvswoq.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYW5oaXJteGhmenBhanZzd29xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2NjIwNzcsImV4cCI6MjA3MjIzODA3N30.HhrccU3DfoLadflBmTxIDXJgrDQB3m2zLRX3vtRycGA';
  var AUTH_STORAGE_KEY = 'kadry-auth';

  var authState = {
    initialized: false,
    user: null,
    profile: null,
    isAdmin: false
  };

  var adminState = {
    checkedOnce: false,
    isAdmin: false
  };

  function fire(name, detail) {
    try { G.dispatchEvent(new CustomEvent(name, { detail: detail || null })); } catch (_) {}
  }

  function getSupabaseClient() {
    try {
      if (G.__supabaseClient) return G.__supabaseClient;
      var supa = G.supabase;
      if (!supa || typeof supa.createClient !== 'function') return null;
      var client = supa.createClient(PROJECT_URL, ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: AUTH_STORAGE_KEY
        }
      });
      G.__supabaseClient = client;
      return client;
    } catch (e) {
      console.warn('[kadry][auth] supabase client init failed', e);
      return null;
    }
  }

  var supabase = getSupabaseClient();

  function isV2() {
    return !!(supabase && supabase.auth && !supabase.auth.signIn);
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function cleanProfileText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function emailLocalPart(user) {
    var email = user && user.email ? String(user.email).trim() : '';
    if (!email || email.indexOf('@') === -1) return '';
    return email.split('@')[0].toLowerCase();
  }

  function isEmailFallbackName(value, user) {
    var v = cleanProfileText(value).toLowerCase();
    var local = emailLocalPart(user);
    return !!(v && local && v === local);
  }

  function fallbackDisplayName(user) {
    if (!user) return 'Гость';
    var meta = user.user_metadata || user.raw_user_meta_data || {};
    var fromMeta = cleanProfileText(meta.display_name || meta.full_name || meta.name || meta.preferred_username);
    if (fromMeta && !isEmailFallbackName(fromMeta, user)) return fromMeta;
    return 'Игрок';
  }

  function profileDisplayName(profile, user) {
    if (profile) {
      // display_name и username — публичные поля профиля, заданные пользователем.
      // Их нельзя подменять на постоянное «Игрок», даже если ник совпадает
      // с локальной частью email: иначе в шапке теряется реальный ник аккаунта.
      var dn = cleanProfileText(profile.display_name);
      if (dn) return dn;
      var un = cleanProfileText(profile.username);
      if (un) return un;
    }
    return fallbackDisplayName(user);
  }

  function profileAvatarUrl(profile) {
    return cleanProfileText(profile && profile.avatar_url);
  }

  function profileAvatarInitial(profile, user) {
    var name = profileDisplayName(profile, user) || 'Игрок';
    return String(name).trim().charAt(0).toUpperCase() || 'И';
  }

  function makeAuthAvatar(profile, user, name) {
    var a = document.createElement('a');
    a.className = 'kadry-auth-avatar';
    a.href = profileHref(profile, user);
    a.title = 'Открыть профиль ' + (name || 'Игрок');
    a.setAttribute('aria-label', a.title);

    var url = profileAvatarUrl(profile);
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = name || 'Аватар профиля';
      a.appendChild(img);
    } else {
      a.textContent = profileAvatarInitial(profile, user);
    }
    return a;
  }

  function validateNick(nick) {
    var v = cleanProfileText(nick);
    if (!v) return 'Введите ник.';
    if (v.length < 2 || v.length > 50) return 'Ник должен быть от 2 до 50 символов.';
    if (/[<>]/.test(v)) return 'В нике нельзя использовать < и >.';
    return '';
  }

  function normalizeProfileLink(value) {
    return String(value || '').trim().toLowerCase();
  }

  function validateProfileLink(value) {
    var v = normalizeProfileLink(value);
    if (!v) return '';
    if (v.length < 3 || v.length > 32) return 'Ссылка должна быть от 3 до 32 символов.';
    if (!/^[a-z][a-z0-9]*$/.test(v)) {
      return 'Ссылка должна начинаться с латинской буквы и содержать только a-z и 0-9.';
    }
    return '';
  }

  function profileHref(profile, user) {
    var username = normalizeProfileLink(profile && profile.username);
    if (username && !validateProfileLink(username)) return 'profile.html?u=' + encodeURIComponent(username);
    var id = (profile && profile.id) || (user && user.id);
    return id ? 'profile.html?id=' + encodeURIComponent(id) : 'profile.html';
  }

  async function saveOwnProfile(draft) {
    supabase = getSupabaseClient();
    var state = authState.initialized ? authState : await refreshAuthState();
    var user = state && state.user;
    if (!supabase || !user || !user.id) {
      return { ok: false, error: new Error('Нужно войти в аккаунт') };
    }

    var nick = cleanProfileText(draft && (draft.nick || draft.display_name));
    var username = normalizeProfileLink(draft && (draft.username || draft.profile_link));
    var validation = validateNick(nick) || validateProfileLink(username);
    if (validation) return { ok: false, error: new Error(validation) };

    try {
      var res = await supabase
        .from('profiles')
        .update({ display_name: nick, username: username || null })
        .eq('id', user.id)
        .select('id,is_admin,username,display_name,avatar_url,provider,created_at,updated_at')
        .single();

      if (res.error) {
        if (res.error.code === '23505') return { ok: false, error: new Error('Эта ссылка уже занята.') };
        return { ok: false, error: res.error };
      }

      authState.profile = res.data || authState.profile;
      authState.isAdmin = !!(authState.profile && authState.profile.is_admin);
      renderAuthUI();
      fire('kadry:auth-changed', { user: authState.user, profile: authState.profile, isAdmin: authState.isAdmin });
      return { ok: true, profile: authState.profile };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function getCurrentUser() {
    supabase = getSupabaseClient();
    if (!supabase || !supabase.auth) return null;
    try {
      if (isV2() && typeof supabase.auth.getUser === 'function') {
        var r = await supabase.auth.getUser();
        if (r && !r.error && r.data && r.data.user) return r.data.user;
        return null;
      }
      if (typeof supabase.auth.user === 'function') {
        return supabase.auth.user();
      }
    } catch (e) {
      console.warn('[kadry][auth] getCurrentUser failed', e);
    }
    return null;
  }

  async function getCurrentSession() {
    supabase = getSupabaseClient();
    if (!supabase || !supabase.auth) return null;
    try {
      if (isV2() && typeof supabase.auth.getSession === 'function') {
        var r = await supabase.auth.getSession();
        if (r && !r.error && r.data && r.data.session) return r.data.session;
        return null;
      }
      if (typeof supabase.auth.session === 'function') {
        return supabase.auth.session();
      }
    } catch (e) {
      console.warn('[kadry][auth] getCurrentSession failed', e);
    }
    return null;
  }

  function shouldCleanAuthUrl() {
    try {
      var u = new URL(G.location.href);
      var keys = ['code', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'provider_token', 'provider_refresh_token'];
      for (var i = 0; i < keys.length; i += 1) {
        if (u.searchParams.has(keys[i])) return true;
      }
      if (u.hash && /(access_token|refresh_token|expires_in|token_type|code)=/i.test(u.hash)) return true;
    } catch (_) {}
    return false;
  }

  function cleanAuthUrl() {
    try {
      if (!shouldCleanAuthUrl()) return;
      var u = new URL(G.location.href);
      var keys = ['code', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'provider_token', 'provider_refresh_token'];
      keys.forEach(function (k) { u.searchParams.delete(k); });
      if (u.hash && /(access_token|refresh_token|expires_in|token_type|code)=/i.test(u.hash)) u.hash = '';
      G.history.replaceState({}, document.title, u.pathname + u.search + u.hash);
    } catch (e) {
      console.warn('[kadry][auth] cleanAuthUrl failed', e);
    }
  }

  async function fetchProfile(user, attempt) {
    if (!supabase || !user || !user.id) return null;
    var n = attempt || 0;
    try {
      var res = await supabase
        .from('profiles')
        .select('id,is_admin,username,display_name,avatar_url,provider,created_at,updated_at')
        .eq('id', user.id)
        .maybeSingle();

      if (!res.error && res.data) return res.data;

      // После первого magic link trigger может создать строку с небольшой задержкой.
      if (!res.data && n < 4) {
        await new Promise(function (resolve) { setTimeout(resolve, 250 + n * 250); });
        return await fetchProfile(user, n + 1);
      }

      if (res.error && res.error.code !== 'PGRST116') {
        console.warn('[kadry][auth] profile fetch error', res.error);
      }
    } catch (e) {
      console.warn('[kadry][auth] profile fetch failed', e);
    }
    return null;
  }

  async function refreshAuthState() {
    supabase = getSupabaseClient();
    var session = await getCurrentSession();
    var user = session && session.user ? session.user : await getCurrentUser();
    var profile = user ? await fetchProfile(user, 0) : null;

    authState.initialized = true;
    authState.user = user || null;
    authState.profile = profile || null;
    authState.isAdmin = !!(profile && profile.is_admin);

    adminState.checkedOnce = true;
    adminState.isAdmin = authState.isAdmin;
    setHtmlAdmin(authState.isAdmin);

    renderAuthUI();

    fire('kadry:auth-changed', {
      user: authState.user,
      profile: authState.profile,
      isAdmin: authState.isAdmin
    });
    fire(authState.isAdmin ? 'admin:enabled' : 'admin:disabled', {
      user: authState.user,
      profile: authState.profile
    });

    // Не удаляем ?code= до того, как SDK успеет обменять magic-link code на session.
    // После успешного входа URL очищается от служебных auth-параметров.
    if (authState.user || (G.location.hash && /(access_token|refresh_token)=/i.test(G.location.hash))) {
      cleanAuthUrl();
    }
    return authState;
  }

  async function signInWithMagicLink(email) {
    supabase = getSupabaseClient();
    email = normalizeEmail(email);
    if (!email || !supabase || !supabase.auth) {
      return { ok: false, error: new Error('Не указан email или не создан Supabase-клиент') };
    }

    try {
      var redirectTo = G.location.href;

      if (isV2() && typeof supabase.auth.signInWithOtp === 'function') {
        var r2 = await supabase.auth.signInWithOtp({
          email: email,
          options: { emailRedirectTo: redirectTo }
        });
        if (r2.error) return { ok: false, error: r2.error };
        return { ok: true };
      }

      // Fallback для старого SDK v1. Основные страницы переведены на SDK v2,
      // но fallback оставлен, чтобы auth не падал при случайной старой сборке.
      if (typeof supabase.auth.signIn === 'function') {
        var r1 = await supabase.auth.signIn(
          { email: email },
          { redirectTo: redirectTo }
        );
        if (r1.error) return { ok: false, error: r1.error };
        return { ok: true };
      }

      return { ok: false, error: new Error('Метод passwordless-входа недоступен в Supabase SDK') };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function signOut() {
    supabase = getSupabaseClient();
    if (!supabase || !supabase.auth || typeof supabase.auth.signOut !== 'function') return;
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[kadry][auth] signOut error', e);
    }
  }

  function setHtmlAdmin(on) {
    var root = document.documentElement;
    if (!root || !root.classList) return;
    if (on) root.classList.add('is-admin');
    else root.classList.remove('is-admin');
  }

  async function fetchIsAdmin() {
    var state = await refreshAuthState();
    return !!(state && state.isAdmin);
  }

  async function refreshAdmin() {
    var ok = await fetchIsAdmin();
    adminState.isAdmin = ok;
    adminState.checkedOnce = true;
    setHtmlAdmin(ok);
    return ok;
  }

  async function isAdmin() {
    if (!adminState.checkedOnce) return await refreshAdmin();
    if (!adminState.isAdmin) return await refreshAdmin();
    return true;
  }

  // Сохраняем старое имя API, но теперь это passwordless-запрос.
  async function adminLogin(email) {
    var r = await signInWithMagicLink(email);
    return !!r.ok;
  }

  async function adminLogout() {
    await signOut();
    authState.user = null;
    authState.profile = null;
    authState.isAdmin = false;
    adminState.isAdmin = false;
    adminState.checkedOnce = true;
    setHtmlAdmin(false);
    renderAuthUI();
    fire('kadry:auth-changed', { user: null, profile: null, isAdmin: false });
    fire('admin:disabled', { user: null, profile: null });
  }

  G.isAdmin = isAdmin;
  G.adminLogin = adminLogin;
  G.adminLogout = adminLogout;
  G.kadrySignInWithEmail = signInWithMagicLink;
  G.kadrySaveProfile = saveOwnProfile;
  G.kadryProfileHref = profileHref;
  G.kadryNormalizeProfileLink = normalizeProfileLink;
  G.kadryValidateProfileLink = validateProfileLink;
  G.kadrySignOut = adminLogout;
  G.kadryGetAuthState = async function () {
    if (!authState.initialized) return await refreshAuthState();
    return authState;
  };
  G.kadryRefreshAuthUI = refreshAuthState;
  G.kadryIsAuthenticated = async function () {
    var state = authState.initialized ? authState : await refreshAuthState();
    return !!(state && state.user);
  };
  G.kadryRequireAuth = async function (message) {
    var state = authState.initialized ? authState : await refreshAuthState();
    if (state && state.user) return true;
    ensureAuthModal();
    if (G.__kadryAuthModal) {
      G.__kadryAuthModal.open(
        message || 'Войдите в аккаунт, чтобы выполнить это действие.'
      );
    }
    return false;
  };

  function injectAuthStyles() {
    if (document.getElementById('kadry-auth-styles')) return;
    var style = document.createElement('style');
    style.id = 'kadry-auth-styles';
    style.textContent = [
      '.kadry-auth-slot{gap:8px;min-width:0;}',
      '.kadry-auth-login,.kadry-auth-logout{border:1px solid #d1d5db;background:#fff;color:#0f172a;border-radius:10px;padding:7px 10px;font:inherit;font-weight:700;cursor:pointer;}',
      '.kadry-auth-login:hover,.kadry-auth-logout:hover{background:#e5e7eb40;}',
      '.kadry-auth-logout{font-size:12px;padding:5px 8px;font-weight:600;}',
      '.kadry-auth-name{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      'a.kadry-auth-name{color:inherit;text-decoration:none;border-bottom:1px dashed rgba(15,23,42,.35);}',
      'a.kadry-auth-name:hover{color:#2563eb;border-bottom-color:#2563eb;}',
      '.kadry-auth-hint{font-size:12px;color:#9ca3af;margin:-3px 0 8px;line-height:1.35;}',
      '.kadry-auth-admin{font-size:11px;border:1px solid #f59e0b;color:#92400e;background:#fffbeb;border-radius:999px;padding:3px 6px;font-weight:800;}',
      '.kadry-auth-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.55);z-index:99999;padding:18px;}',
      '.kadry-auth-card{width:min(380px,92vw);background:#111827;color:#fff;border-radius:14px;padding:18px;border:1px solid #374151;box-shadow:0 18px 45px rgba(0,0,0,.35);}',
      '.kadry-auth-title{font-weight:800;font-size:18px;margin-bottom:8px;}',
      '.kadry-auth-text{opacity:.9;font-size:14px;margin-bottom:12px;line-height:1.35;}',
      '.kadry-auth-input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid #4b5563;background:#0b1220;color:#fff;outline:none;margin-bottom:8px;}',
      '.kadry-auth-error{color:#fca5a5;min-height:18px;margin-bottom:6px;font-size:13px;}',
      '.kadry-auth-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap;}',
      '.kadry-auth-btn{border-radius:9px;padding:8px 12px;cursor:pointer;font-weight:700;border:1px solid #4b5563;background:#111827;color:#e5e7eb;}',
      '.kadry-auth-btn.primary{background:#2563eb;color:#fff;border-color:#2563eb;}',
      '.kadry-auth-btn.danger{background:#7f1d1d;color:#fee2e2;border-color:#991b1b;}',
      '.kadry-auth-required{outline:2px solid rgba(37,99,235,.35);outline-offset:2px;}',
      '@media (max-width:768px){.kadry-auth-name{max-width:110px}.kadry-auth-slot{flex-wrap:wrap}.kadry-auth-logout{font-size:11px;padding:4px 7px}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function findAuthSlots() {
    return Array.prototype.slice.call(document.querySelectorAll('.site-header .hslot.h4, .site-header [data-kadry-auth-slot="1"]'));
  }

  function ensureAuthSlots() {
    injectAuthStyles();
    var found = findAuthSlots();

    found.forEach(function (slot) {
      if (slot.dataset && slot.dataset.kadryAuthPrepared === '1') return;

      var newSlot = slot;
      if (slot.tagName && slot.tagName.toLowerCase() === 'a') {
        newSlot = document.createElement('div');
        newSlot.className = slot.className;
        if (slot.id) newSlot.id = slot.id;
        Array.prototype.slice.call(slot.attributes || []).forEach(function (attr) {
          if (attr.name !== 'href' && attr.name !== 'class' && attr.name !== 'id') {
            try { newSlot.setAttribute(attr.name, attr.value); } catch (_) {}
          }
        });
        slot.parentNode.replaceChild(newSlot, slot);
      }

      newSlot.dataset.kadryAuthSlot = '1';
      newSlot.dataset.kadryAuthPrepared = '1';
      newSlot.classList.add('kadry-auth-slot');
    });
  }

  function renderAuthUI() {
    if (!document.body) return;
    ensureAuthSlots();

    var slots = findAuthSlots();
    var user = authState.user;
    var profile = authState.profile;
    var admin = authState.isAdmin;
    var name = user ? profileDisplayName(profile, user) : '';

    slots.forEach(function (slot) {
      slot.innerHTML = '';
      if (!user) {
        var loginBtn = document.createElement('button');
        loginBtn.type = 'button';
        loginBtn.className = 'kadry-auth-login';
        loginBtn.textContent = 'Войти';
        loginBtn.addEventListener('click', function (e) {
          e.preventDefault();
          ensureAuthModal();
          if (G.__kadryAuthModal) G.__kadryAuthModal.open('login');
        });
        slot.appendChild(loginBtn);
        return;
      }


      var nameEl = document.createElement('a');
      nameEl.className = 'kadry-auth-name';
      nameEl.href = profileHref(authState.profile, user);
      nameEl.textContent = name || 'Игрок';
      nameEl.title = 'Открыть профиль' + (admin ? ' · админ' : '');

      slot.appendChild(nameEl);

      if (admin) {
        var badge = document.createElement('span');
        badge.className = 'kadry-auth-admin';
        badge.textContent = 'ADMIN';
        slot.appendChild(badge);
      }

      var logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.className = 'kadry-auth-logout';
      logoutBtn.textContent = 'Выйти';
      logoutBtn.addEventListener('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        await adminLogout();
      });
      slot.appendChild(logoutBtn);
    });
  }

  function ensureAuthModal() {
    if (document.getElementById('kadryAuthModal')) return;
    injectAuthStyles();

    var wrap = document.createElement('div');
    wrap.id = 'kadryAuthModal';
    wrap.className = 'kadry-auth-modal';

    var box = document.createElement('div');
    box.className = 'kadry-auth-card';

    var h = document.createElement('div');
    h.className = 'kadry-auth-title';
    h.textContent = 'Вход в Kadry';

    var p = document.createElement('div');
    p.className = 'kadry-auth-text';
    p.textContent = 'Введите email. Мы отправим письмо со ссылкой для входа без пароля.';

    var email = document.createElement('input');
    email.type = 'email';
    email.placeholder = 'email@example.com';
    email.autocomplete = 'email';
    email.className = 'kadry-auth-input';

    var err = document.createElement('div');
    err.id = 'kadryAuthErr';
    err.className = 'kadry-auth-error';

    var actions = document.createElement('div');
    actions.className = 'kadry-auth-actions';

    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'kadry-auth-btn';
    btnCancel.textContent = 'Отмена';

    var btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'kadry-auth-btn primary';
    btnOk.textContent = 'Отправить письмо';

    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(email);
    box.appendChild(err);
    box.appendChild(actions);
    wrap.appendChild(box);
    document.body.appendChild(wrap);

    function close() {
      wrap.style.display = 'none';
      err.textContent = '';
    }

    function open(message) {
      wrap.style.display = 'flex';
      var defaultText = 'Введите email. Мы отправим письмо со ссылкой для входа без пароля. Ник вы сможете изменить внутри профиля.';
      p.textContent = (message && message !== 'login') ? String(message) : defaultText;
      btnOk.disabled = false;
      btnOk.textContent = 'Отправить письмо';
      err.textContent = '';
      setTimeout(function () { email.focus(); }, 0);
    }

    async function submit() {
      var em = normalizeEmail(email.value);
      if (!em) {
        err.textContent = 'Введите email';
        return;
      }

      err.style.color = '#fca5a5';
      err.textContent = '';
      btnOk.disabled = true;
      btnOk.textContent = 'Отправляем…';

      var r = await signInWithMagicLink(em);
      if (r.ok) {
        err.style.color = '#bbf7d0';
        err.textContent = 'Письмо отправлено. Проверьте почту и откройте ссылку.';
        btnOk.textContent = 'Письмо отправлено';
      } else {
        console.warn('[kadry][auth] magic link error', r.error);
        err.style.color = '#fca5a5';
        err.textContent = 'Не удалось отправить письмо. Проверьте email или лимит отправки.';
        btnOk.disabled = false;
        btnOk.textContent = 'Отправить письмо';
      }
    }

    btnCancel.onclick = close;
    btnOk.onclick = submit;
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) close();
    });
    email.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    G.__kadryAuthModal = { open: open, close: close };
    G.__adminModal = { open: open, close: close };
    G.__adminModalReady = true;
  }


  // Секретная клавиатура: «дж» открывает вход, «ъ» — выход.
  var seq = [];
  var lastTs = 0;
  var GAP = 700;

  G.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();

    if (k === 'ъ') {
      adminLogout();
      seq = [];
      return;
    }

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
      ensureAuthModal();
      if (G.__kadryAuthModal) G.__kadryAuthModal.open('login');
      seq = [];
    }
  });

  function boot() {
    ensureAuthSlots();
    ensureAuthModal();
    refreshAuthState();

    supabase = getSupabaseClient();
    if (supabase && supabase.auth && typeof supabase.auth.onAuthStateChange === 'function') {
      try {
        supabase.auth.onAuthStateChange(function () {
          setTimeout(refreshAuthState, 0);
        });
      } catch (e) {
        console.warn('[kadry][auth] onAuthStateChange bind failed', e);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
