import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AirQualityExplanation } from '@/lib/ai/schemas';

import { ExplainButton } from '../explain-button';
import { AI_GENERATED_NOTICE } from '../explanation-panel';

/**
 * The branch that matters most here is provenance.
 *
 * `/api/explain` answers 200 whether a model wrote the text or the
 * deterministic builder did, and in any deployment without an
 * `OPENROUTER_API_KEY` the deterministic path is the ONLY path. Labelling that
 * output "AI-generated" would be a false claim on every page view, so it is
 * asserted in both directions rather than left to review.
 */

const DETERMINISTIC: AirQualityExplanation = {
  headline: 'Air quality at Msida is Fair',
  summary:
    'The station reported four pollutants for this hour, and the highest sub-index came from fine particulate matter.',
  contributingFactors: [
    { label: 'Fine particulate matter set the band', impact: 'unknown', confidence: 'medium' },
  ],
  uncertainty: 'A single hour cannot describe a day, and near-real-time values may be revised.',
  sourceIds: ['obs.pm25', 'method.european-aqi'],
};

const FROM_MODEL: AirQualityExplanation = {
  ...DETERMINISTIC,
  headline: 'Fine particles are leading the index at Msida',
};

const DISCLAIMER =
  'maqua.app provides general environmental information and does not replace medical advice or official emergency guidance.';

function renderButton() {
  return render(
    <ExplainButton
      stationId="msida"
      stationName="Msida"
      sourceLabels={{ 'obs.pm25': 'PM2.5 measurement at Msida' }}
      fallback={DETERMINISTIC}
      disclaimer={DISCLAIMER}
    />,
  );
}

function respondWith(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExplainButton', () => {
  it('requests nothing until asked', () => {
    const fetchMock = respondWith({});
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderButton();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(AI_GENERATED_NOTICE);
  });

  it('carries the AI notice when a model wrote the text', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        data: {
          explanation: FROM_MODEL,
          generated: 'ai',
          generatedAt: '2026-07-26T09:00:00.000Z',
          model: 'test-model',
          cached: false,
          disclaimer: DISCLAIMER,
        },
      }),
    );

    const { container } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() => expect(screen.getByText(FROM_MODEL.headline)).toBeInTheDocument());
    // Asserted on the rendered text rather than on one element: the notice
    // shares its paragraph with the "never calculates" caveat.
    expect(container.textContent).toContain(AI_GENERATED_NOTICE);
  });

  it('does NOT claim AI authorship when the endpoint fell back', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        data: {
          explanation: DETERMINISTIC,
          generated: 'fallback',
          generatedAt: '2026-07-26T09:00:00.000Z',
          cached: false,
          disclaimer: DISCLAIMER,
        },
      }),
    );

    const { container } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() => expect(screen.getByText(DETERMINISTIC.headline)).toBeInTheDocument());
    expect(container.textContent).not.toContain(AI_GENERATED_NOTICE);
    expect(container.textContent).toContain('No AI was involved');
  });

  it('offers "ask again" only for an AI answer', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        data: {
          explanation: DETERMINISTIC,
          generated: 'fallback',
          generatedAt: '2026-07-26T09:00:00.000Z',
          disclaimer: DISCLAIMER,
        },
      }),
    );

    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() => expect(screen.getByText(DETERMINISTIC.headline)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ask again/i })).toBeNull();
  });

  it('says it was rate limited and still explains the reading', async () => {
    vi.stubGlobal('fetch', respondWith({ error: { code: 'rate_limited' } }, 429));

    const { container } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() =>
      expect(screen.getByText(/asked for several explanations/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(DETERMINISTIC.headline)).toBeInTheDocument();
    expect(container.textContent).not.toContain(AI_GENERATED_NOTICE);
  });

  it('renders the deterministic explanation rather than an error when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { container } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() => expect(screen.getByText(DETERMINISTIC.headline)).toBeInTheDocument());
    expect(screen.queryByText(/could not be prepared/i)).toBeNull();
    expect(container.textContent).not.toContain(AI_GENERATED_NOTICE);
  });

  it('falls back when the response is a server error', async () => {
    vi.stubGlobal('fetch', respondWith({ error: { code: 'internal_error' } }, 500));

    const { container } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() => expect(screen.getByText(DETERMINISTIC.headline)).toBeInTheDocument());
    expect(container.textContent).not.toContain(AI_GENERATED_NOTICE);
  });

  it('writes the completed answer into a polite live region', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        data: {
          explanation: DETERMINISTIC,
          generated: 'fallback',
          generatedAt: '2026-07-26T09:00:00.000Z',
          disclaimer: DISCLAIMER,
        },
      }),
    );

    const { container } = renderButton();
    // The region exists before the request, which is what makes the update
    // announceable at all.
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));
    await waitFor(() => expect(region?.textContent).toContain(DETERMINISTIC.headline));
    expect(region?.textContent).toContain(DISCLAIMER);
  });

  it('resolves citations to their human labels', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        data: {
          explanation: DETERMINISTIC,
          generated: 'fallback',
          generatedAt: '2026-07-26T09:00:00.000Z',
          disclaimer: DISCLAIMER,
        },
      }),
    );

    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /Explain in plain language/i }));

    await waitFor(() => expect(screen.getByText('PM2.5 measurement at Msida')).toBeInTheDocument());
    // An id with no label is printed rather than dropped: an unresolved
    // citation is still a citation.
    expect(screen.getByText('method.european-aqi')).toBeInTheDocument();
  });
});
