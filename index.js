import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 加载 .env 环境变量
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

const SECRET = process.env.JWT_SECRET || 'change-me-in-prod';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// 初始化 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

async function getPersonalUser() {
  const { data: positionOwners, error: ownerError } = await supabase
    .from('positions')
    .select('uid')
    .limit(1000);
  if (ownerError) throw ownerError;
  const ownerCounts = new Map();
  for (const row of positionOwners || []) {
    if (!row.uid) continue;
    ownerCounts.set(row.uid, (ownerCounts.get(row.uid) || 0) + 1);
  }
  const primaryUid = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (primaryUid) return { id: primaryUid, email: 'personal@fundpilot.local' };

  const { data: users, error } = await supabase
    .from('users')
    .select('id,email')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  if (users && users.length > 0) return users[0];

  const user = { id: nanoid(), email: 'personal@fundpilot.local', password: nanoid(18) };
  const { error: insertError } = await supabase.from('users').insert([user]);
  if (insertError) throw insertError;
  return user;
}

async function personalAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
      return next();
    } catch {
      // 个人免登录模式下忽略过期/错误 token，继续使用默认个人账户。
    }
  }

  try {
    const user = await getPersonalUser();
    req.user = { uid: user.id, email: user.email };
    return next();
  } catch (e) {
    return res.status(500).json({ error: e.message || 'personal user unavailable' });
  }
}

app.get('/health', (_, res) => res.json({ ok: true }));

function parseJsonp(text) {
  const s = text.indexOf('(');
  const e = text.lastIndexOf(')');
  if (s < 0 || e < 0 || e <= s) throw new Error('invalid jsonp');
  return JSON.parse(text.slice(s + 1, e));
}

function normalizeFundgzData(data, code) {
  if (!data || typeof data !== 'object') return null;
  const hasPrice = Number(data.gsz) > 0 || Number(data.dwjz) > 0;
  const hasName = typeof data.name === 'string' && data.name.trim().length > 0;
  if (!hasPrice && !hasName) return null;
  return {
    ...data,
    fundcode: data.fundcode || code,
    source: 'fundgz'
  };
}

async function fetchFundgzEstimate(code) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://fund.eastmoney.com/'
      }
    });
    if (!r.ok) return null;
    const t = await r.text();
    return normalizeFundgzData(parseJsonp(t), code);
  } finally {
    clearTimeout(timer);
  }
}

function extractVar(text, varName) {
  const re = new RegExp(`(?:var|let|const)\\s+${varName}\\s*=\\s*(.+?);`);
  const m = text.match(re);
  return m ? m[1] : '';
}

function parsePingzhongData(text, code) {
  const rawName = extractVar(text, 'fS_name');
  const name = rawName ? rawName.replace(/^['\"]|['\"]$/g, '') : '';
  const trendRaw = extractVar(text, 'Data_netWorthTrend');
  let trend = [];
  if (trendRaw) {
    try { trend = JSON.parse(trendRaw); } catch {}
  }
  const last = Array.isArray(trend) && trend.length ? trend[trend.length - 1] : null;
  const nav = Number(last?.y || 0);
  const ts = Number(last?.x || 0);
  const iso = ts > 0 ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '';
  if (!(nav > 0) && !name) return null;
  return {
    fundcode: code,
    name: name || code,
    jzrq: iso ? iso.slice(0, 10) : '',
    dwjz: nav > 0 ? String(nav) : '0',
    gsz: nav > 0 ? String(nav) : '0',
    gszzl: '0.00',
    gztime: iso,
    source: 'eastmoney-pingzhongdata'
  };
}

async function fetchEastmoneyLsjzLatest(code) {
  const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 OpenClaw Fund Tool', 'Referer': 'https://fund.eastmoney.com/' } });
  if (!r.ok) return null;
  const j = await r.json();
  const row = j?.Data?.LSJZList?.[0];
  if (!row) return null;
  const nav = Number(row.DWJZ || 0);
  if (!(nav > 0)) return null;
  return {
    fundcode: code,
    name: code,
    jzrq: row.FSRQ || '',
    dwjz: String(nav),
    gsz: String(nav),
    gszzl: String(Number(row.JZZZL || 0).toFixed(2)),
    gztime: row.FSRQ ? `${row.FSRQ} 15:00:00` : '',
    source: 'eastmoney-lsjz'
  };
}

app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required' });
    const r = await fetch(`https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(q)}`);
    if (!r.ok) return res.status(502).json({ error: 'search upstream failed' });
    const data = await r.json();
    const list = (data?.Datas || []).slice(0, 12).map(item => ({ code: item.CODE, name: item.NAME, type: item?.FundBaseInfo?.FTYPE || '' }));
    return res.json({ list });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'search failed' });
  }
});

app.get('/api/estimate', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid code' });
    try {
      const data = await fetchFundgzEstimate(code);
      if (data) return res.json(data);
    } catch {}
    try {
      const dataLsjz = await fetchEastmoneyLsjzLatest(code);
      if (dataLsjz) {
        try {
          const r2 = await fetch(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
          if (r2.ok) {
            const t2 = await r2.text();
            const d2 = parsePingzhongData(t2, code);
            if (d2?.name) dataLsjz.name = d2.name;
          }
        } catch {}
        return res.json(dataLsjz);
      }
    } catch {}
    try {
      const r2 = await fetch(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
      if (r2.ok) {
        const t2 = await r2.text();
        const data2 = parsePingzhongData(t2, code);
        if (data2) return res.json(data2);
      }
    } catch {}
    return res.status(404).json({ error: 'fund data unavailable' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'estimate failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email/password required' });
  
  // 查询用户
  let { data: users, error } = await supabase.from('users').select('*').eq('email', email);
  if (error) return res.status(500).json({ error: error.message });
  
  let user = users && users.length > 0 ? users[0] : null;
  if (!user) {
    user = { id: nanoid(), email, password };
    const { error: insertError } = await supabase.from('users').insert([user]);
    if (insertError) return res.status(500).json({ error: insertError.message });
  } else {
    if (user.password !== password) return res.status(401).json({ error: 'invalid credentials' });
  }
  
  const token = jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: '30d' });
  res.json({ token });
});

app.get('/positions', personalAuth, async (req, res) => {
  const { data: list, error } = await supabase
    .from('positions')
    .select('*')
    .eq('uid', req.user.uid)
    .order('order', { ascending: true })
    .order('updatedAt', { ascending: true });
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ list: list || [] });
});

app.post('/positions', personalAuth, async (req, res) => {
  const { code, name, shares = 0, cost = 0, dcaAmount = 0, dcaCycle = '', dcaLastAt = '', group = '', order } = req.body || {};
  if (!/^\d{6}$/.test(code || '')) return res.status(400).json({ error: 'invalid code' });
  
  const { data: userRows } = await supabase.from('positions').select('order').eq('uid', req.user.uid);
  const maxOrder = (userRows || []).reduce((m, r) => Math.max(m, Number(r.order || 0)), 0);
  
  const row = {
    id: nanoid(),
    uid: req.user.uid,
    code,
    name: name || code,
    group: String(group || ''),
    order: Number.isFinite(Number(order)) ? Number(order) : (maxOrder + 1),
    shares: Number(shares),
    cost: Number(cost),
    dcaAmount: Number(dcaAmount || 0),
    dcaCycle: String(dcaCycle || ''),
    dcaLastAt: String(dcaLastAt || ''),
    updatedAt: Date.now()
  };
  
  const { error } = await supabase.from('positions').insert([row]);
  if (error) return res.status(500).json({ error: error.message });
  res.json(row);
});

app.put('/positions/:id', personalAuth, async (req, res) => {
  const { shares, cost, name, dcaAmount, dcaCycle, dcaLastAt, group, order } = req.body || {};
  const updates = { updatedAt: Date.now() };
  if (shares !== undefined) updates.shares = Number(shares);
  if (cost !== undefined) updates.cost = Number(cost);
  if (name !== undefined) updates.name = name;
  if (group !== undefined) updates.group = String(group || '');
  if (order !== undefined) updates.order = Number(order || 0);
  if (dcaAmount !== undefined) updates.dcaAmount = Number(dcaAmount || 0);
  if (dcaCycle !== undefined) updates.dcaCycle = String(dcaCycle || '');
  if (dcaLastAt !== undefined) updates.dcaLastAt = String(dcaLastAt || '');

  const { data, error } = await supabase
    .from('positions')
    .update(updates)
    .eq('id', req.params.id)
    .eq('uid', req.user.uid)
    .select();
    
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(data[0]);
});

app.delete('/positions/:id', personalAuth, async (req, res) => {
  const { error } = await supabase
    .from('positions')
    .delete()
    .eq('id', req.params.id)
    .eq('uid', req.user.uid);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(port, () => console.log('fund-sync-server on', port));
}

export default app;
