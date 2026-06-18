# Translate PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React H5 PWA translation app with Bun/Elysia backend, text translation, speech translation, personal interpreting, and single-speaker meeting interpreting for Chinese, English, and Russian.

**Architecture:** The app talks only to the Elysia backend over HTTP and WebSocket. The backend owns all Gemini calls, including Gemini Live Translate sessions, and keeps meeting state in memory for the MVP.

**Tech Stack:** React, Vite, TypeScript, Bun, Elysia, Gemini API, WebSocket, WebAudio, PWA manifest.

---

### Task 1: Shared Domain And Meeting Store

**Files:**
- Create: `src/shared/languages.ts`
- Create: `src/shared/ws-protocol.ts`
- Create: `src/server/meeting-store.ts`
- Test: `tests/languages.test.ts`
- Test: `tests/meeting-store.test.ts`
- Test: `tests/ws-protocol.test.ts`

- [ ] Write failing tests for the three supported languages, meeting lifecycle, and WebSocket message validation.
- [ ] Run `bun test tests/languages.test.ts tests/meeting-store.test.ts tests/ws-protocol.test.ts` and verify module-not-found failures.
- [ ] Implement the shared language definitions, protocol validator, and in-memory meeting store.
- [ ] Re-run the tests and verify they pass.

### Task 2: Server API And Gemini Boundary

**Files:**
- Create: `src/server/gemini.ts`
- Create: `src/server/routes.ts`
- Create: `src/server/index.ts`
- Test: `tests/server-routes.test.ts`

- [ ] Add tests for health, text translation request validation, TTS validation, and meeting creation.
- [ ] Implement Elysia routes with Gemini calls behind a small adapter interface.
- [ ] Keep Gemini API key only on the server via `GEMINI_API_KEY`.
- [ ] Re-run route tests.

### Task 3: WebSocket Streaming Protocol

**Files:**
- Create: `src/server/live-session.ts`
- Modify: `src/server/routes.ts`
- Test: `tests/live-session.test.ts`

- [ ] Add tests for binary audio chunk handling, speaker lock rules, and per-language broadcast routing.
- [ ] Implement WebSocket message handling for personal interpreting and meeting rooms.
- [ ] Stream 16k PCM audio chunks to Gemini and stream 24k PCM response chunks back to clients.

### Task 4: React PWA

**Files:**
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/styles.css`
- Create: `src/client/audio/audio-worklet.ts`
- Create: `src/client/audio/pcm.ts`
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`

- [ ] Build routes for normal translation, personal interpreting, create meeting, and meeting room.
- [ ] Implement microphone capture, 16k PCM conversion, WebSocket chunk upload, and streamed audio playback.
- [ ] Implement a functional mobile-first tool UI with Chinese, English, and Russian language controls.
- [ ] Register the service worker and manifest.

### Task 5: Verification

**Files:**
- Modify as needed based on failures.

- [ ] Run `bun install`.
- [ ] Run `bun test`.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run build`.
- [ ] Start the dev server and provide the local URL.
