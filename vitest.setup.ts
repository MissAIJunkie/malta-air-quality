import '@testing-library/jest-dom/vitest';

// The full UI and test suite must run with no live services. Any test that
// reaches for a real credential is a bug, so we pin deterministic values.
process.env.AIR_QUALITY_PROVIDER ??= 'fixture';
process.env.AI_EXPLANATIONS_ENABLED ??= 'false';
process.env.NEXT_PUBLIC_APP_URL ??= 'https://maqua.app';
