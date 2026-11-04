# VTEX Sessão Única

Extensão para Chrome/Edge (Manifest V3). Você faz login uma vez no admin de uma conta VTEX e a extensão reaproveita o token (`VtexIdclientAutCookie`) em todos os hosts dessa conta:

- `conta.myvtex.com` (admin)
- `workspace--conta.myvtex.com` (qualquer workspace)
- `conta.vtexcommercestable.com.br`
- `conta.ds.vtexcrm.com.br` e `conta.vtexcrm.com.br` (Master Data v1)

## Instalar

1. Abra `chrome://extensions` (no Edge, `edge://extensions`).
2. Ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha esta pasta (`vtex-sessao-unica`).
4. Fixe o ícone da extensão na barra.

Depois de mudar o código, clique em **Recarregar** no card da extensão.

## Usar

1. Faça login no admin de uma conta normalmente (`https://conta.myvtex.com/admin`).
2. A extensão guarda o token daquela conta. O popup mostra quem está logado e quando o token expira.
3. Para abrir um workspace, o vtexcommercestable ou o Master Data v1:
   - **Modo automático** (padrão): é só abrir a URL. O token é gravado antes da página carregar. Se a página ainda cair no login do admin, a extensão grava de novo e volta para o `returnUrl` (uma vez por aba, para não entrar em loop).
   - **Modo botão** (desligue "Automático" no popup): abra a página e clique em **Aplicar nesta aba**. Se você estiver na tela de login, ele já volta para o `returnUrl`.
4. O badge **ON** no ícone indica que a conta da aba atual tem uma sessão guardada.
5. **Esquecer** apaga o token guardado e remove o cookie de admin dos hosts conhecidos da conta (equivale a sair).

## Como funciona

| Arquivo | O que faz |
|---|---|
| `lib.js` | Lê a conta e o workspace a partir do host, decodifica o JWT (`exp`, `sub`), guarda e aplica os tokens |
| `background.js` | Captura os tokens (`cookies.onChanged`), aplica no modo automático (`webNavigation.onBeforeNavigate`) e trata a volta da tela de login |
| `popup.*` | Status da aba atual, botão de aplicar, lista de contas e o interruptor de modo |

- A chave é a **conta**: um token de `lojax` nunca é gravado em hosts de `lojay`.
- Ao instalar, ao abrir o navegador e ao abrir o popup, a extensão procura cookies de admin que já existam. Se você já estava logado, não precisa logar de novo.
- Quando um token novo aparece (você logou de novo), no modo automático ele é gravado nos hosts base e em todos os workspaces que você já visitou daquela conta.

## Segurança

- Os tokens ficam em `chrome.storage.session`: só na memória e só acessíveis pela extensão. Eles somem quando o navegador é fechado. Nada vai para o disco, para o sync ou para a rede.
- O token é uma credencial de admin **pessoal**. Cada pessoa usa a extensão com o próprio login. Não exporte nem compartilhe o token.
- A extensão só pede acesso aos três domínios VTEX listados acima.
- Só o cookie `VtexIdclientAutCookie` (admin) é copiado. Os cookies `VtexIdclientAutCookie_<conta>` são a sessão do comprador no storefront e ficam de fora de propósito.

## Ajustes comuns

- **Outro domínio VTEX:** adicione em `DOMAINS` (`lib.js`) e em `host_permissions` (`manifest.json`).
- **Outro nome de cookie:** adicione em `COOKIE_NAMES` (`lib.js`).
- **Outra tela de login:** ajuste a regex em `loginReturnTarget` (`lib.js`).
