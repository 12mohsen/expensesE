// ============================================================
// دفتر المنزل - منطق التطبيق
// ============================================================

// ⚙️ إعدادات Supabase
const SUPABASE_URL = 'https://tvbuvwjkojhqcxhyehfs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2YnV2d2prb2pocWN4aHllaGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MDE4MTUsImV4cCI6MjA5MjI3NzgxNX0.egwryYwKu_Bicl_koaYXaKGBoxz42c6k4VkMD9aZSWQ';

// التحقق من إعدادات Supabase
let sb = null;
let useLocalStorage = false;

let supabaseReady = false;
function initSupabase() {
  if (!window.supabase) {
    console.log('⏳ انتظار تحميل Supabase...');
    setTimeout(initSupabase, 100);
    return;
  }
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase متصل');
    useLocalStorage = false;
  } catch (e) {
    console.error('❌ خطأ في Supabase، سيتم استخدام LocalStorage:', e);
    useLocalStorage = true;
  }
  supabaseReady = true;
  // تأخير دائم لانتظار تهيئة كل متغيرات التطبيق (let/const غير مرفوعة)
  window.addEventListener('load', () => {
    if (typeof autoLogin === 'function') autoLogin();
  });
  // احتياط: إذا كان الـ load حدث بالفعل
  if (document.readyState === 'complete') {
    setTimeout(() => { if (typeof autoLogin === 'function') autoLogin(); }, 50);
  }
}
initSupabase();

// Fallback: التخزين المحلي
const LS_USERS = 'dm_users';
const LS_EXP = (u) => `dm_exp_${u}`;
const LS_THEME = 'dm_theme';

// --- مساعدات ---
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtMoney = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function formMsg(form, msg, type = '') {
  const el = form.querySelector('.form-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `form-msg ${type}`;
}

// تجزئة كلمة السر (مع بديل لـ file://)
async function hash(txt) {
  try {
    if (crypto && crypto.subtle) {
      const enc = new TextEncoder().encode(txt);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { console.warn('crypto.subtle غير متاح، استخدام بديل'); }
  // بديل بسيط (djb2 hash)
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h) + txt.charCodeAt(i);
  return 'djb2_' + (h >>> 0).toString(16) + '_' + txt.length;
}

// ============ وظائف Supabase + LocalStorage ============
const DB = {
  // التحقق من الاتصال
  isConnected() {
    return sb !== null && !useLocalStorage;
  },

  // المستخدمين
  async getUser(username) {
    if (this.isConnected()) {
      try {
        const { data } = await sb.from('users').select('*').eq('username', username).single();
        return data;
      } catch (e) { return null; }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      return users[username] || null;
    }
  },
  async getUserInApp(username, appOrigin) {
    if (this.isConnected()) {
      try {
        const { data } = await sb.from('users').select('*').eq('username', username).eq('app_origin', appOrigin).single();
        return data;
      } catch (e) { return null; }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      const user = users[username] || null;
      return user && user.app_origin === appOrigin ? user : null;
    }
  },
  async createUser(username, password_hash, hint) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('users').insert({ username, password_hash, hint, app_origin: 'نفقات' });
        if (error) console.error('خطأ في إنشاء المستخدم:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      if (users[username]) return false;
      users[username] = { password: password_hash, hint };
      localStorage.setItem(LS_USERS, JSON.stringify(users));
      return true;
    }
  },

  // المصاريف (النشطة فقط)
  async getExpenses(username) {
    if (this.isConnected()) {
      try {
        const { data, error } = await sb.from('expenses').select('*').eq('username', username).is('deleted_at', null).order('date', { ascending: false });
        if (error) { console.error(error); toast('خطأ في تحميل البيانات', 'error'); return []; }
        return data || [];
      } catch (e) { console.error(e); return []; }
    } else {
      const arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      return arr.filter(x => !x.deleted_at);
    }
  },

  // المحذوفات (خلال 30 يوم)
  async getTrash(username) {
    if (this.isConnected()) {
      try {
        const { data, error } = await sb.from('expenses').select('*').eq('username', username).not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
        if (error) { console.error(error); return []; }
        return data || [];
      } catch (e) { console.error(e); return []; }
    } else {
      const arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      return arr.filter(x => x.deleted_at);
    }
  },

  // استرجاع
  async restoreExpense(id, username) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: null }).eq('id', id);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      arr = arr.map(x => x.id === id ? { ...x, deleted_at: null } : x);
      localStorage.setItem(LS_EXP(username), JSON.stringify(arr));
      return true;
    }
  },

  // حذف نهائي من السلة
  async purgeExpense(id, username) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').delete().eq('id', id);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      arr = arr.filter(x => x.id !== id);
      localStorage.setItem(LS_EXP(username), JSON.stringify(arr));
      return true;
    }
  },

  // تنظيف تلقائي للعناصر الأقدم من 30 يوم
  async purgeOldTrash(username) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    if (this.isConnected()) {
      try {
        await sb.from('expenses').delete().eq('username', username).not('deleted_at', 'is', null).lt('deleted_at', cutoff);
      } catch (e) { console.error(e); }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      arr = arr.filter(x => !x.deleted_at || x.deleted_at >= cutoff);
      localStorage.setItem(LS_EXP(username), JSON.stringify(arr));
    }
  },
  async addExpense(item) {
    if (this.isConnected()) {
      try {
        item.id = uid();
        const { error } = await sb.from('expenses').insert(item);
        if (error) console.error('خطأ في إضافة المصروف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(item.username)) || '[]');
      item.id = uid();
      arr.unshift(item);
      localStorage.setItem(LS_EXP(item.username), JSON.stringify(arr));
      return true;
    }
  },
  async updateExpense(id, item) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update(item).eq('id', id);
        if (error) console.error('خطأ في تحديث المصروف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(item.username)) || '[]');
      arr = arr.map(x => x.id === id ? { ...item, id } : x);
      localStorage.setItem(LS_EXP(item.username), JSON.stringify(arr));
      return true;
    }
  },
  // حذف ناعم (نقل للسلة)
  async deleteExpense(id, username) {
    const now = new Date().toISOString();
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: now }).eq('id', id);
        if (error) console.error('خطأ في حذف المصروف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      arr = arr.map(x => x.id === id ? { ...x, deleted_at: now } : x);
      localStorage.setItem(LS_EXP(username), JSON.stringify(arr));
      return true;
    }
  },
  async deleteAllExpenses(username) {
    const now = new Date().toISOString();
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: now }).eq('username', username).is('deleted_at', null);
        if (error) console.error('خطأ في حذف جميع المصاريف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(username)) || '[]');
      arr = arr.map(x => x.deleted_at ? x : { ...x, deleted_at: now });
      localStorage.setItem(LS_EXP(username), JSON.stringify(arr));
      return true;
    }
  }
};

// ============================================================
// المصادقة
// ============================================================
function switchTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.auth-form').forEach(f => f.classList.remove('active'));
  $(`#${name}-form`).classList.add('active');
  $$('.auth-form .form-msg').forEach(m => (m.textContent = ''));
}
$$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

$$('.toggle-pwd').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = btn.previousElementSibling;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const d = Object.fromEntries(new FormData(f));
    const username = d.username.trim().toLowerCase();
    if (username.length < 3) return formMsg(f, 'اسم المستخدم قصير جداً.', 'error');
    if (d.password !== d.password2) return formMsg(f, 'كلمتا السر غير متطابقتين.', 'error');
    if (!d.hint.trim()) return formMsg(f, 'التلميح مطلوب.', 'error');

    formMsg(f, '⏳ جاري الإنشاء...', 'info');

    // التحقق من وجود المستخدم في هذا التطبيق فقط
    const existing = await DB.getUserInApp(username, 'نفقات');
    if (existing) {
      // اقتراح أسماء بديلة
      const suggestions = [
        username + '123',
        username + '_2026',
        username + '_sarf'
      ];
      const suggestionsText = suggestions.join('، ');
      return formMsg(f, `اسم المستخدم مستخدم مسبقاً في هذا التطبيق. جرب: ${suggestionsText}`, 'error');
    }

    // إنشاء المستخدم
    const ok = await DB.createUser(username, await hash(d.password), d.hint.trim());
    if (!ok) return formMsg(f, 'حدث خطأ أثناء الإنشاء.', 'error');

    formMsg(f, 'تم إنشاء الحساب! جاري تسجيل الدخول...', 'success');
    localStorage.setItem('dm_session_user', username);
    localStorage.setItem('dm_remember', '1');
    setTimeout(enterApp, 700);
  } catch (err) {
    console.error(err);
    formMsg(f, 'خطأ غير متوقع: ' + err.message, 'error');
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const d = Object.fromEntries(new FormData(f));
    const username = d.username.trim().toLowerCase();

    formMsg(f, '⏳ جاري تسجيل الدخول...', 'info');

    const user = await DB.getUserInApp(username, 'نفقات');
    if (!user) return formMsg(f, 'لا يوجد حساب بهذا الاسم في هذا التطبيق. سجّل حساباً أولاً.', 'error');

    const pwdHash = await hash(d.password);
    const storedHash = user.password_hash || user.password;
    if (storedHash !== pwdHash) return formMsg(f, 'كلمة السر غير صحيحة.', 'error');

    if (d.remember) {
      localStorage.setItem('dm_session_user', username);
      localStorage.setItem('dm_remember', '1');
      localStorage.setItem('dm_saved_username', username);
      localStorage.setItem('dm_saved_password', d.password);
    } else {
      sessionStorage.setItem('dm_session_user', username);
      localStorage.removeItem('dm_saved_username');
      localStorage.removeItem('dm_saved_password');
    }
    formMsg(f, 'مرحباً بعودتك!', 'success');
    setTimeout(enterApp, 400);
  } catch (err) {
    console.error(err);
    formMsg(f, 'خطأ غير متوقع: ' + err.message, 'error');
  }
});

$('#hint-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const username = new FormData(f).get('username').trim().toLowerCase();
    const user = await DB.getUser(username);
    if (!user) return formMsg(f, 'لا يوجد حساب بهذا الاسم.', 'error');
    formMsg(f, `💡 التلميح: ${user.hint}`, 'info');
  } catch (err) {
    console.error(err);
    formMsg(f, 'خطأ: ' + err.message, 'error');
  }
});

// ============================================================
// التطبيق
// ============================================================
let currentUser = null;
let expenses = [];
let editingId = null;
let currentBudget = 0;

async function loadExpenses() {
  expenses = await DB.getExpenses(currentUser);
  render();
  updateTrashBadge();
}

// ===== سلة المحذوفات =====
async function updateTrashBadge() {
  const trash = await DB.getTrash(currentUser);
  const badge = $('#trash-count');
  if (trash.length > 0) {
    badge.textContent = trash.length;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function daysLeft(deletedAt) {
  const elapsed = (Date.now() - new Date(deletedAt).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(30 - elapsed));
}

async function renderTrash() {
  const trash = await DB.getTrash(currentUser);
  const tbody = $('#trash-table tbody');
  tbody.innerHTML = '';
  $('#trash-empty').style.display = trash.length ? 'none' : 'block';
  $('#trash-table').style.display = trash.length ? '' : 'none';

  trash.forEach(x => {
    const d = daysLeft(x.deleted_at);
    const warn = d <= 7 ? 'warn' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${x.date}</td>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td><span class="tag">${escapeHtml(x.category)}</span></td>
      <td class="amount">${fmtMoney(x.amount)}</td>
      <td><span class="days-left ${warn}">${d} يوم</span></td>
      <td class="row-actions">
        <button title="استرجاع" data-act="restore" data-id="${x.id}">♻️</button>
        <button title="حذف نهائي" data-act="purge" data-id="${x.id}">❌</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openTrash() {
  $('#trash-modal').classList.remove('hidden');
  renderTrash();
}
function closeTrash() {
  $('#trash-modal').classList.add('hidden');
}

$('#trash-btn').addEventListener('click', openTrash);
$('#trash-close').addEventListener('click', closeTrash);
$('#trash-modal .modal-backdrop').addEventListener('click', closeTrash);

$('#trash-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'restore') {
    const trashItems = await DB.getTrash(currentUser);
    const restoredItem = trashItems.find(x => x.id === id);
    const ok = await DB.restoreExpense(id, currentUser);
    if (!ok) return toast('خطأ في الاسترجاع', 'error');
    if (restoredItem && currentBudget > 0) removeFromSpent(restoredItem.amount);
    toast('تم الاسترجاع ♻️', 'success');
    await loadExpenses();
    await renderTrash();
  } else if (btn.dataset.act === 'purge') {
    if (!confirm('حذف نهائي؟ لا يمكن التراجع.')) return;
    const ok = await DB.purgeExpense(id, currentUser);
    if (!ok) return toast('خطأ', 'error');
    toast('تم الحذف نهائياً', 'error');
    await renderTrash();
    await updateTrashBadge();
  }
});

$('#trash-purge').addEventListener('click', async () => {
  const trash = await DB.getTrash(currentUser);
  if (!trash.length) return toast('السلة فارغة');
  if (!confirm('إفراغ السلة نهائياً؟ لا يمكن التراجع.')) return;
  for (const x of trash) await DB.purgeExpense(x.id, currentUser);
  toast('تم إفراغ السلة', 'error');
  await renderTrash();
  await updateTrashBadge();
});

async function enterApp() {
  currentUser = localStorage.getItem('dm_session_user') || sessionStorage.getItem('dm_session_user');
  if (!currentUser) return;
  $('#auth-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  $('#user-label').textContent = currentUser;
  await DB.purgeOldTrash(currentUser); // تنظيف العناصر الأقدم من 30 يوم
  loadBudget();
  await loadExpenses();
  $('#expense-form [name=date]').value = new Date().toISOString().slice(0, 10);
}

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('dm_session_user');
  sessionStorage.removeItem('dm_session_user');
  localStorage.removeItem('dm_remember');
  currentUser = null;
  expenses = [];
  $('#app-screen').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  switchTab('login');
});

// التصنيف المخصص - إظهار/إخفاء حقل الإدخال
$('#cat-select').addEventListener('change', (e) => {
  const custom = $('#custom-cat');
  if (e.target.value === '__custom__') {
    custom.style.display = 'block';
    custom.required = true;
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.required = false;
    custom.value = '';
  }
});

// إضافة/تحديث مصروف
$('#expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const d = Object.fromEntries(new FormData(f));
  const cat = d.category === '__custom__' ? (d.custom_category?.trim() || 'أخرى') : d.category;

  const item = {
    username: currentUser,
    title: d.title.trim(),
    amount: parseFloat(d.amount) || 0,
    category: cat,
    date: d.date,
    note: d.note.trim(),
  };

  let ok;
  if (editingId) {
    ok = await DB.updateExpense(editingId, item);
    if (!ok) return toast('خطأ في التحديث', 'error');
    toast('تم تحديث المصروف', 'success');
    editingId = null;
    f.querySelector('button[type=submit]').textContent = 'حفظ المصروف';
  } else {
    ok = await DB.addExpense(item);
    if (!ok) return toast('خطأ في الإضافة', 'error');
    toast('تمت إضافة المصروف', 'success');
  }

  f.reset();
  $('#custom-cat').style.display = 'none';
  $('#expense-form [name=date]').value = new Date().toISOString().slice(0, 10);
  await loadExpenses();
});

// البحث والتصفية
$('#search').addEventListener('input', render);
$('#filter-cat').addEventListener('change', render);

$('#clear-all').addEventListener('click', async () => {
  if (!expenses.length) return toast('لا يوجد شيء لحذفه');
  if (!confirm('هل أنت متأكد من حذف جميع المصاريف؟')) return;
  if (currentBudget > 0) {
    const totalActive = expenses.reduce((s, x) => s + x.amount, 0);
    addToSpent(totalActive);
  }
  const ok = await DB.deleteAllExpenses(currentUser);
  if (!ok) return toast('خطأ في الحذف', 'error');
  toast('تم حذف الكل', 'error');
  await loadExpenses();
});

// التصدير
$('#export-btn').addEventListener('click', () => {
  if (!expenses.length) return toast('لا توجد بيانات للتصدير');
  const rows = [['التاريخ','الوصف','التصنيف','المبلغ','ملاحظات']];
  expenses.forEach(x => rows.push([x.date, x.title, x.category, x.amount, x.note || '']));
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `expenses_${currentUser}_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast('تم التصدير بنجاح', 'success');
});

// الوضع الليلي
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#theme-toggle').textContent = t === 'dark' ? '☀️' : '🌙';
}
$('#theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(LS_THEME, cur);
  applyTheme(cur);
});

// ============================================================
// الرسم
// ============================================================
function render() {
  const tbody = $('#expense-table tbody');
  tbody.innerHTML = '';

  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#filter-cat').value;

  // تحديث قائمة التصنيفات في الفلتر
  const cats = [...new Set(expenses.map(x => x.category))].sort();
  const sel = $('#filter-cat');
  const prev = sel.value;
  sel.innerHTML = '<option value="">كل التصنيفات</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = cats.includes(prev) ? prev : '';

  const filtered = expenses.filter(x => {
    if (cat && x.category !== cat) return false;
    if (q && !(x.title.toLowerCase().includes(q) || (x.note||'').toLowerCase().includes(q))) return false;
    return true;
  });

  // عرض مجموع التصنيف المحدد
  const sumEl = $('#cat-sum');
  if (cat) {
    const sum = filtered.reduce((s, x) => s + x.amount, 0);
    sumEl.style.display = 'inline-block';
    sumEl.querySelector('b').textContent = fmtMoney(sum);
  } else {
    sumEl.style.display = 'none';
  }

  $('#empty-row').style.display = filtered.length ? 'none' : 'block';
  $('#expense-table').style.display = filtered.length ? '' : 'none';

  filtered.forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${x.date}</td>
      <td><b>${escapeHtml(x.title)}</b></td>
      <td><span class="tag">${escapeHtml(x.category)}</span></td>
      <td class="amount">${fmtMoney(x.amount)}</td>
      <td>${escapeHtml(x.note || '—')}</td>
      <td class="row-actions">
        <button title="استرجاع المبلغ للميزانية" data-act="refund" data-id="${x.id}">💰</button>
        <button title="تعديل" data-act="edit" data-id="${x.id}">✏️</button>
        <button title="حذف" data-act="del" data-id="${x.id}">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // إحصائيات
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const monthSum = expenses.filter(x => x.date.startsWith(ym)).reduce((s,x)=>s+x.amount,0);
  const total = expenses.reduce((s,x)=>s+x.amount,0);
  $('#stat-month').textContent = fmtMoney(monthSum);
  $('#stat-total').textContent = fmtMoney(total);
  $('#stat-count').textContent = expenses.length;

  const byCat = {};
  expenses.forEach(x => byCat[x.category] = (byCat[x.category]||0) + x.amount);
  const sorted = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  $('#stat-top').textContent = sorted[0] ? sorted[0][0] : '—';

  // تحديث الميزانية
  updateBudgetDisplay();

  // مخطط التصنيفات
  const chart = $('#cat-chart');
  if (!sorted.length) {
    chart.innerHTML = '<p class="empty">لا توجد بيانات بعد.</p>';
  } else {
    const max = sorted[0][1];
    chart.innerHTML = sorted.map(([name, amt]) => `
      <div class="cat-row">
        <div class="cat-top">
          <span class="cat-name">${escapeHtml(name)}</span>
          <span class="cat-amt">${fmtMoney(amt)} (${((amt/total)*100).toFixed(1)}%)</span>
        </div>
        <div class="cat-bar"><span style="width:${(amt/max)*100}%"></span></div>
      </div>
    `).join('');
  }

  // رسم ملخص الأشهر
  renderMonths();
}

// ============================================================
// ملخص الأشهر
// ============================================================
const MONTH_NAMES = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
let showAllMonths = false;

function renderMonths() {
  const grid = $('#months-grid');
  const emptyMsg = $('#months-empty');
  emptyMsg.style.display = 'none';

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentYM = now.toISOString().slice(0, 7);

  // تجميع المصاريف حسب الشهر (YYYY-MM)
  const byMonth = {};
  expenses.forEach(x => {
    const ym = x.date.slice(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { items: [], total: 0, cats: {} };
    byMonth[ym].items.push(x);
    byMonth[ym].total += x.amount;
    byMonth[ym].cats[x.category] = (byMonth[ym].cats[x.category] || 0) + x.amount;
  });

  // جمع كل السنوات الموجودة + السنة الحالية
  const years = new Set([currentYear]);
  Object.keys(byMonth).forEach(ym => years.add(parseInt(ym.split('-')[0])));
  const sortedYears = [...years].sort((a, b) => b - a);

  // تحديث زر العرض
  const toggleBtn = $('#months-toggle');
  if (sortedYears.length <= 1) {
    toggleBtn.style.display = 'none';
  } else {
    toggleBtn.style.display = '';
    toggleBtn.textContent = showAllMonths ? 'السنة الحالية فقط' : 'عرض كل السنوات (' + sortedYears.length + ')';
  }

  const displayYears = showAllMonths ? sortedYears : [currentYear];

  let html = '';
  displayYears.forEach(year => {
    html += `<div class="year-section"><h4 class="year-title">📅 ${year}</h4><div class="months-row">`;

    // عرض الأشهر من يناير (0) إلى الشهر الحالي (للسنة الحالية) أو 12 شهر (للسنوات السابقة)
    const maxMonth = (year === currentYear) ? currentMonth : 11;

    for (let m = 0; m <= maxMonth; m++) {
      const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
      const data = byMonth[ym] || null;
      const monthName = MONTH_NAMES[m];
      const isCurrent = ym === currentYM;
      const total = data ? data.total : 0;
      const count = data ? data.items.length : 0;

      // أعلى تصنيف
      let topName = '—';
      if (data) {
        const topCat = Object.entries(data.cats).sort((a, b) => b[1] - a[1]);
        topName = topCat[0] ? topCat[0][0] : '—';
      }

      // ميزانية الشهر
      const mBudgetKey = `dm_mbudget_${currentUser}_${ym}`;
      const mBudget = parseFloat(localStorage.getItem(mBudgetKey) || '0');
      const remaining = mBudget > 0 ? mBudget - total : null;
      const pct = mBudget > 0 ? Math.min((total / mBudget) * 100, 100) : 0;
      const pctClass = remaining !== null && remaining <= 0 ? 'over' : pct >= 75 ? 'warn' : '';
      const emptyClass = !data ? 'empty-month' : '';

      html += `
        <div class="month-card ${isCurrent ? 'current' : ''} ${emptyClass}">
          <div class="month-header">
            <span class="month-name">${monthName}</span>
            <span class="month-num">${m + 1}</span>
          </div>
          <div class="month-total">${total > 0 ? fmtMoney(total) : '0'}</div>
          <div class="month-meta">
            <span>🧾 ${count} عملية</span>
            ${count > 0 ? `<span>🏆 ${escapeHtml(topName)}</span>` : ''}
          </div>
          <div class="month-budget-row">
            <input type="number" class="month-budget-input" data-ym="${ym}" value="${mBudget || ''}" placeholder="ميزانية الشهر" min="0" step="0.01" lang="en" inputmode="decimal" />
          </div>
          ${mBudget > 0 ? `
            <div class="month-remaining ${pctClass}">
              المتبقي: <b>${fmtMoney(remaining)}</b>
            </div>
            <div class="month-progress"><span class="${pctClass}" style="width:${pct}%"></span></div>
          ` : ''}
        </div>
      `;
    }

    html += `</div></div>`;
  });

  grid.innerHTML = html;

  // التمرير للشهر الحالي
  const currentCard = grid.querySelector('.month-card.current');
  if (currentCard) {
    setTimeout(() => currentCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }), 200);
  }
}

// حفظ ميزانية الشهر عند التغيير
$('#months-grid').addEventListener('change', (e) => {
  const inp = e.target.closest('.month-budget-input');
  if (!inp) return;
  const ym = inp.dataset.ym;
  const val = parseFloat(inp.value) || 0;
  const key = `dm_mbudget_${currentUser}_${ym}`;
  if (val > 0) {
    localStorage.setItem(key, val);
    toast('تم حفظ ميزانية ' + MONTH_NAMES[parseInt(ym.split('-')[1]) - 1] + ': ' + fmtMoney(val), 'success');
  } else {
    localStorage.removeItem(key);
  }
  renderMonths();
});

$('#months-toggle').addEventListener('click', () => {
  showAllMonths = !showAllMonths;
  renderMonths();
});

// أحداث الجدول
$('#expense-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'refund') {
    const item = expenses.find(x => x.id === id);
    if (!item) return;
    if (!currentBudget || currentBudget <= 0) return toast('لا توجد ميزانية لاسترجاع المبلغ إليها', 'error');
    if (!confirm('استرجاع ' + fmtMoney(item.amount) + ' للميزانية وحذف المصروف؟')) return;
    const ok = await DB.deleteExpense(id, currentUser);
    if (!ok) return toast('خطأ في الاسترجاع', 'error');
    removeFromSpent(item.amount);
    toast('تم استرجاع ' + fmtMoney(item.amount) + ' للميزانية 💰', 'success');
    await loadExpenses();
  } else if (btn.dataset.act === 'del') {
    if (!confirm('حذف هذا المصروف؟')) return;
    const item = expenses.find(x => x.id === id);
    const ok = await DB.deleteExpense(id, currentUser);
    if (!ok) return toast('خطأ في الحذف', 'error');
    if (item && currentBudget > 0) addToSpent(item.amount);
    toast('تم الحذف', 'error');
    await loadExpenses();
  } else if (btn.dataset.act === 'edit') {
    const it = expenses.find(x => x.id === id);
    if (!it) return;
    const f = $('#expense-form');
    f.title.value = it.title;
    f.amount.value = it.amount;
    f.category.value = it.category;
    f.date.value = it.date;
    f.note.value = it.note || '';
    editingId = id;
    f.querySelector('button[type=submit]').textContent = 'تحديث المصروف';
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// مشاركة التطبيق
// ============================================================

// ╔══════════════════════════════════════════════════════════╗
// ║   ⬇️⬇️⬇️  رابط التطبيق  ⬇️⬇️⬇️                        ║
// ╚══════════════════════════════════════════════════════════╝
const SHARE_LINK = 'https://www.appcreator24.com/app4008813-n0rd4w';
// ╔══════════════════════════════════════════════════════════╗
// ║   ⬇️⬇️⬇️  رابط المتصفح - ضع الرابط هنا  ⬇️⬇️⬇️       ║
// ╚══════════════════════════════════════════════════════════╝
const BROWSER_LINK = 'https://expensese.netlify.app/';
// ╔══════════════════════════════════════════════════════════╗
// ║   ⬆️⬆️⬆️  الروابط أعلاه  ⬆️⬆️⬆️                        ║
// ╚══════════════════════════════════════════════════════════╝

$('#share-btn').addEventListener('click', async () => {
  if (!SHARE_LINK || SHARE_LINK === 'ضع_الرابط_هنا') {
    toast('لم يتم تحديد رابط المشاركة بعد', 'error');
    return;
  }
  let shareText = '📒 نفقات – إدارة مصاريف المنزل\n\n';
  shareText += '📱 للتطبيق:\n' + SHARE_LINK + '\n\n';
  if (BROWSER_LINK && BROWSER_LINK !== 'ضع_رابط_المتصفح_هنا') {
    shareText += '🌐 اضغط للانتقال إلى المتصفح:\n' + BROWSER_LINK;
  }
  const shareData = {
    title: 'نفقات – إدارة مصاريف المنزل',
    text: shareText,
    url: SHARE_LINK,
  };
  // محاولة استخدام Web Share API (يعمل على الجوال والمتصفحات الحديثة)
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (e) { /* المستخدم ألغى */ }
  } else {
    // إذا لم يدعم المتصفح Web Share، نعرض خيارات المشاركة يدوياً
    const encoded = encodeURIComponent(SHARE_LINK);
    const textEncoded = encodeURIComponent(shareText);
    const modal = document.createElement('div');
    modal.className = 'modal share-modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card" style="max-width:400px;text-align:center;">
        <div class="modal-head">
          <h3>🔗 مشاركة التطبيق</h3>
          <button class="icon-btn share-close" aria-label="إغلاق">✖</button>
        </div>
        <div class="share-options">
          <a href="https://wa.me/?text=${textEncoded}" target="_blank" class="share-opt" title="واتساب">💬<span>واتساب</span></a>
          <a href="https://t.me/share/url?url=${encoded}&text=${textEncoded}" target="_blank" class="share-opt" title="تلغرام">✈️<span>تلغرام</span></a>
          <a href="https://x.com/intent/post?text=${textEncoded}" target="_blank" class="share-opt" title="تويتر X">🐦<span>تويتر X</span></a>
          <button class="share-opt" id="share-copy" title="نسخ الرابط">📋<span>نسخ الرابط</span></button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.modal-backdrop').addEventListener('click', () => modal.remove());
    modal.querySelector('.share-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#share-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(SHARE_LINK).then(() => {
        toast('تم نسخ الرابط ✅', 'success');
        modal.remove();
      }).catch(() => {
        prompt('انسخ الرابط:', SHARE_LINK);
      });
    });
  }
});

// ============================================================
// الميزانية
// ============================================================
function getBudgetKey() {
  return `dm_budget_${currentUser}`;
}
function getSpentKey() {
  return `dm_spent_${currentUser}`;
}
function getBudgetStartKey() {
  return `dm_budget_start_${currentUser}`;
}
function getBudgetStart() {
  return localStorage.getItem(getBudgetStartKey()) || '';
}

function getTotalSpent() {
  return parseFloat(localStorage.getItem(getSpentKey()) || '0');
}

function addToSpent(amount) {
  const current = getTotalSpent();
  localStorage.setItem(getSpentKey(), current + amount);
}

function removeFromSpent(amount) {
  const current = getTotalSpent();
  localStorage.setItem(getSpentKey(), Math.max(0, current - amount));
}

function loadBudget() {
  const saved = localStorage.getItem(getBudgetKey());
  currentBudget = saved ? parseFloat(saved) : 0;
  $('#budget-input').value = currentBudget || '';
  updateBudgetDisplay();
}

function saveBudget(val) {
  currentBudget = val;
  if (val > 0) {
    localStorage.setItem(getBudgetKey(), val);
  } else {
    localStorage.removeItem(getBudgetKey());
  }
  updateBudgetDisplay();
}

function updateBudgetDisplay() {
  const statusEl = $('#budget-status');
  if (!currentBudget || currentBudget <= 0) {
    statusEl.style.display = 'none';
    return;
  }
  statusEl.style.display = 'flex';
  const budgetStart = getBudgetStart();
  const activeTotal = expenses
    .filter(x => !budgetStart || x.date >= budgetStart)
    .reduce((s, x) => s + x.amount, 0);
  const deletedSpent = getTotalSpent();
  const total = activeTotal + deletedSpent;
  const remaining = currentBudget - total;
  const pct = Math.min((total / currentBudget) * 100, 100);

  $('#budget-remaining').textContent = fmtMoney(remaining);
  const bar = $('#budget-progress-bar');
  bar.style.width = pct + '%';

  // تلوين حسب النسبة
  const remainEl = $('#budget-remaining');
  if (remaining <= 0) {
    bar.className = 'over';
    remainEl.className = 'budget-over';
  } else if (pct >= 75) {
    bar.className = 'warn';
    remainEl.className = 'budget-warn';
  } else {
    bar.className = '';
    remainEl.className = '';
  }
}

$('#budget-save').addEventListener('click', () => {
  const val = parseFloat($('#budget-input').value) || 0;
  saveBudget(val);
  if (val > 0) {
    localStorage.setItem(getBudgetStartKey(), new Date().toISOString().slice(0, 10));
    localStorage.removeItem(getSpentKey());
    toast('تم حفظ الميزانية: ' + fmtMoney(val), 'success');
  } else {
    toast('لم يتم تحديد ميزانية');
  }
});

$('#budget-clear').addEventListener('click', () => {
  if (!currentBudget || currentBudget <= 0) return;
  if (!confirm('هل أنت متأكد من مسح الميزانية؟')) return;
  $('#budget-input').value = '';
  saveBudget(0);
  localStorage.removeItem(getSpentKey());
  localStorage.removeItem(getBudgetStartKey());
  toast('تم مسح الميزانية');
});

// ============================================================
// اتصل بنا
// ============================================================
const CONTACT_EMAIL = 'krain123ify@gmail.com';

$('#contact-btn').addEventListener('click', () => {
  const modal = $('#contact-modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  $('#contact-msg').focus();
});

function closeContactModal() {
  const modal = $('#contact-modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  $('#contact-form-msg').textContent = '';
  $('#contact-form-msg').className = 'form-msg';
}

$('#contact-close').addEventListener('click', closeContactModal);
$('#contact-modal .modal-backdrop').addEventListener('click', closeContactModal);

$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('#contact-msg').value.trim();
  const msgEl = $('#contact-form-msg');
  if (!msg) {
    msgEl.textContent = 'الرجاء كتابة ملاحظتك أولاً.';
    msgEl.className = 'form-msg error';
    return;
  }
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الإرسال...';
  msgEl.textContent = '';

  // إرسال عبر iframe مخفي (يتجاوز مشاكل CORS ولا يحتاج تفعيل JSON)
  const iframeName = 'contact-frame-' + Date.now();
  const iframe = document.createElement('iframe');
  iframe.name = iframeName;
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const form = document.createElement('form');
  form.action = `https://formsubmit.co/${CONTACT_EMAIL}`;
  form.method = 'POST';
  form.target = iframeName;
  form.style.display = 'none';

  const fields = {
    _subject: 'ملاحظة من تطبيق نفقات - ' + (currentUser || 'مجهول'),
    _captcha: 'false',
    _template: 'table',
    _next: 'about:blank',
    from_user: currentUser || 'مجهول',
    message: msg,
  };
  Object.entries(fields).forEach(([k, v]) => {
    const inp = document.createElement('input');
    inp.type = 'hidden';
    inp.name = k;
    inp.value = v;
    form.appendChild(inp);
  });

  document.body.appendChild(form);
  form.submit();

  // نعتبر الإرسال ناجحاً بعد فترة قصيرة (iframe لا يمكن قراءة محتواه بسبب CORS)
  setTimeout(() => {
    msgEl.textContent = 'تم إرسال ملاحظتك ✅ شكراً لك!';
    msgEl.className = 'form-msg success';
    $('#contact-msg').value = '';
    btn.disabled = false;
    btn.textContent = 'إرسال ✉️';
    setTimeout(() => {
      closeContactModal();
      form.remove();
      iframe.remove();
    }, 3500);
  }, 1500);
});

// ============================================================
// تشغيل
// ============================================================
applyTheme(localStorage.getItem(LS_THEME) || 'dark');

// ملء حقول تسجيل الدخول من البيانات المحفوظة
(function fillSavedCredentials() {
  const savedName = localStorage.getItem('dm_saved_username');
  const savedPass = localStorage.getItem('dm_saved_password');
  if (savedName) $('#login-form [name=username]').value = savedName;
  if (savedPass) $('#login-form [name=password]').value = savedPass;
})();

async function autoLogin() {
  const savedUser = localStorage.getItem('dm_session_user') || sessionStorage.getItem('dm_session_user');
  if (savedUser) {
    // التحقق من وجود المستخدم في تطبيق النفقات
    const user = await DB.getUserInApp(savedUser, 'نفقات');
    if (user) {
      currentUser = savedUser;
      enterApp();
    } else {
      // مسح الجلسة إذا لم يكن المستخدم موجوداً
      localStorage.removeItem('dm_session_user');
      sessionStorage.removeItem('dm_session_user');
      localStorage.removeItem('dm_remember');
    }
  }
}
// إذا Supabase جاهز مسبقاً، ادخل مباشرة
if (supabaseReady) {
  autoLogin();
}
