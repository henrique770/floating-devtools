# Floating DevTools

Extensão (Chrome / Brave / Edge, Manifest V3) com as abas **Network** e **Console** dentro de um
botão flutuante e arrastável, no estilo do indicador do Next.js. O painel abre por cima da página, sem espremê-la.

## Instalar

```bash
npm install
npm run build        # gera dist/
npm run dev          # rebuild automático ao salvar
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
- **Console**: níveis, filtro, objetos expansíveis, mensagens repetidas agrupadas, erros não tratados,
  e um prompt para executar JS na página (↑/↓ para o histórico).
- **Assistant**: chat com IA que recebe como contexto um resumo do que foi capturado (erros e avisos do
  console, requisições com falha e lentas, totais) — pergunte "Resuma os logs", "Recomende melhorias" etc.
  Funciona com a sua própria API key (BYOK): **⚙ → Assistente**, cole a chave da DeepSeek e escolha o modelo.
  A chave fica em `chrome.storage.local` e só o service worker a usa; headers, cookies e valores de query
  string não são enviados. Novos providers compatíveis com a API da OpenAI entram em `src/shared/ai.ts`.
  As respostas usam a fonte e o tema escolhidos (inclusive nas cores do código), cada bloco de código tem
  botão de copiar, e as conversas ficam salvas no histórico (🕘, até 50, com busca) para retomar depois.

## Como funciona

| Parte | Arquivo | Papel |
| --- | --- | --- |
| Hook na página (MAIN world, `document_start`) | `src/injected/main-world.ts` | intercepta `console.*`, erros, `fetch`, `XHR` e usa `PerformanceObserver` para os demais recursos |
| Service worker | `src/background.ts` | `chrome.webRequest` completa status, headers, IP e cache de recursos estáticos; ícone e atalho; chamadas ao provider de IA (streaming) |
| Content script | `src/content/` | store com atualização em lote e UI em React dentro de Shadow DOM (o CSS do site não interfere) |
| UI | `src/ui/` | botão, painel, abas |

## Limitações (em relação ao DevTools nativo)

- O corpo da resposta só é capturado para `fetch`/XHR (imagens, CSS, JS: use "Abrir em nova aba").
- WebSocket, iframes e service workers não são capturados.
- O log não é preservado ao navegar/recarregar.
- Sites com CSP sem `unsafe-eval` bloqueiam o prompt do console (a mensagem de erro indica isso).
- Logs feitos antes da extensão carregar (abas abertas antes da instalação) não aparecem: recarregue a aba.
