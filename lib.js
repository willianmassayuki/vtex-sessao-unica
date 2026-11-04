// Lógica compartilhada entre o service worker e o popup.

// Domínios VTEX onde o token do admin é reaproveitado.
// Para incluir outro domínio, adicione aqui E em host_permissions no manifest.json.
// "ds.vtexcrm.com.br" é o host do Master Data v1 (conta.ds.vtexcrm.com.br).
export const DOMAINS = ['myvtex.com', 'vtexcommercestable.com.br', 'ds.vtexcrm.com.br', 'vtexcrm.com.br'];

// Só o cookie de admin. Os cookies "VtexIdclientAutCookie_<conta>" são a sessão
// do comprador no storefront e ficam de fora de propósito: copiá-los logaria o
// dev como cliente na loja (e um login de cliente de teste viraria "sessão de admin").
export const COOKIE_NAMES = ['VtexIdclientAutCookie'];

// Margem para não aplicar um token que vai expirar no meio da navegação.
const SAFETY_MS = 60_000;

const SESSIONS_KEY = 'sessions';
const SETTINGS_DEFAULTS = { auto: true };

const HOST_RE = new RegExp(
  `^(?:([a-z0-9]+)--)?([a-z0-9]+)\\.(${DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|')})$`,
  'i'
);

// Filtro de URL usado pelos eventos de webNavigation.
export const NAV_FILTER = { url: DOMAINS.map((d) => ({ hostSuffix: `.${d}`, schemes: ['https'] })) };

// ---------- funções puras ----------

/** "ws--conta.myvtex.com" -> { workspace: "ws", account: "conta", domain: "myvtex.com" } */
export function parseHost(hostname) {
  const m = HOST_RE.exec(hostname || '');
  if (!m) return null;
  return { workspace: m[1] ? m[1].toLowerCase() : null, account: m[2].toLowerCase(), domain: m[3].toLowerCase() };
}

export function parseUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const h = parseHost(u.hostname);
    return h ? { ...h, host: u.hostname.toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Decodifica o payload de um JWT (sem validar assinatura: só lemos exp/sub). */
export function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function isValid(session, now = Date.now()) {
  return Boolean(session && session.token && session.exp * 1000 - SAFETY_MS > now);
}

/** Hosts onde a sessão de uma conta é aplicada: os três hosts base + os que já visitamos. */
export function hostsFor(account, session) {
  const base = DOMAINS.map((d) => `${account}.${d}`);
  return [...new Set([...base, ...(session?.hosts || [])])];
}

/**
 * Se a URL é a tela de login do admin, devolve para onde voltar depois.
 * Ex.: /_v/segment/admin-login/v1/login?returnUrl=%2Fadmin%2Fmasterdata
 */
export function loginReturnTarget(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/admin-login|\/admin\/site\/login/i.test(u.pathname)) return null;
  const ret = u.searchParams.get('returnUrl') || u.searchParams.get('ReturnUrl') || u.searchParams.get('redirectUrl');
  try {
    const target = ret ? new URL(ret, u.origin) : new URL('/admin', u.origin);
    // Nunca redireciona para fora dos domínios VTEX.
    return parseUrl(target.href) ? target.href : `${u.origin}/admin`;
  } catch {
    return `${u.origin}/admin`;
  }
}

// ---------- armazenamento ----------

// Fila simples para que leituras+escritas concorrentes no mesmo contexto não se atropelem
// (a VTEX costuma gravar vários cookies ao mesmo tempo no login).
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Tokens ficam em storage.session: só em memória, apagados ao fechar o navegador. */
export async function getSessions() {
  return (await chrome.storage.session.get(SESSIONS_KEY))[SESSIONS_KEY] || {};
}

function updateSessions(mutator) {
  return withLock(async () => {
    const all = await getSessions();
    const result = await mutator(all);
    await chrome.storage.session.set({ [SESSIONS_KEY]: all });
    return result;
  });
}

export async function getSettings() {
  return chrome.storage.local.get(SETTINGS_DEFAULTS);
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

/**
 * Guarda o token de um cookie de admin VTEX. Devolve { account, session, changed }
 * ou null se o cookie não interessa. `changed` = o token guardado mudou.
 */
export function captureCookie(cookie) {
  if (!cookie || !COOKIE_NAMES.includes(cookie.name)) return Promise.resolve(null);
  const host = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  const h = parseHost(host);
  if (!h) return Promise.resolve(null);
  const payload = decodeJwt(cookie.value);
  const exp = Number(payload?.exp);
  if (!exp || exp * 1000 <= Date.now()) return Promise.resolve(null);

  return updateSessions((all) => {
    // Limpa sessões expiradas de passagem.
    for (const [acc, s] of Object.entries(all)) if (!isValid(s)) delete all[acc];

    const cur = all[h.account];
    const hosts = [...new Set([...(cur?.hosts || []), host])];

    // Já temos este token, ou um mais novo que ainda vale: só registra o host.
    if (cur && (cur.token === cookie.value || cur.exp > exp)) {
      cur.hosts = hosts;
      return { account: h.account, session: cur, changed: false };
    }

    const session = {
      token: cookie.value,
      exp,
      user: payload.sub || payload.unique_name || payload.userId || null,
      hosts,
      capturedAt: Date.now(),
      capturedFrom: host,
    };
    all[h.account] = session;
    return { account: h.account, session, changed: true };
  });
}

/** Anota um host (ex.: um workspace novo) para receber o token quando ele for renovado. */
export function rememberHost(account, host) {
  return updateSessions((all) => {
    const s = all[account];
    if (s && !s.hosts.includes(host)) s.hosts.push(host);
  });
}

/**
 * Apaga o token guardado e o cookie de admin dos hosts conhecidos da conta
 * (senão a próxima varredura de cookies recapturaria a sessão).
 */
export function forgetAccount(account) {
  return updateSessions(async (all) => {
    for (const host of hostsFor(account, all[account])) {
      for (const name of COOKIE_NAMES) {
        try {
          await chrome.cookies.remove({ url: `https://${host}/`, name });
        } catch {
          // host sem o cookie
        }
      }
    }
    delete all[account];
  });
}

/** Lê os cookies de admin que já existem (ex.: extensão instalada com o admin já logado). */
export async function scanExisting() {
  const captured = [];
  for (const name of COOKIE_NAMES) {
    const cookies = await chrome.cookies.getAll({ name });
    for (const c of cookies) {
      const r = await captureCookie(c);
      if (r?.changed) captured.push(r);
    }
  }
  return captured;
}

// ---------- aplicação ----------

/** Grava o token no host. Devolve true se algum cookie foi alterado. */
export async function applyToHost(host, session) {
  const url = `https://${host}/`;
  let changed = false;
  for (const name of COOKIE_NAMES) {
    try {
      const cur = await chrome.cookies.get({ url, name });
      if (cur?.value === session.token) continue;
      await chrome.cookies.set({
        url,
        name,
        value: session.token,
        path: '/',
        secure: true,
        httpOnly: true,
        // no_restriction: o admin legado carrega páginas de vtexcommercestable em iframe.
        sameSite: 'no_restriction',
        expirationDate: session.exp,
      });
      changed = true;
    } catch (err) {
      console.warn(`[vtex-sessao-unica] falha ao gravar ${name} em ${host}`, err);
    }
  }
  return changed;
}

export async function applyToAllHosts(account, session) {
  for (const host of hostsFor(account, session)) await applyToHost(host, session);
}
