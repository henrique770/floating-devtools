# Privacy Policy — Floating DevTools

_Last updated: October 20, 2026_

Floating DevTools is a Chrome extension that shows a floating developer panel (Network, Console, Insights and an optional AI Assistant) on the page you are viewing. This policy explains what data the extension handles and where it goes.

## Summary

- The extension has **no server** of its own. The developer does not collect, receive or store any of your data.
- Everything the extension captures stays **in your browser**, except when **you** use the AI Assistant, which sends a masked summary to the AI provider **you** configured.
- No analytics, no tracking, no ads, no selling of data.

## Data the extension handles

### Page debugging data (stays on your device)
To show the Network, Console and Insights tabs, the extension reads, for the tab you are on:
- URLs, methods, status codes, timings, sizes and request/response headers of network requests;
- console messages and JavaScript errors.

This data is kept only in memory for that tab and is discarded when the tab is closed or reloaded. It is never sent to the developer.

### Settings and history (stored locally)
Using `chrome.storage.local`, on your device only, the extension saves:
- whether the panel is enabled and your UI preferences (theme, font, panel position and size);
- your AI Assistant settings, including the AI provider API key **you** enter;
- your AI Assistant chat history (up to the last 50 conversations).

You can delete this data at any time by clearing the history in the extension or by removing the extension.

## AI Assistant (optional)

The Assistant is off until you add your own API key. When you send a question, the extension sends to the AI provider you selected (currently DeepSeek, `api.deepseek.com`):
- your question;
- a summary of the current page's diagnostics, such as errors, console messages and request URLs/statuses.

**Before sending**, the extension masks sensitive values it detects, such as cookies, authorization headers, tokens, API keys, JWTs, passwords, e-mail addresses, CPF numbers and card numbers.

Data is sent directly from your browser to the provider using your own API key. It is handled under that provider's own privacy policy (see the privacy policy on the provider's website). Nothing is sent unless you use the Assistant.

## Permissions

- **Host access (all sites):** to show the panel and capture debugging data on whatever page you are developing.
- **webRequest:** to read status, headers and errors of the tab's requests. Requests are never blocked or modified.
- **storage:** to save the settings and history described above, locally.

## Limited Use

The use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide the extension's single purpose, is not sold, and is not used for advertising, creditworthiness or any purpose unrelated to debugging the page.

## Changes

If this policy changes, the new version will be published at this same address with a new "Last updated" date.

## Contact

Questions: open an issue at https://github.com/henrique770/floating-devtools/issues.
