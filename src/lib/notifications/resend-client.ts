/**
 * Email transport (Resend).
 *
 * Optional, like every other external service here. `RESEND_API_KEY` absent
 * means the alerts feature reports itself as unavailable — it does not mean the
 * app fails to boot, and it does not mean a form that appears to work but
 * silently drops addresses.
 *
 * Nothing in this module throws. A send either succeeds or returns a described
 * failure, because a failed alert must be recorded in `alert_deliveries` and
 * retried later, never surfaced as a 500 to whoever happened to trigger the job.
 */

import 'server-only';

import { Resend } from 'resend';

import { getEnv } from '@/config/env';
import { logger } from '@/lib/monitoring/logger';
import { isTokenSecretConfigured } from './tokens';

let client: Resend | null = null;

/**
 * Whether this deployment can actually send alert email.
 *
 * Requires BOTH an API key and `ALERT_TOKEN_SECRET`. Sending without a token
 * secret would mean sending mail nobody could unsubscribe from, so the two are
 * treated as one capability rather than two — matching `getCapabilities().email`.
 */
export function isEmailConfigured(): boolean {
  return Boolean(getEnv().RESEND_API_KEY) && isTokenSecretConfigured();
}

/** The Resend client, or `null` when email is not configured. */
export function getResendClient(): Resend | null {
  if (client) return client;

  const key = getEnv().RESEND_API_KEY;
  if (!key) return null;

  try {
    client = new Resend(key);
    return client;
  } catch (error) {
    logger.error('email.client_init_failed', { error: String(error) });
    return null;
  }
}

export type SendEmailInput = {
  to: string;
  subject: string;
  /**
   * Plain text body. REQUIRED, not optional.
   *
   * An air-quality warning has to be readable in a client with images and HTML
   * disabled, and the text part is also what screen readers and the many mail
   * clients that strip CSS fall back to.
   */
  text: string;
  html: string;
  /**
   * One-click unsubscribe URL.
   *
   * Emitted as `List-Unsubscribe` plus `List-Unsubscribe-Post`, which is what
   * lets a mail client offer its own unsubscribe button. Gmail and Yahoo require
   * it for bulk senders, and it is the difference between someone unsubscribing
   * and someone reporting the message as spam.
   */
  unsubscribeUrl?: string;
  /** Groups related messages in the Resend dashboard. */
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: 'not_configured' | 'provider_error'; error?: string };

/**
 * Send one message.
 *
 * Never throws. The recipient address is not logged — an address in a log drain
 * is still personal data — only the outcome and, on failure, the provider's
 * message.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const resend = getResendClient();
  if (!resend) return { sent: false, reason: 'not_configured' };

  const env = getEnv();
  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  try {
    const response = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    });

    if (response.error) {
      logger.warn('email.send_failed', {
        subject: input.subject,
        error: response.error.message,
      });
      return { sent: false, reason: 'provider_error', error: response.error.message };
    }

    logger.info('email.sent', { subject: input.subject, messageId: response.data?.id ?? null });
    return { sent: true, messageId: response.data?.id ?? null };
  } catch (error) {
    logger.error('email.send_threw', { subject: input.subject, error: String(error) });
    return { sent: false, reason: 'provider_error', error: String(error) };
  }
}

/** Test hook. */
export function resetResendClient(): void {
  client = null;
}
