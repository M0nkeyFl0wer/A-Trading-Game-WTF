# Beta Readiness Plan

This plan captures the minimum set of work required to get the game into a beta-testable state. Each section lists objectives, concrete tasks, dependencies, and verification/observability requirements so we can drive the todo list with clear acceptance criteria.

## 1. Secure Voice Proxy & Client Integration

**Objectives**
- Remove ElevenLabs credentials from the browser bundle.
- Enforce per-user rate limits and observability for voice synthesis.
- Maintain audio caching and latency guarantees.

**Key Tasks**
1. Create `/api/voice/speak` POST endpoint in `api/routes/voice.ts`:
   - Accepts `{ text, voiceId, style }` payload, validates via shared security module.
   - Reads ElevenLabs API key from server env, calls ElevenLabs REST API.
   - Applies per-user/IP rate limiting (reuse `botLimiter` pattern).
   - Streams audio back (binary) or base64 chunk, with cache headers disabled.
2. Persist short-lived cache server-side (Redis or in-memory LRU capped by TTL/size) with metrics (`hits`, `misses`, `evictions`).
3. Update `apps/web/src/lib/elevenlabs.ts`:
   - Replace direct ElevenLabs fetch with calls to `/api/voice/speak`.
   - Handle authenticated requests (attach Firebase token once auth is wired).
   - Keep client-side cache purely for decoded AudioBuffers.
4. Instrument logging (structured) for every voice request with user id, text hash, latency, upstream status.

**Verification**
- Automated test hitting `/api/voice/speak` returns 200 with mock ElevenLabs response.
- Confirm `VITE_ELEVENLABS_API_KEY` is no longer referenced in built web bundle.
- Manual QA: slider volume works (see Section 5).

## 2. Auth Middleware & Firebase-Backed Rooms

**Objectives**
- Ensure every API/WebSocket request is authenticated via Firebase ID tokens.
- Replace mock room CRUD with Firestore/Realtime DB powered data.

**Key Tasks**
1. Add Firebase Admin SDK to `api` package and load service account config from env vars.
2. Implement `authenticateRequest` Express middleware:
   - Reads `Authorization: Bearer <token>`.
   - Verifies via Firebase Admin, populates `req.user` with uid/email/claims.
3. Apply middleware globally before routing and share with Socket.IO via `io.use`.
4. Replace placeholder logic in `api/routes/room.ts` with CRUD against Firebase (or plan B: Postgres if ready):
   - `/` lists rooms from DB with pagination.
   - `/create`, `/join/:roomId`, `/leave/:roomId` mutate DB with optimistic locking + validation.
   - Publish room updates to Socket.IO channels for real-time UI sync.
5. Update frontend hooks (`useLobbyTables`, `CreateTableModal`, etc.) to consume live data via REST/WebSocket.

**Verification**
- Integration test: unauthenticated requests receive 401; valid Firebase tokens succeed.
- Manual: multiple browsers reflect room joins/leaves within 200 ms.

## 3. Bot Sandbox Hardening

**Objectives**
- Use the built `@trading-game/bot` package on the server instead of importing TS source.
- Provide sandboxed execution with real market snapshots and enforce quotas.

**Key Tasks**
1. Expose `SecureBotSandbox` via package entry point and add build artifacts the API can import.
2. Update `api/routes/bot.ts` to import from `@trading-game/bot` and load worker scripts from `node_modules`.
3. Provide configurable market snapshots (from real data service or mock injection) and user portfolio fetch.
4. Add per-user execution quotas, queueing, and structured telemetry (duration, memory, outcome).
5. Integration tests around `botSandbox.executeBot` with stub worker.

**Verification**
- Hitting `/api/bot/submit` without installing TS loaders works.
- Metrics show sandbox success/error counts.

## 4. Gameplay Loop & State Sync

**Objectives**
- Remove client-only Round mutations and wire the core engine to real-time multiplayer state.
- Ensure lobby/table UI reflects authoritative server state.

**Key Tasks**
1. Move round progression logic to backend service (could use Firebase Cloud Functions or API server) that orchestrates deal → trading → reveal → settle states using `@trading-game/core`.
2. Replace `useBotAI` with a listener to server events; bots run server-side.
3. Implement Socket.IO namespaces/rooms for table events (`round.start`, `trade`, `round.settle`).
4. Frontend subscribes to sockets + Firestore to render seat availability, timers, trade tape.

**Verification**
- Manual e2e: two browsers can join a table, see synced timers/trades, and finish a round without manual refresh.
- Automated smoke: mock clients connect, server orchestrates at least one round.

## 5. Voice UI & Controls

**Objectives**
- Ensure the volume slider in `VoiceControls` adjusts playback gain and persists per user.
- Provide deterministic mute + character selection.

**Key Tasks**
1. Introduce GainNode in `voiceService` with settable value.
2. Bind Zustand store volume to GainNode and persist preference (localStorage + server profile).
3. Update UI to reflect disabled state when voice is off or backend proxy errors.

**Verification**
- Manual: slider changes volume in real time; toggling mute pauses playback.
- Unit test: store updates propagate to voice service.

## 6. Observability & Tests

**Objectives**
- Capture logs/metrics/traces for all critical backend paths.
- Add at least smoke-level automated tests for API endpoints, sockets, and the voice proxy.

**Key Tasks**
1. Standardize logging (pino/winston) with request IDs.
2. Emit metrics (Prometheus endpoints or third-party) for rate limits, sandbox usage, voice requests.
3. Add Vitest (or Jest) suites in `api/tests` hitting key endpoints with Supertest + mocked Firebase/ElevenLabs.
4. Add GitHub Action step running `pnpm --filter api test` and e2e smoke (can stub external HTTP using MSW).

**Verification**
- CI pipeline runs full test matrix and fails on regressions.
- Logs contain structured entries for auth, rooms, bots, voice.

## Dependencies & Rollout

- **Secrets**: require server-side env vars (`ELEVENLABS_API_KEY`, Firebase service account), store via Vercel / GH secrets.
- **Data Stores**: Firebase Realtime DB/Firestore ready with security rules deployed.
- **Infrastructure**: Vercel (web) + server host (Express + Socket.IO) with HTTPS and WebSocket support.

## Exit Criteria for Beta

1. No secrets in frontend bundle; all third-party API calls proxied/secured.
2. Authenticated gameplay loop with multiple users verified end-to-end.
3. Voice proxy + UI stable with rate limiting + logs.
4. Bot sandbox accessible via API without TypeScript source imports.
5. CI green (`pnpm -r test` + backend smoke tests) and observability dashboards set up.

Once these criteria are met and manual QA sessions pass (voice, gameplay, bot submission, lobby sync), the game can be opened to a closed beta cohort.
