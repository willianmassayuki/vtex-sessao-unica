import {
  applyToAllHosts,
  applyToHost,
  forgetAccount,
  getSessions,
  getSettings,
  isValid,
  loginReturnTarget,
  parseUrl,
  rememberHost,
  scanExisting,
  setSettings,
} from './lib.js';

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function formatExp(exp) {
  const ms = exp * 1000 - Date.now();
  if (ms <= 0) return 'expirada';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const at = new Date(exp * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `expira em ${h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`} (${at})`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function openWithSession(url, account, session) {
  const target = parseUrl(url);
  if (target && isValid(session)) await applyToHost(target.host, session);
  await chrome.tabs.create({ url });
  window.close();
}

async function applyHere(tab, here, account, session) {
  await rememberHost(account, here.host);
  await applyToHost(here.host, session);
  const returnUrl = loginReturnTarget(tab.url);
  if (returnUrl) {
    const dest = parseUrl(returnUrl);
    if (dest) await applyToHost(dest.host, session);
    await chrome.tabs.update(tab.id, { url: returnUrl });
  } else {
    await chrome.tabs.reload(tab.id);
  }
  window.close();
}

function renderCurrent(tab, sessions) {
  const box = $('#current');
  box.replaceChildren();

  const here = tab?.url ? parseUrl(tab.url) : null;
  if (!here) {
    box.append(el('p', { class: 'muted' }, 'Esta aba não é um host VTEX (myvtex.com, vtexcommercestable.com.br ou [ds.]vtexcrm.com.br).'));
    return;
  }

  // Na tela de login, a conta que importa é a do returnUrl.
  const dest = parseUrl(loginReturnTarget(tab.url) || '') || here;
  const account = dest.account;
  const session = sessions[account];
  const ok = isValid(session);

  box.append(
    el('p', {},
      el('span', { class: 'account' }, account),
      here.workspace ? el('span', { class: 'tag' }, `ws: ${here.workspace}`) : null,
      el('span', { class: 'tag' }, here.domain)
    ),
    ok
      ? el('p', { class: 'status-ok' }, `Sessão ativa${session.user ? ` · ${session.user}` : ''} · ${formatExp(session.exp)}`)
      : el('p', { class: 'status-warn' }, 'Sem sessão guardada para esta conta. Faça login uma vez no admin dela.'),
    el('button', {
      class: 'primary',
      disabled: !ok,
      onclick: () => applyHere(tab, here, account, session).catch((e) => toast(`Erro: ${e.message}`)),
    }, 'Aplicar nesta aba')
  );
}

function renderAccounts(sessions) {
  const list = $('#accounts');
  list.replaceChildren();
  const entries = Object.entries(sessions).sort(([a], [b]) => a.localeCompare(b));
  $('#empty').hidden = entries.length > 0;

  for (const [account, s] of entries) {
    const ok = isValid(s);
    list.append(
      el('li', {},
        el('div', { class: 'info' },
          el('div', { class: 'account' }, account),
          el('div', { class: 'muted user', title: s.user || '' }, `${s.user ? `${s.user} · ` : ''}${ok ? formatExp(s.exp) : 'expirada'}`)
        ),
        el('div', { class: 'actions' },
          ok ? el('button', { class: 'link', title: `https://${account}.myvtex.com/admin`, onclick: () => openWithSession(`https://${account}.myvtex.com/admin`, account, s) }, 'Admin') : null,
          ok ? el('button', { class: 'link', title: `https://${account}.ds.vtexcrm.com.br/`, onclick: () => openWithSession(`https://${account}.ds.vtexcrm.com.br/`, account, s) }, 'MD v1') : null,
          el('button', {
            title: 'Apaga o token guardado e remove o cookie de admin dos hosts conhecidos da conta (equivale a sair).',
            onclick: async () => {
              await forgetAccount(account);
              await render();
              toast(`Sessão de ${account} esquecida.`);
            },
          }, 'Esquecer')
        )
      )
    );
  }
}

async function render() {
  const [tab, sessions] = await Promise.all([activeTab(), getSessions()]);
  renderCurrent(tab, sessions);
  renderAccounts(sessions);
}

async function init() {
  const { auto } = await getSettings();
  const autoBox = $('#auto');
  autoBox.checked = auto;
  autoBox.addEventListener('change', async () => {
    await setSettings({ auto: autoBox.checked });
    toast(autoBox.checked ? 'Modo automático ligado.' : 'Modo automático desligado: use o botão.');
  });

  // Pega logins feitos antes da extensão existir / do service worker acordar.
  const captured = await scanExisting();
  if (auto) for (const { account, session } of captured) await applyToAllHosts(account, session);

  await render();
}

init().catch((e) => toast(`Erro: ${e.message}`));
