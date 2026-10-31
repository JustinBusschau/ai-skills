import { defineConfig } from 'vitest/config';

// The suite must test the mock's real defaults, whatever the shell running it has
// exported (a CI job that also configures a running instance, for example). Drop every
// inherited setting, then set the few the tests rely on.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MOCK_') || key === 'HOST' || key === 'PORT') delete process.env[key];
}

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      MOCK_RESPONSE_VALIDATION: 'strict',
      MOCK_TIMEOUT_FAULT_MS: '50',
      MOCK_CLOCK: 'frozen',
      MOCK_CLOCK_START: '2026-03-02T09:00:00Z',
    },
    testTimeout: 20_000,
  },
});
