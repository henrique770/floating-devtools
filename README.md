# Floating DevTools

Extensão (Chrome / Brave / Edge, Manifest V3) com as abas **Network** e **Console** dentro de um
botão flutuante e arrastável, no estilo do indicador do Next.js. O painel abre por cima da página, sem espremê-la.

## Instalar

```bash
npm install
npm run build        # gera dist/
npm run dev          # rebuild automático ao salvar
npm test             # testes (Vitest)
npm run typecheck
```

Abra `chrome://extensions` (ou `brave://extensions`), ative o **Modo do desenvolvedor**, clique em
**Carregar sem compactação** e selecione a pasta `dist/`. Recarregue as abas que já estavam abertas.

## Uso

- **Clique** no botão para abrir ou fechar o painel. **Arraste** para colocá-lo em qualquer lugar da tela;
  perto de uma borda, ele gruda nela. A posição fica salva.
- **Arraste o cabeçalho** do painel (inclusive pela área das abas) para soltá-lo em qualquer lugar;
  duplo clique no espaço vazio do cabeçalho o devolve para junto do botão.
- `Alt+Shift+D` abre/fecha o painel. `Esc` fecha.
- O ícone da extensão na barra mostra/oculta o botão em todos os sites.
- Para redimensionar o painel, use o canto marcado; ou ⤢ para maximizar.
- **⚙ Idioma**: Português ou English. O padrão é **Sistema**, que segue o idioma preferido do navegador/sistema
  operacional (português para `pt-*`, inglês para os demais) e acompanha mudanças com a página aberta. O idioma vale
  para toda a interface, os diagnósticos do Insights (recalculados na troca, sem perder os dispensados), o relatório de
  bug e as respostas do assistente. Nome, descrição e atalho da extensão seguem o idioma do navegador (`public/_locales`).
- **⚙ Aparência**: modo translúcido (vidro com blur e opacidade ajustável) e temas — Default, Dracula,
  Tokyo Night, Catppuccin, Gruvbox, Nord, Cyberpunk 2077, Evangelion e SynthWave '84; e claros: Atom One Light,
  Ayu Light, White & Black, GitHub Light, Solarized Light, Gruvbox Light, Rosé Pine Dawn e Catppuccin Latte. Para criar um tema,
  adicione uma paleta em `src/ui/themes.ts` (`light: true` para temas claros).
- **⚙ Fonte**: tamanho (10–18px), peso (regular/médio/negrito), erros e avisos em negrito, e 11 fontes
  monoespaçadas empacotadas na extensão (funcionam offline e em sites com CSP) — entre elas Atkinson
  Hyperlegible Mono e Intel One Mono, feitas para legibilidade e contraste, JetBrains Mono, Fira Code e
  IBM Plex Mono. Para adicionar outra: `npm i -D @fontsource/<nome>` e uma entrada em `src/ui/fonts.ts`.
- **Network**: filtro por texto (`-texto` inverte) e por tipo, ordenação por coluna, detalhes com
  Headers / Payload / Preview / Response / Timing e "Copiar como cURL".
  **⇄ Comparar** (nos detalhes) e depois um clique em outra requisição abre a comparação lado a lado: resumo (URL,
  método, status, tipo, duração, TTFB, download e tamanhos, com a diferença em valor e %), query string, headers de
  requisição e resposta, payload e corpo da resposta. JSON é comparado pela estrutura (campos adicionados, removidos e
  modificados, com o caminho, ex.: `$.user.roles[1]`); outros textos linha a linha. Clicar em outra linha troca B;
  **Inverter** troca A e B; os rótulos A/B abrem os detalhes originais. Valores sensíveis (cookies, `authorization`,
  tokens, senhas…) aparecem mascarados até você marcar **Valores sensíveis**, e a comparação usa os valores reais.
  Corpos acima de 300 kB são comparados só por igualdade e tamanho; respostas binárias ou não capturadas são indicadas.
- **Console**: níveis, filtro por texto, origem (esta origem / terceiros) e período, objetos expansíveis,
  mensagens repetidas agrupadas, erros não tratados, e um prompt para executar JS na página (↑/↓ para o histórico).
  **Agrupar** junta mensagens equivalentes mesmo que não sejam consecutivas — `QuotaExceededError` 200× vira
  uma linha com o total, primeira e última ocorrência; clique no contador para ver as ocorrências originais.
  Duas mensagens são equivalentes quando têm o mesmo nível, prefixo, mensagem normalizada (ids, UUIDs, hashes,
  números com 4+ dígitos e decimais viram placeholders; números curtos como status HTTP são mantidos), origem e os
  3 primeiros frames do stack (sem query string nem hash de bundle). O local do erro faz parte da chave: a mesma
  mensagem lançada de lugares diferentes fica em grupos separados. Com filtro de período, aparecem os grupos com
  atividade no período, mas o contador mostra o total desde a última limpeza.
- **Correlação Console ↔ Network**: em erros e avisos do Console, **⇄** lista as requisições possivelmente
  relacionadas; nos detalhes de uma requisição, a aba **Relacionados** faz o inverso; no Insights, cada diagnóstico
  expandido mostra as relações da ocorrência mais recente, e o Assistant recebe um resumo delas. Cada relação tem um
  grau de confiança e o motivo:
  - **Alta** — identidade de objeto: o erro registrado é o mesmo objeto produzido pela falha do `fetch()` ou de
    `response.json()` (também quando chega como `cause` de outro erro). Quando existe, o erro ganha o atalho **NET ↗**.
  - **Média** — o stack do erro e o ponto que iniciou a requisição passam pela mesma função do código da página
    (frames de bibliotecas são ignorados), ou um erro de JSON ocorre logo após uma resposta que não é JSON.
  - **Baixa** — só proximidade no tempo (falha até 2 s antes do erro). Mostrada como pista, nunca como causa.
  Os detalhes de fetch/XHR mostram também o **Iniciador** (stack de quem chamou). O Insights agrupa ainda
  **falhas em série** (3+ erros de rede ou 5xx no mesmo host em 10 s), um sinal de causa comum.
- **Insights**: diagnósticos automáticos gerados localmente (sem IA) a partir do que foi capturado — painel com
  totais (requisições, erros, avisos, diagnósticos, lentas) e distribuição por severidade, e a lista de problemas com
  evidências, possíveis causas, impacto, recomendações e eventos relacionados (clique para abrir a requisição ou o log
  original). Filtros por categoria, severidade e texto; ordenação por relevância ou horário; **Dispensar** esconde um
  diagnóstico mesmo que ele volte a ocorrer; **Investigar com IA** abre o Assistant focado no diagnóstico. Os limites (requisição lenta, recurso pesado, duplicadas) ficam em **⚙ → Insights**.
  Regras iniciais:
  - **JavaScript**: exceções não tratadas (TypeError, ReferenceError, SyntaxError…), Promises rejeitadas sem tratamento,
    `Error` registrado com `console.error` e scripts que não carregaram. Um `console.error("texto")` simples não vira
    diagnóstico.
  - **Network**: HTTP 4xx/5xx, timeout, cancelamento, bloqueio pelo navegador (adblock), falha de conexão, **possível
    CORS** (chamada para outra origem em que o `webRequest` viu o servidor responder mas a página só recebeu
    "Failed to fetch" — o navegador não informa o motivo à página, então é sempre apresentado como hipótese),
    HTML recebido em chamada de API e JSON inválido.
  - **Storage**: `QuotaExceededError`, acesso negado ao armazenamento e falhas do IndexedDB.
  - **Performance**: requisições lentas (duração total; TTFB e download aparecem separados quando há dados de timing),
    recursos pesados e chamadas idênticas repetidas na mesma janela ("potencialmente duplicadas" — polling e novas
    tentativas também repetem chamadas).
  **Relatório** (na barra do Insights, ou em um diagnóstico) gera um relatório de bug revisável: título, resumo e
  passos para reproduzir editáveis; escolha das seções (ambiente, diagnósticos, erros, requisições) e dos
  diagnósticos; URL sem valores de query; ambiente (navegador, viewport, idioma, fuso); diagnósticos com evidências
  e hipóteses separadas; erros agrupados com contagem, horários e stack; requisições relacionadas com status,
  duração e TTFB; e as relações de confiança média/alta entre erros e requisições. Exporta em **Markdown**,
  **GitHub Issue** (seções longas recolhíveis; **Abrir issue ↗** abre `github.com/<owner/repo>/issues/new` com título
  e corpo — se o corpo for longo demais para a URL, ele é copiado para você colar) e **JSON** (estrutura versionada).
  Todo texto capturado passa pelo mascaramento; o texto final pode ser editado à mão antes de copiar ou baixar.
  Aberto a partir de um diagnóstico, o relatório traz só os eventos dele; pelo botão geral, inclui também os demais
  erros e requisições com falha. O relatório usa os dados do momento em que foi aberto (**Atualizar dados** recria).
  O painel **Performance de rede** traz os rankings das requisições **mais lentas** (barra com as fases reais:
  fila/conexão, espera do servidor/TTFB e download — ou "sem fases" quando o navegador não expõe o timing) e dos
  recursos **mais pesados** (bytes transferidos, ou tamanho do corpo quando veio do cache), a mediana das chamadas de
  API e quantas passaram dos limites configurados (▲). Clique em uma linha para abrir a requisição.
  Problemas vindos de scripts/hosts de outra origem têm a severidade reduzida um nível. Ocorrências do mesmo problema
  (mesma regra e mesmo endpoint/grupo de log) são somadas em um diagnóstico.
- **Assistant**: chat com IA que recebe como contexto um resumo do que foi capturado (erros e avisos do
  console, requisições com falha e lentas, totais) — pergunte "Resuma os logs", "Recomende melhorias" etc.
  Funciona com a sua própria API key (BYOK): **⚙ → Assistente**, cole a chave da DeepSeek e escolha o modelo.
  A chave fica em `chrome.storage.local` e só o service worker a usa. Headers, cookies, corpos de requisição e
  valores de query string não são enviados; no que é enviado (mensagens, stacks, trechos de respostas com erro, título),
  tokens, JWTs, chaves de API conhecidas, senhas e campos sensíveis (`password`, `*_token`, `api_key`…), credenciais
  em URL, e-mails, CPFs e números de cartão são mascarados como `[REDACTED:tipo]` antes de sair do navegador
  (`src/analysis/redact.ts`). Clique em **Contexto** na barra do Assistant para ver o texto exato que será enviado e
  quantos valores foram mascarados. Os dados capturados vão em um bloco delimitado na mensagem do usuário, nunca nas
  instruções de sistema, e o modelo é instruído a tratá-los como dados não confiáveis (eles vêm da página).
  **Investigar com IA** — em um erro/aviso do Console (ícone do assistente), nos detalhes de uma requisição (**IA**) ou
  em um diagnóstico do Insights — inicia uma conversa focada naquele item: o Assistant recebe o item em detalhe
  (mensagem e stack; ou status, timing com TTFB, headers sem credenciais, iniciador e trechos mascarados do payload e da
  resposta; ou o diagnóstico com evidências e hipóteses separadas), os eventos relacionados com o grau de confiança e
  os diagnósticos que o envolvem, seguido de uma visão geral reduzida da página. Nada é enviado até você escolher uma
  das ações rápidas (Explique este erro, Qual pode ser a causa?, Como corrigir?, Analise esta requisição, Existe
  problema de performance?…) ou escrever a pergunta; **Ver contexto** mostra o texto exato. O foco fica salvo com a
  conversa no histórico, para perguntas de acompanhamento. Sem foco, a visão geral inclui também os diagnósticos do
  Insights ("Resuma os problemas da sessão"). Código sugerido pela IA nunca é executado: os blocos só têm "copiar". Novos providers compatíveis com a API da OpenAI entram em `src/shared/ai.ts`.
  As respostas usam a fonte e o tema escolhidos (inclusive nas cores do código), cada bloco de código tem
  botão de copiar, e as conversas ficam salvas no histórico (🕘, até 50, com busca) para retomar depois.

## Como funciona

| Parte | Arquivo | Papel |
| --- | --- | --- |
| Hook na página (MAIN world, `document_start`) | `src/injected/main-world.ts` | intercepta `console.*`, erros, `fetch`, `XHR` (com o stack de quem iniciou) e usa `PerformanceObserver` para os demais recursos; marca os objetos de erro gerados por uma requisição para correlação |
| Service worker | `src/background.ts` | `chrome.webRequest` completa status, headers, IP e cache de recursos estáticos; ícone e atalho; chamadas ao provider de IA (streaming) |
| Content script | `src/content/` | store com atualização em lote e UI em React dentro de Shadow DOM (o CSS do site não interfere) |
| Análise | `src/analysis/` | lógica pura e testável (sem `chrome.*`): fingerprint e agrupamento incremental de logs, motor de diagnósticos (`diagnostics/`, avaliado evento a evento), correlação sob demanda (`correlate.ts`) e mascaramento (`redact.ts`) |
| UI | `src/ui/` | botão, painel, abas |

Para criar uma regra de diagnóstico: implemente um `LogRule` ou `RequestRule` em `src/analysis/diagnostics/rules/`
(retorne `null` quando não se aplica; coloque só fatos em `evidence` e as hipóteses em `causes`), registre-a em
`rules/index.ts` e adicione casos positivos e negativos em `rules.test.ts`. Os textos da regra vão em um
`defineMessages` no próprio arquivo.

**Traduções** (`src/i18n/`): cada módulo declara seus textos com `defineMessages({ pt: {...}, en: {...} })`, ao lado do
código que os usa; mensagens com parâmetros são funções (`(n: number) => ...`). O TypeScript exige as mesmas chaves e
assinaturas em todos os idiomas, então uma tradução faltando é erro de compilação. Leia o dicionário (`m()`) no momento
em que o texto é produzido, nunca no carregamento do módulo; componentes memoizados chamam `useLocale()` para
re-renderizar na troca. Para um novo idioma, adicione-o a `LOCALES`/`LOCALE_NAMES` e preencha os dicionários que o
compilador apontar. Os testes rodam em português (`src/test/setup.ts`).

## Limitações (em relação ao DevTools nativo)

- O corpo da resposta só é capturado para `fetch`/XHR (imagens, CSS, JS: use "Abrir em nova aba").
- WebSocket, iframes e service workers não são capturados.
- A correlação considera só o frame principal da aba; erros de axios e outras bibliotecas que criam um novo objeto de erro
  não têm o vínculo por identidade (ficam com stack ou tempo).
- O log não é preservado ao navegar/recarregar.
- Sites com CSP sem `unsafe-eval` bloqueiam o prompt do console (a mensagem de erro indica isso).
- Logs feitos antes da extensão carregar (abas abertas antes da instalação) não aparecem: recarregue a aba.
