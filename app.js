// ============================================================
// نفقات - منطق التطبيق
// ============================================================

// ١. هوية التطبيق (ثابت) — مرتبط بنظام Space الموحد
const APP_ORIGIN = 'expenses';

// ⚙️ إعدادات Supabase
const SUPABASE_URL = 'https://tvbuvwjkojhqcxhyehfs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2YnV2d2prb2pocWN4aHllaGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MDE4MTUsImV4cCI6MjA5MjI3NzgxNX0.egwryYwKu_Bicl_koaYXaKGBoxz42c6k4VkMD9aZSWQ';

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
  window.addEventListener('load', () => {
    if (typeof autoLogin === 'function') autoLogin();
  });
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

// تجزئة كلمة السر
async function hash(txt) {
  try {
    if (crypto && crypto.subtle) {
      const enc = new TextEncoder().encode(txt);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { console.warn('crypto.subtle غير متاح، استخدام بديل'); }
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h) + txt.charCodeAt(i);
  return 'djb2_' + (h >>> 0).toString(16) + '_' + txt.length;
}

// ============ وظائف Supabase + LocalStorage ============
const DB = {
  isConnected() {
    return sb !== null && !useLocalStorage;
  },

  // ٤. تسجيل الدخول العالمي: بحث بدون فلتر created_from
  async getUser(userId) {
    if (this.isConnected()) {
      try {
        const { data } = await sb.from('users').select('*').eq('user_id', userId).limit(1);
        return (data && data.length) ? data[0] : null;
      } catch (e) { return null; }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      return users[userId] || null;
    }
  },

  // ٣. التحقق العالمي من وجود الاسم في أي تطبيق
  async getAnyUserOrigin(userId) {
    if (this.isConnected()) {
      try {
        const { data } = await sb.from('users').select('created_from').eq('user_id', userId).limit(1);
        return (data && data.length) ? data[0].created_from : null;
      } catch (e) { return null; }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      return users[userId] ? (users[userId].created_from || 'local') : null;
    }
  },

  // ٣. إنشاء مستخدم جديد - يكتب APP_ORIGIN في created_from تلقائياً
  // ملاحظة: لا يوجد عمود hint في جدول users (الأعمدة: user_id, pass_hash, created_from)
  async createUser(userId, passHash) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('users').insert({
          user_id: userId,
          pass_hash: passHash,
          created_from: APP_ORIGIN
        });
        if (error) {
          console.error('خطأ في إنشاء المستخدم:', error);
          return { success: false, error: error || {} };
        }
        return { success: true };
      } catch (e) {
        console.error(e);
        return { success: false, error: e || {} };
      }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      if (users[userId]) return { success: false, error: { code: 'duplicate' } };
      users[userId] = { password: passHash, created_from: APP_ORIGIN };
      localStorage.setItem(LS_USERS, JSON.stringify(users));
      return { success: true };
    }
  },

  // ٥. فصل البيانات: جلب نفقات المستخدم الحالي فقط بناءً على user_id
  async getExpenses(user_id) {
    if (this.isConnected()) {
      try {
        const { data, error } = await sb.from('expenses')
          .select('*')
          .eq('user_id', user_id)
          .is('deleted_at', null)
          .order('date', { ascending: false });
        if (error) { console.error(error); toast('خطأ في تحميل البيانات', 'error'); return []; }
        return data || [];
      } catch (e) { console.error(e); return []; }
    } else {
      const arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      return arr.filter(x => !x.deleted_at);
    }
  },

  async getTrash(user_id) {
    if (this.isConnected()) {
      try {
        const { data, error } = await sb.from('expenses')
          .select('*')
          .eq('user_id', user_id)
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false });
        if (error) { console.error(error); return []; }
        return data || [];
      } catch (e) { console.error(e); return []; }
    } else {
      const arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      return arr.filter(x => x.deleted_at);
    }
  },

  async restoreExpense(id, user_id) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: null }).eq('id', id).eq('user_id', user_id);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.map(x => x.id === id ? { ...x, deleted_at: null } : x);
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  async purgeExpense(id, user_id) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').delete().eq('id', id).eq('user_id', user_id);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.filter(x => x.id !== id);
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  async purgeOldTrash(user_id) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    if (this.isConnected()) {
      try {
        await sb.from('expenses').delete()
          .eq('user_id', user_id)
          .not('deleted_at', 'is', null)
          .lt('deleted_at', cutoff);
      } catch (e) { console.error(e); }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.filter(x => !x.deleted_at || x.deleted_at >= cutoff);
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
    }
  },

  // ٧. عند إضافة نفقة: id من نوع uuid يضمن سهولة الحذف من Supabase
  async addExpense(item) {
    if (this.isConnected()) {
      try {
        item.id = uid();
        item.created_from = APP_ORIGIN;
        const { error } = await sb.from('expenses').insert(item);
        if (error) console.error('خطأ في إضافة المصروف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(item.user_id)) || '[]');
      item.id = uid();
      item.created_from = APP_ORIGIN;
      arr.unshift(item);
      localStorage.setItem(LS_EXP(item.user_id), JSON.stringify(arr));
      return true;
    }
  },

  async updateExpense(id, item) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update(item).eq('id', id).eq('user_id', item.user_id);
        if (error) console.error('خطأ في تحديث المصروف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(item.user_id)) || '[]');
      arr = arr.map(x => x.id === id ? { ...item, id } : x);
      localStorage.setItem(LS_EXP(item.user_id), JSON.stringify(arr));
      return true;
    }
  },

  async deleteExpense(id, user_id) {
    const now = new Date().toISOString();
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: now }).eq('id', id).eq('user_id', user_id);
        if (error) console.error('خطأ في حذف المصروف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.map(x => x.id === id ? { ...x, deleted_at: now } : x);
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  async updatePassword(userId, newPassHash) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('users').update({ pass_hash: newPassHash }).eq('user_id', userId);
        if (error) { console.error('خطأ في تحديث كلمة السر:', error); return false; }
        return true;
      } catch (e) { console.error(e); return false; }
    } else {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || '{}');
      if (!users[userId]) return false;
      users[userId].password = newPassHash;
      localStorage.setItem(LS_USERS, JSON.stringify(users));
      return true;
    }
  },

  async deleteManyExpenses(ids, user_id) {
    const now = new Date().toISOString();
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: now }).in('id', ids).eq('user_id', user_id);
        if (error) console.error('خطأ في الحذف الجماعي:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.map(x => ids.includes(x.id) ? { ...x, deleted_at: now } : x);
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  async restoreManyExpenses(ids, user_id) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').update({ deleted_at: null }).in('id', ids).eq('user_id', user_id);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.map(x => ids.includes(x.id) ? { ...x, deleted_at: null } : x);
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  async purgeManyExpenses(ids, user_id) {
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses').delete().in('id', ids).eq('user_id', user_id);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.filter(x => !ids.includes(x.id));
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  async deleteAllExpenses(user_id) {
    const now = new Date().toISOString();
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('expenses')
          .update({ deleted_at: now })
          .eq('user_id', user_id)
          .is('deleted_at', null);
        if (error) console.error('خطأ في حذف جميع المصاريف:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      let arr = JSON.parse(localStorage.getItem(LS_EXP(user_id)) || '[]');
      arr = arr.map(x => x.deleted_at ? x : { ...x, deleted_at: now });
      localStorage.setItem(LS_EXP(user_id), JSON.stringify(arr));
      return true;
    }
  },

  // ===== الميزانية في السحابة =====
  // جدول budgets: user_id (نص، مفتاح أساسي)، budget، spent، budget_start (نص)، monthly (jsonb)
  async getBudgetData(user_id) {
    const fallback = { budget: 0, spent: 0, budget_start: '', monthly: {} };
    if (this.isConnected()) {
      try {
        const { data, error } = await sb.from('budgets').select('*').eq('user_id', user_id).limit(1);
        if (error) { console.error('خطأ في تحميل الميزانية:', error); return fallback; }
        if (data && data.length) {
          const r = data[0];
          return {
            budget: parseFloat(r.budget) || 0,
            spent: parseFloat(r.spent) || 0,
            budget_start: r.budget_start || '',
            monthly: r.monthly || {}
          };
        }
        return fallback;
      } catch (e) { console.error(e); return fallback; }
    } else {
      return {
        budget: parseFloat(localStorage.getItem(`dm_budget_${user_id}`) || '0') || 0,
        spent: parseFloat(localStorage.getItem(`dm_spent_${user_id}`) || '0') || 0,
        budget_start: localStorage.getItem(`dm_budget_start_${user_id}`) || '',
        monthly: JSON.parse(localStorage.getItem(`dm_monthly_${user_id}`) || '{}')
      };
    }
  },

  async saveBudgetData(user_id, state) {
    const row = {
      user_id,
      budget: state.budget || 0,
      spent: state.spent || 0,
      budget_start: state.budget_start || '',
      monthly: state.monthly || {},
      created_from: APP_ORIGIN
    };
    if (this.isConnected()) {
      try {
        const { error } = await sb.from('budgets').upsert(row, { onConflict: 'user_id' });
        if (error) console.error('خطأ في حفظ الميزانية:', error);
        return !error;
      } catch (e) { console.error(e); return false; }
    } else {
      localStorage.setItem(`dm_budget_${user_id}`, row.budget);
      localStorage.setItem(`dm_spent_${user_id}`, row.spent);
      localStorage.setItem(`dm_budget_start_${user_id}`, row.budget_start);
      localStorage.setItem(`dm_monthly_${user_id}`, JSON.stringify(row.monthly));
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

// ٣. تسجيل حساب جديد مع منع التكرار العالمي
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const d = Object.fromEntries(new FormData(f));
    const user_id = d.username.trim().toLowerCase();
    if (user_id.length < 3) return formMsg(f, 'اسم المستخدم قصير جداً.', 'error');
    if (d.password !== d.password2) return formMsg(f, 'كلمتا السر غير متطابقتين.', 'error');

    formMsg(f, '⏳ جاري الإنشاء...', 'info');

    // التحقق العالمي: الاسم يجب أن يكون غير موجود في أي تطبيق من المنظومة
    const existingOrigin = await DB.getAnyUserOrigin(user_id);
    if (existingOrigin) {
      const suggestions = [user_id + '123', user_id + '_2026', user_id + '_sarf'];
      return formMsg(f, `هذا الاسم محجوز. جرب: ${suggestions.join('، ')}`, 'error');
    }

    // إنشاء المستخدم - يُكتب APP_ORIGIN تلقائياً في created_from
    const result = await DB.createUser(user_id, await hash(d.password));
    if (!result.success) {
      if (result.error?.code === '23505' || result.error?.code === 'duplicate' || result.error?.message?.includes('duplicate')) {
        return formMsg(f, 'هذا الاسم محجوز.', 'error');
      }
      return formMsg(f, 'حدث خطأ أثناء الإنشاء: ' + (result.error?.message || 'غير معروف'), 'error');
    }

    formMsg(f, 'تم إنشاء الحساب! جاري تسجيل الدخول...', 'success');
    localStorage.setItem('dm_session_user', user_id);
    localStorage.setItem('dm_remember', '1');
    setTimeout(enterApp, 700);
  } catch (err) {
    console.error(err);
    formMsg(f, 'خطأ غير متوقع: ' + err.message, 'error');
  }
});

// ٤. تسجيل دخول عالمي: يقبل أي مستخدم في جدول users بغض النظر عن created_from
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const d = Object.fromEntries(new FormData(f));
    const user_id = d.username.trim().toLowerCase();

    formMsg(f, '⏳ جاري تسجيل الدخول...', 'info');

    const user = await DB.getUser(user_id);
    if (!user) return formMsg(f, 'اسم المستخدم غير مسجّل. سجّل حساباً أولاً.', 'error');

    const pwdHash = await hash(d.password);
    const storedHash = user.pass_hash || user.password;
    if (storedHash !== pwdHash) return formMsg(f, 'كلمة السر غير صحيحة.', 'error');

    if (d.remember) {
      localStorage.setItem('dm_session_user', user_id);
      localStorage.setItem('dm_remember', '1');
      localStorage.setItem('dm_saved_user_id', user_id);
      localStorage.setItem('dm_saved_password', d.password);
    } else {
      sessionStorage.setItem('dm_session_user', user_id);
      localStorage.removeItem('dm_saved_user_id');
      localStorage.removeItem('dm_saved_password');
    }
    formMsg(f, 'مرحباً بعودتك!', 'success');
    setTimeout(enterApp, 400);
  } catch (err) {
    console.error(err);
    formMsg(f, 'خطأ غير متوقع: ' + err.message, 'error');
  }
});

// إعادة تعيين كلمة السر (التحقق من وجود الحساب ثم إظهار نموذج التغيير)
$('#hint-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const user_id = new FormData(f).get('username').trim().toLowerCase();
    const user = await DB.getUser(user_id);
    if (!user) return formMsg(f, 'اسم المستخدم غير مسجّل. سجّل حساباً أولاً.', 'error');
    formMsg(f, '✅ تم التحقق. يمكنك تغيير كلمة السر الآن.', 'success');
    const section = $('#change-pwd-section');
    section.style.display = 'block';
    section.dataset.user_id = user_id;
    $('#change-pwd-msg').textContent = '';
    $('#change-pwd-msg').className = 'form-msg';
  } catch (err) {
    console.error(err);
    formMsg(f, 'خطأ: ' + err.message, 'error');
  }
});

// تغيير كلمة السر من شاشة المصادقة
$('#do-change-pwd-btn').addEventListener('click', async () => {
  const section = $('#change-pwd-section');
  const user_id = section.dataset.user_id;
  const msgEl = $('#change-pwd-msg');
  const f = $('#hint-form');

  const oldPwd = f.querySelector('[name=old_password]').value;
  const newPwd = f.querySelector('[name=new_password]').value;
  const newPwd2 = f.querySelector('[name=new_password2]').value;

  msgEl.textContent = '';
  msgEl.className = 'form-msg';

  if (!oldPwd) { msgEl.textContent = 'أدخل كلمة السر الحالية.'; msgEl.className = 'form-msg error'; return; }
  if (!newPwd || newPwd.length < 4) { msgEl.textContent = 'كلمة السر الجديدة قصيرة (4 أحرف على الأقل).'; msgEl.className = 'form-msg error'; return; }
  if (newPwd !== newPwd2) { msgEl.textContent = 'كلمتا السر الجديدة غير متطابقتين.'; msgEl.className = 'form-msg error'; return; }

  msgEl.textContent = '⏳ جاري التحقق...'; msgEl.className = 'form-msg info';

  const user = await DB.getUser(user_id);
  if (!user) { msgEl.textContent = 'خطأ: لم يُعثر على الحساب.'; msgEl.className = 'form-msg error'; return; }

  const oldHash = await hash(oldPwd);
  const storedHash = user.pass_hash || user.password;
  if (storedHash !== oldHash) { msgEl.textContent = 'كلمة السر الحالية غير صحيحة.'; msgEl.className = 'form-msg error'; return; }

  const newHash = await hash(newPwd);
  const ok = await DB.updatePassword(user_id, newHash);
  if (!ok) { msgEl.textContent = 'حدث خطأ أثناء التحديث.'; msgEl.className = 'form-msg error'; return; }

  if (localStorage.getItem('dm_saved_user_id') === user_id) {
    localStorage.setItem('dm_saved_password', newPwd);
  }

  msgEl.textContent = '✅ تم تغيير كلمة السر بنجاح! يمكنك تسجيل الدخول الآن.';
  msgEl.className = 'form-msg success';
  f.querySelector('[name=old_password]').value = '';
  f.querySelector('[name=new_password]').value = '';
  f.querySelector('[name=new_password2]').value = '';
  setTimeout(() => { section.style.display = 'none'; switchTab('login'); }, 2500);
});

// ============================================================
// التطبيق
// ============================================================
let currentUser = null;
let expenses = [];
let editingId = null;
let currentBudget = 0;
// حالة الميزانية المحمّلة من السحابة
let budgetState = { budget: 0, spent: 0, budget_start: '', monthly: {} };
// حفظ الحالة في السحابة (إطلاق دون انتظار)
function persistBudget() {
  if (currentUser) DB.saveBudgetData(currentUser, budgetState);
}

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
  $('#trash-select-all').checked = false;
  $('#trash-select-all').indeterminate = false;
  updateTrashSelectedButtons();

  trash.forEach(x => {
    const d = daysLeft(x.deleted_at);
    const warn = d <= 7 ? 'warn' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="trash-check" data-id="${x.id}" /></td>
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

  tbody.querySelectorAll('.trash-check').forEach(cb => {
    cb.addEventListener('change', updateTrashSelectedButtons);
  });
}

function updateTrashSelectedButtons() {
  const checkedCount = $$('.trash-check:checked').length;
  const restoreBtn = $('#trash-restore-selected');
  const purgeBtn = $('#trash-purge-selected');
  const purgeAllBtn = $('#trash-purge');

  if (checkedCount > 0) {
    restoreBtn.style.display = 'inline-block';
    restoreBtn.textContent = `♻️ استرجاع (${checkedCount})`;
    purgeBtn.style.display = 'inline-block';
    purgeBtn.textContent = `❌ حذف (${checkedCount})`;
    purgeAllBtn.style.display = 'none';
  } else {
    restoreBtn.style.display = 'none';
    purgeBtn.style.display = 'none';
    purgeAllBtn.style.display = 'inline-block';
  }

  const allCheckboxes = $$('.trash-check');
  const selectAll = $('#trash-select-all');
  if (allCheckboxes.length > 0) {
    selectAll.checked = checkedCount === allCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
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
  const ids = trash.map(x => x.id);
  const ok = await DB.purgeManyExpenses(ids, currentUser);
  if (!ok) return toast('خطأ في الحذف', 'error');
  toast('تم إفراغ السلة', 'error');
  await renderTrash();
  await updateTrashBadge();
});

$('#trash-select-all').addEventListener('change', (e) => {
  const isChecked = e.target.checked;
  $$('.trash-check').forEach(cb => cb.checked = isChecked);
  updateTrashSelectedButtons();
});

$('#trash-restore-selected').addEventListener('click', async () => {
  const selectedIds = [...$$('.trash-check:checked')].map(cb => cb.dataset.id);
  if (selectedIds.length === 0) return toast('لم تختر أي عنصر', 'error');
  if (!confirm(`هل أنت متأكد من استرجاع ${selectedIds.length} عنصر/عناصر؟`)) return;

  const trashItems = await DB.getTrash(currentUser);
  const restoredAmount = trashItems
    .filter(x => selectedIds.includes(x.id))
    .reduce((s, x) => s + x.amount, 0);

  const ok = await DB.restoreManyExpenses(selectedIds, currentUser);
  if (!ok) return toast('خطأ في الاسترجاع', 'error');

  if (currentBudget > 0 && restoredAmount > 0) removeFromSpent(restoredAmount);

  toast(`تم استرجاع ${selectedIds.length} عنصر`, 'success');
  $('#trash-select-all').checked = false;
  $('#trash-select-all').indeterminate = false;
  await loadExpenses();
  await renderTrash();
  await updateTrashBadge();
});

$('#trash-purge-selected').addEventListener('click', async () => {
  const selectedIds = [...$$('.trash-check:checked')].map(cb => cb.dataset.id);
  if (selectedIds.length === 0) return toast('لم تختر أي عنصر', 'error');
  if (!confirm(`حذف ${selectedIds.length} عنصر نهائياً؟ لا يمكن التراجع.`)) return;

  const ok = await DB.purgeManyExpenses(selectedIds, currentUser);
  if (!ok) return toast('خطأ في الحذف', 'error');
  toast(`تم حذف ${selectedIds.length} عنصر نهائياً`, 'error');
  $('#trash-select-all').checked = false;
  $('#trash-select-all').indeterminate = false;
  await renderTrash();
  await updateTrashBadge();
});

async function enterApp() {
  currentUser = localStorage.getItem('dm_session_user') || sessionStorage.getItem('dm_session_user');
  if (!currentUser) return;
  $('#auth-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  $('#user-label').textContent = currentUser;
  await DB.purgeOldTrash(currentUser);
  await loadBudget();
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

$('#expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const d = Object.fromEntries(new FormData(f));
  const cat = d.category === '__custom__' ? (d.custom_category?.trim() || 'أخرى') : d.category;

  const item = {
    user_id: currentUser,
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
  $('#select-all').checked = false;
  $('#select-all').indeterminate = false;
  await loadExpenses();
});

function updateDeleteSelectedButton() {
  const checkedCount = $$('.row-check:checked').length;
  const btn = $('#delete-selected');
  const clearAllBtn = $('#clear-all');
  if (checkedCount > 0) {
    btn.style.display = 'inline-block';
    btn.textContent = `🗑️ حذف (${checkedCount})`;
    clearAllBtn.style.display = 'none';
  } else {
    btn.style.display = 'none';
    clearAllBtn.style.display = 'inline-block';
  }
  const allCheckboxes = $$('.row-check');
  const selectAll = $('#select-all');
  if (allCheckboxes.length > 0) {
    selectAll.checked = checkedCount === allCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
}

$('#select-all').addEventListener('change', (e) => {
  const isChecked = e.target.checked;
  $$('.row-check').forEach(cb => cb.checked = isChecked);
  updateDeleteSelectedButton();
});

$('#delete-selected').addEventListener('click', async () => {
  const selectedIds = [...$$('.row-check:checked')].map(cb => cb.dataset.id);
  if (selectedIds.length === 0) return toast('لم تختر أي عنصر', 'error');
  if (!confirm(`هل أنت متأكد من حذف ${selectedIds.length} عنصر/عناصر؟`)) return;

  if (currentBudget > 0) {
    const selectedItems = expenses.filter(x => selectedIds.includes(x.id));
    const totalToRemove = selectedItems.reduce((s, x) => s + x.amount, 0);
    addToSpent(totalToRemove);
  }

  const ok = await DB.deleteManyExpenses(selectedIds, currentUser);
  if (!ok) return toast('خطأ في الحذف', 'error');
  toast(`تم حذف ${selectedIds.length} عنصر`, 'success');
  $('#select-all').checked = false;
  $('#select-all').indeterminate = false;
  await loadExpenses();
});

$('#export-btn').addEventListener('click', () => {
  if (!expenses.length) return toast('لا توجد بيانات للتصدير');
  const rows = [['التاريخ','الوصف','التصنيف','المبلغ','ملاحظات']];
  expenses.forEach(x => rows.push([x.date, x.title, x.category, x.amount, x.note || '']));
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `expenses_${currentUser}_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast('تم التصدير بنجاح', 'success');
});

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
      <td><input type="checkbox" class="row-check" data-id="${x.id}" /></td>
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

  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', updateDeleteSelectedButton);
  });

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

  updateBudgetDisplay();

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
  const currentMonth = now.getMonth();
  const currentYM = now.toISOString().slice(0, 7);

  const byMonth = {};
  expenses.forEach(x => {
    const ym = x.date.slice(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { items: [], total: 0, cats: {} };
    byMonth[ym].items.push(x);
    byMonth[ym].total += x.amount;
    byMonth[ym].cats[x.category] = (byMonth[ym].cats[x.category] || 0) + x.amount;
  });

  const years = new Set([currentYear]);
  Object.keys(byMonth).forEach(ym => years.add(parseInt(ym.split('-')[0])));
  const sortedYears = [...years].sort((a, b) => b - a);

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

    const maxMonth = (year === currentYear) ? currentMonth : 11;

    for (let m = 0; m <= maxMonth; m++) {
      const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
      const data = byMonth[ym] || null;
      const monthName = MONTH_NAMES[m];
      const isCurrent = ym === currentYM;
      const total = data ? data.total : 0;
      const count = data ? data.items.length : 0;

      let topName = '—';
      if (data) {
        const topCat = Object.entries(data.cats).sort((a, b) => b[1] - a[1]);
        topName = topCat[0] ? topCat[0][0] : '—';
      }

      const mBudget = parseFloat(budgetState.monthly[ym] || 0) || 0;
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

  const currentCard = grid.querySelector('.month-card.current');
  if (currentCard) {
    setTimeout(() => currentCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }), 200);
  }
}

$('#months-grid').addEventListener('change', (e) => {
  const inp = e.target.closest('.month-budget-input');
  if (!inp) return;
  const ym = inp.dataset.ym;
  const val = parseFloat(inp.value) || 0;
  if (val > 0) {
    budgetState.monthly[ym] = val;
    toast('تم حفظ ميزانية ' + MONTH_NAMES[parseInt(ym.split('-')[1]) - 1] + ': ' + fmtMoney(val), 'success');
  } else {
    delete budgetState.monthly[ym];
  }
  persistBudget();
  renderMonths();
});

$('#months-toggle').addEventListener('click', () => {
  showAllMonths = !showAllMonths;
  renderMonths();
});

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
const SHARE_LINK = 'https://www.appcreator24.com/app4008813-n0rd4w';
const BROWSER_LINK = 'https://expensese.netlify.app/';

$('#share-btn').addEventListener('click', async () => {
  if (!SHARE_LINK || SHARE_LINK === 'ضع_الرابط_هنا') {
    toast('لم يتم تحديد رابط المشاركة بعد', 'error');
    return;
  }
  let shareText = '📒 نفقات – إدارة مصاريف المنزل\n\n';
  shareText += '📱 للتطبيق apk:\n' + SHARE_LINK + '\n\n';
  if (BROWSER_LINK && BROWSER_LINK !== 'ضع_رابط_المتصفح_هنا') {
    shareText += '🌐 اضغط للانتقال إلى المتصفح:\n' + BROWSER_LINK;
  }
  const shareData = { title: 'نفقات – إدارة مصاريف المنزل', text: shareText, url: SHARE_LINK };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (e) { /* المستخدم ألغى */ }
  } else {
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
      }).catch(() => { prompt('انسخ الرابط:', SHARE_LINK); });
    });
  }
});

// ============================================================
// الميزانية
// ============================================================
function getBudgetStart() { return budgetState.budget_start || ''; }
function getTotalSpent() { return budgetState.spent || 0; }
function addToSpent(amount) { budgetState.spent = getTotalSpent() + amount; persistBudget(); }
function removeFromSpent(amount) { budgetState.spent = Math.max(0, getTotalSpent() - amount); persistBudget(); }

async function loadBudget() {
  budgetState = await DB.getBudgetData(currentUser);
  currentBudget = budgetState.budget || 0;
  $('#budget-input').value = currentBudget || '';
  updateBudgetDisplay();
}

function saveBudget(val) {
  currentBudget = val;
  budgetState.budget = val > 0 ? val : 0;
  persistBudget();
  updateBudgetDisplay();
}

function updateBudgetDisplay() {
  const statusEl = $('#budget-status');
  if (!currentBudget || currentBudget <= 0) { statusEl.style.display = 'none'; return; }
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
  if (val > 0) {
    budgetState.budget_start = new Date().toISOString().slice(0, 10);
    budgetState.spent = 0;
    saveBudget(val);
    toast('تم حفظ الميزانية: ' + fmtMoney(val), 'success');
  } else {
    saveBudget(0);
    toast('لم يتم تحديد ميزانية');
  }
});

$('#budget-clear').addEventListener('click', () => {
  if (!currentBudget || currentBudget <= 0) return;
  if (!confirm('هل أنت متأكد من مسح الميزانية؟')) return;
  $('#budget-input').value = '';
  budgetState.spent = 0;
  budgetState.budget_start = '';
  saveBudget(0);
  toast('تم مسح الميزانية');
});

// إيداع مبلغ: يزيد الميزانية (والمتبقي) بالمبلغ المُدخل
$('#budget-deposit').addEventListener('click', () => {
  const inp = $('#budget-deposit-input');
  const amt = parseFloat(inp.value) || 0;
  if (amt <= 0) return toast('أدخل مبلغ الإيداع أولاً', 'error');
  budgetState.budget = (parseFloat(budgetState.budget) || 0) + amt;
  if (!budgetState.budget_start) {
    budgetState.budget_start = new Date().toISOString().slice(0, 10);
  }
  currentBudget = budgetState.budget;
  $('#budget-input').value = currentBudget;
  persistBudget();
  updateBudgetDisplay();
  inp.value = '';
  toast('تم إيداع ' + fmtMoney(amt) + ' ✅ الميزانية الآن ' + fmtMoney(currentBudget), 'success');
});

// ============================================================
// تغيير كلمة السر (داخل التطبيق)
// ============================================================
$('#change-pwd-btn').addEventListener('click', () => {
  const modal = $('#inapp-pwd-modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  $('#inapp-pwd-msg').textContent = '';
  $('#inapp-pwd-msg').className = 'form-msg';
  $('#inapp-pwd-form').reset();
});

function closeInappPwdModal() {
  const modal = $('#inapp-pwd-modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  $('#inapp-pwd-form').reset();
  $('#inapp-pwd-msg').textContent = '';
  $('#inapp-pwd-msg').className = 'form-msg';
}

$('#inapp-pwd-close').addEventListener('click', closeInappPwdModal);
$('#inapp-pwd-modal .modal-backdrop').addEventListener('click', closeInappPwdModal);

$('#inapp-pwd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msgEl = $('#inapp-pwd-msg');
  const d = Object.fromEntries(new FormData(f));

  msgEl.textContent = '';
  msgEl.className = 'form-msg';

  if (!d.old_password) { msgEl.textContent = 'أدخل كلمة السر الحالية.'; msgEl.className = 'form-msg error'; return; }
  if (!d.new_password || d.new_password.length < 4) { msgEl.textContent = 'كلمة السر الجديدة قصيرة جداً (4 أحرف على الأقل).'; msgEl.className = 'form-msg error'; return; }
  if (d.new_password !== d.new_password2) { msgEl.textContent = 'كلمتا السر الجديدة غير متطابقتين.'; msgEl.className = 'form-msg error'; return; }
  if (d.old_password === d.new_password) { msgEl.textContent = 'كلمة السر الجديدة مطابقة للحالية، اختر كلمة مختلفة.'; msgEl.className = 'form-msg error'; return; }

  msgEl.textContent = '⏳ جاري التحقق...'; msgEl.className = 'form-msg info';

  const user = await DB.getUser(currentUser);
  if (!user) { msgEl.textContent = 'خطأ: لم يُعثر على الحساب.'; msgEl.className = 'form-msg error'; return; }

  const oldHash = await hash(d.old_password);
  const storedHash = user.pass_hash || user.password;
  if (storedHash !== oldHash) { msgEl.textContent = 'كلمة السر الحالية غير صحيحة.'; msgEl.className = 'form-msg error'; return; }

  const newHash = await hash(d.new_password);
  const ok = await DB.updatePassword(currentUser, newHash);
  if (!ok) { msgEl.textContent = 'حدث خطأ أثناء الحفظ، حاول مرة أخرى.'; msgEl.className = 'form-msg error'; return; }

  if (localStorage.getItem('dm_saved_user_id') === currentUser) {
    localStorage.setItem('dm_saved_password', d.new_password);
  }

  msgEl.textContent = '✅ تم تغيير كلمة السر بنجاح!';
  msgEl.className = 'form-msg success';
  toast('تم تغيير كلمة السر ✅', 'success');
  setTimeout(closeInappPwdModal, 2000);
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
    inp.type = 'hidden'; inp.name = k; inp.value = v;
    form.appendChild(inp);
  });

  document.body.appendChild(form);
  form.submit();

  setTimeout(() => {
    msgEl.textContent = 'تم إرسال ملاحظتك ✅ شكراً لك!';
    msgEl.className = 'form-msg success';
    $('#contact-msg').value = '';
    btn.disabled = false;
    btn.textContent = 'إرسال ✉️';
    setTimeout(() => { closeContactModal(); form.remove(); iframe.remove(); }, 3500);
  }, 1500);
});

// ============================================================
// تشغيل
// ============================================================
applyTheme(localStorage.getItem(LS_THEME) || 'dark');

(function fillSavedCredentials() {
  const savedUserId = localStorage.getItem('dm_saved_user_id');
  const savedPass = localStorage.getItem('dm_saved_password');
  if (savedUserId) $('#login-form [name=username]').value = savedUserId;
  if (savedPass) $('#login-form [name=password]').value = savedPass;
})();

async function autoLogin() {
  const savedUser = localStorage.getItem('dm_session_user') || sessionStorage.getItem('dm_session_user');
  if (savedUser) {
    // تسجيل دخول تلقائي عالمي بدون فلتر created_from
    const user = await DB.getUser(savedUser);
    if (user) {
      currentUser = savedUser;
      enterApp();
    } else {
      localStorage.removeItem('dm_session_user');
      sessionStorage.removeItem('dm_session_user');
      localStorage.removeItem('dm_remember');
    }
  }
}

if (supabaseReady) {
  autoLogin();
}
