# Gemini Live Group Interpreter

A browser-based multi-person simultaneous interpretation room powered by Gemini Live Translate. It lets people who speak different languages join the same room, talk naturally, and receive translated captions and audio in their own language. The frontend captures microphone audio and renders live translated captions, while the Bun/Elysia backend manages shared rooms, participant state, WebSocket signaling, Gemini Live Translate sessions, translated audio fan-out, and static frontend hosting for single-process deployment.

## Features

- Room links with automatic UUID creation and shared room state.
- Join dialog with display name and language selection before connecting.
- Multi-participant presence, active speaker state, and room cleanup after disconnect.
- Real-time captions with timestamped, scrollable transcript history.
- Translated audio playback toggle per client.
- Live microphone waveform feedback.
- Two room modes:
  - **Live interpretation**: captions and translated audio stream as they arrive.
  - **Face-to-face**: one speaker records at a time, then translated captions and audio play after the speaker stops.
- Single-process production deployment: the backend serves both `/api`, `/ws`, and the built frontend from `dist/`.

## Tech Stack

- **Runtime:** Bun
- **Backend:** Elysia
- **Frontend:** React 19, Vite
- **Realtime:** WebSocket
- **AI:** Gemini Live Translate and Gemini text/TTS APIs
- **Language:** TypeScript
- **Tests:** Bun test

## Project Structure

```text
src/
  client/              React app, audio capture/playback, room UI
  server/              Elysia API, WebSocket rooms, Gemini integration
  shared/              Shared language and WebSocket protocol types
tests/                 Unit and integration tests
public/                PWA/static public assets
scripts/start-local.ts Local two-process dev runner
dist/                  Generated frontend build output
```

## Requirements

- Bun 1.3 or newer
- Gemini API key with access to the configured Gemini models

## Environment Variables

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Required:

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | Google Gemini API key used by text, TTS, and Live Translate. |

Common optional variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Backend bind host. Use `0.0.0.0` for remote access. |
| `PORT` | `3000` | Production backend port. |
| `API_PORT` | `18080` | API port used by `bun run start:local`. |
| `WEB_PORT` | `18081` | Vite dev server port used by `bun run start:local`. |
| `TRANSLATE_API_ORIGIN` | `http://localhost:3000` | API target for Vite dev proxy. |
| `GEMINI_TEXT_MODEL` | `gemini-3.5-flash` | Text translation model. |
| `GEMINI_TTS_MODEL` | `gemini-3.1-flash-tts-preview` | TTS model. |
| `GEMINI_LIVE_TRANSLATE_MODEL` | `gemini-3.5-live-translate-preview` | Live Translate model. |
| `GEMINI_LIVE_CONNECT_TIMEOUT_MS` | `10000` | Live Translate WebSocket connection timeout. |
| `GEMINI_LIVE_DRAIN_MIN_MS` | `700` | Minimum wait after sending `audioStreamEnd`. |
| `GEMINI_LIVE_DRAIN_IDLE_MS` | `600` | Quiet window before closing a Live session. |
| `GEMINI_LIVE_DRAIN_MAX_MS` | `3000` | Maximum wait for trailing Live Translate output. |
| `GEMINI_LIVE_PROXY_URL` | unset | Proxy URL for Gemini Live WebSocket connections. |

Standard proxy variables such as `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY` are also supported for Gemini Live connections.

## Development

Install dependencies:

```bash
bun install
```

Start the local API and Vite frontend together:

```bash
bun run start:local
```

By default this starts:

- API: `http://localhost:18080`
- Web app: `http://127.0.0.1:18081`

You can also run them separately:

```bash
bun run dev:api
bun run dev:web
```

## Production Build and Run

Build the frontend:

```bash
bun run build
```

Start the backend:

```bash
HOST=0.0.0.0 PORT=3000 GEMINI_API_KEY=your_key_here bun run start
```

In production, the backend serves:

- `GET /api/*` for API routes
- `GET /ws/*` for WebSocket routes
- `GET /assets/*` for Vite build assets
- `GET /` and frontend routes via `dist/index.html`

This means the app can be deployed as a single Bun process after `dist/` has been generated.

## Testing

Run all tests:

```bash
bun test
```

Run type checking:

```bash
bun run typecheck
```

Run a production build check:

```bash
bun run build
```

## WebSocket Room Flow

1. The client creates or reuses a room ID from the URL.
2. The user chooses a display name and language.
3. The client joins `/ws/meetings/:roomId`.
4. The backend broadcasts room state, participants, active speaker changes, captions, and translated audio.
5. In face-to-face mode, translated output is buffered until the current speaker stops.

## Deployment Notes

- Run `bun run build` before `bun run start`; otherwise frontend routes will return a missing-build response.
- Use HTTPS in production so browsers allow microphone access.
- Configure reverse proxies to pass WebSocket upgrades for `/ws/*`.
- Keep `GEMINI_API_KEY` server-side only. The frontend talks to your backend and should never receive the key.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
