/**
 * The offline banner is the only thing standing between a cached reading and a
 * reader who believes it is current, so what it says is a product requirement
 * rather than a presentational detail. These tests pin the four facts it must
 * state: that the device is offline, when the readings were measured, when this
 * device downloaded them, and that they are not live.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfflineIndicator } from '../offline-indicator';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/pwa/register', () => ({
  registerServiceWorker: vi.fn(async () => null),
}));

const readCachedReadings = vi.fn();

vi.mock('@/lib/pwa/offline', () => ({
  readCachedReadings: (...args: unknown[]) => readCachedReadings(...args),
}));

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

afterEach(() => {
  setOnline(true);
  readCachedReadings.mockReset();
});

describe('OfflineIndicator', () => {
  it('renders nothing while the connection is up', () => {
    setOnline(true);
    readCachedReadings.mockResolvedValue(null);

    const { container } = render(<OfflineIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it('states the measured and downloaded instants, and that the data is not live', async () => {
    setOnline(false);
    readCachedReadings.mockResolvedValue({
      measuredAt: '2026-07-26T09:00:00.000Z',
      downloadedAt: '2026-07-26T10:15:00.000Z',
      fromCache: true,
    });

    render(<OfflineIndicator />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('You appear to be offline')).toBeInTheDocument();
    expect(
      screen.getByText('Readings cannot be refreshed until the connection returns.'),
    ).toBeInTheDocument();

    // The status is stated in words, never by colour alone.
    expect(screen.getByText('Not live')).toBeInTheDocument();

    await waitFor(() => {
      // Malta is UTC+2 in July, so 09:00Z is 11:00 local.
      expect(screen.getByText(/measured at Sun 26 Jul, 11:00/i)).toBeInTheDocument();
    });

    // The download instant, which is a different fact from the measurement.
    const downloaded = screen.getByText(/Sun 26 Jul, 12:15/);
    expect(downloaded).toBeInTheDocument();
    expect(downloaded).toHaveAttribute('datetime', '2026-07-26T10:15:00.000Z');
  });

  it('still warns when nothing has been downloaded, without implying clean air', async () => {
    setOnline(false);
    readCachedReadings.mockResolvedValue(null);

    render(<OfflineIndicator />);

    expect(screen.getByText('You appear to be offline')).toBeInTheDocument();
    expect(screen.getByText('Not live')).toBeInTheDocument();

    // No measurement is claimed, and no figure is invented in its place.
    await waitFor(() => {
      expect(screen.queryByText(/measured at/i)).not.toBeInTheDocument();
    });
  });

  it('offers a retry control that is reachable and large enough to hit', () => {
    setOnline(false);
    readCachedReadings.mockResolvedValue(null);

    render(<OfflineIndicator />);

    const retry = screen.getByRole('button', { name: /try again/i });
    expect(retry).toBeEnabled();
    // Every button size in the design system is at least 44px tall.
    expect(retry.className).toMatch(/\bh-11\b/);
  });
});
