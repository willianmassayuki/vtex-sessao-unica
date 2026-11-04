import {
  NAV_FILTER,
  applyToAllHosts,
  applyToHost,
  captureCookie,
  getSessions,
  getSettings,
  isValid,
  loginReturnTarget,
  parseUrl,
  rememberHost,
  scanExisting,
} from './lib.js';

// tabId -> timestamp da última tentativa de sair da tela de login (evita loop).
const loginRetries = new Map();
const RETRY_WINDOW_MS = 15_000;

// 1) Captura: sempre que a VTEX grava um cookie de admin, guardamos o token da conta.
//    Roda nos dois modos; o modo só decide se o token é espalhado sozinho.
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed) return;
  onCookie(cookie).catch((err) => console.warn('[vtex-sessao-unica] captura', err));
});

async function onCookie(cookie) {
  const res = await captureCookie(cookie);
  if (!res?.changed) return;
  const { auto } = await getSettings();
  if (auto) await applyToAllHosts(res.account, res.session);
}

// 2) Modo automático: antes de abrir qualquer host VTEX da conta, grava o token nele.
chrome.webNavigation.onBeforeNavigate.addListener(async ({ url }) => {
  const target = parseUrl(url);
  if (!target) return;
  const { auto } = await getSettings();
  if (!auto) return;
  const session = (await getSessions())[target.account];
  if (!isValid(session)) return;
  await rememberHost(target.account, target.host);
  await applyToHost(target.host, session);
}, NAV_FILTER);

// 3) Rede de segurança: se mesmo assim a página caiu no login do admin (a requisição saiu
//    antes do cookie ser gravado), grava de novo e volta para o returnUrl. Uma vez por aba.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  const here = parseUrl(url);
  await updateBadge(tabId, here);

  const returnUrl = loginReturnTarget(url);
  if (!here || !returnUrl) return;
  const { auto } = await getSettings();
  if (!auto) return;

  const dest = parseUrl(returnUrl) || here;
  const session = (await getSessions())[dest.account];
  if (!isValid(session)) return;

  const last = loginRetries.get(tabId);
  if (last && Date.now() - last < RETRY_WINDOW_MS) return; // já tentamos: deixa o login aparecer
  loginRetries.set(tabId, Date.now());

  await applyToHost(here.host, session);
  await applyToHost(dest.host, session);
  await chrome.tabs.update(tabId, { url: returnUrl });
}, NAV_FILTER);

chrome.tabs.onRemoved.addListener((tabId) => loginRetries.delete(tabId));

// Badge "ON" na aba quando a conta dela tem sessão guardada.
async function updateBadge(tabId, here) {
  try {
    const session = here ? (await getSessions())[here.account] : null;
    const on = isValid(session);
    await chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
    if (on) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a7f37' });
  } catch {
    // aba fechada no meio do caminho
  }
}

// 4) Ao instalar/abrir o navegador, aproveita cookies de admin que já existam.
async function bootstrap() {
  const captured = await scanExisting();
  const { auto } = await getSettings();
  if (auto) for (const { account, session } of captured) await applyToAllHosts(account, session);
}
chrome.runtime.onInstalled.addListener(() => bootstrap());
chrome.runtime.onStartup.addListener(() => bootstrap());
