# DemoBudget

An offline browser tool for planning a timed hackathon demo video. Set a video limit, add timed sections, see start and end timestamps and whether you are under, exactly at, or over budget, fix the plan, then export a chronological Markdown cue sheet and reopen it later.

## Setup and run

Requirements: Node.js. Tested with Node v20.19.2. Results on other Node versions are not claimed here. No dependencies to install; startup fetches nothing.

    node scripts/serve.mjs 8080
    # open http://127.0.0.1:8080/

Supported startup is the local HTTP server command above (scripts/serve.mjs, zero dependencies, binds 127.0.0.1; malformed URLs get 400 and traversal or hidden paths get 404 without stopping the server). A `python3 -m http.server` fallback is untested. The app uses ES modules; opening index.html directly from disk (file://) is not supported; observed in Chrome 154 headless, the page loads but the app does not start.

## Test

    npm run check    # node --check syntax check of every .js and .mjs file
    node --test test/*.test.js
    node --test --experimental-test-coverage test/*.test.js
    node --experimental-websocket scripts/browser-checks.mjs   # real Chrome checks via CDP, needs google-chrome

## Features

- Add, edit, remove and reorder (Up/Down) sections; start/end timestamps per section.
- Total, remaining and over-budget seconds, with an explicit "exactly at limit" state.
- Strict validation with visible error messages and no silent coercion.
  - Durations and limits are whole seconds from 1 to 3600. Typed values are trimmed of surrounding whitespace (' 90 ' is read as 90); this is the only normalization. After trimming they must be plain digits: signs, exponents, decimal points and leading zeros (for example '010' or '00') are rejected with a visible error. Saved data and imported cue sheets must hold JSON numbers.
  - Zero is rejected: a zero-length cue has no screen time and usually means a typo.
  - Decimals (for example 1.5) are rejected, not rounded: a demo is timed by hand in whole seconds.
  - Titles are required, trimmed, single line (no line breaks, U+2028 or U+2029), with no control characters in the ranges U+0000 to U+001F or U+007F, and at most 500 UTF-16 code units (an emoji outside the Basic Multilingual Plane counts as 2).
  - A plan holds at most 100 sections.
- Keyboard accessible: native buttons and inputs, visible focus ring, errors announced with role="alert".
- Readable at 375 px wide.
- All user text is rendered with textContent, so markup such as `<script>` stays literal.
- Built-in fictional example (team "Lantern Labs" is invented), reset with an explicit confirmation step.
- Deterministic Markdown export with live preview and download. Markdown table syntax in titles is backslash-escaped, and a fenced JSON data block carries the exact values. Escaping does not guarantee that every Markdown renderer shows the exact literal text (for example, GitHub may still autolink URLs or @mentions); DemoBudget itself always reopens the exact text.
- Import by file or paste. The JSON block is validated against a strict schema (exact fields only, same caps as the UI), and re-exporting must reproduce the file byte for byte, so hand-edited sheets are rejected with a message. Export, import, export is byte-identical. The only tolerated difference is a missing final newline, as happens when pasting; CRLF line endings are also accepted. Files over 1,000,000 bytes are rejected before reading, and unreadable files show an error.
- State is kept only in localStorage. If the browser refuses to save, a visible message says so; the plan stays on screen and can still be exported. Saved data is checked with the same schema and caps as import; if it is invalid or damaged, a visible message says so, it is not loaded, and saving pauses so it is never silently overwritten until you confirm Reset all or import a cue sheet.
- A rejected limit entry is replaced by the current limit, and its error cleared, the next time the plan changes.
- An edit in progress is cleared when its section is removed or moved, or when an example, reset or import replaces the plan; it is kept when a save or import fails or a reset is cancelled.
- No backend, accounts, analytics or external runtime requests; the only requests are same-origin loads of the app's own static files (enforced by a Content-Security-Policy with connect-src 'none').

## Limits

- One plan at a time; no undo beyond re-importing an exported cue sheet.
- Import only accepts unedited cue sheets exported by DemoBudget.
- Tested in Google Chrome only.

## AI disclosure

Built by the Grok bot "Hackathon Operator" using its own tools (shell, editor, Node, headless Chrome, ffmpeg). Chinmay Shringi delegated supervision; Codex operated the review relay, including Claude reviews. Chinmay did not personally relay prompts or approve specific code. No runtime AI or LLM is used by the app.

## License

MIT, see LICENSE.
