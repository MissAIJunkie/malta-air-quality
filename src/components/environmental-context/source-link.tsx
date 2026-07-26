import { ExternalLink } from 'lucide-react';

import { isSafeExternalLink } from '@/lib/security/allowlist';
import { getDictionary, t, type Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';

/**
 * A citation the reader can follow, or plain text when it cannot be trusted.
 *
 * Shared by the context cards, the forecast panel and the AI explanation,
 * because all three cite sources that originate outside maqua.app and all three
 * therefore face the same problem: a URL arriving on a third-party feed may be
 * `javascript:`, `data:` or carry embedded credentials. `isSafeExternalLink`
 * refuses anything that is not plain HTTPS; a refused URL degrades to the
 * source's NAME rather than disappearing, so the attribution survives even when
 * the link does not.
 *
 * `rel="noopener noreferrer"` accompanies every `target="_blank"`, and the
 * "opens in a new window" warning is announced rather than left as an icon —
 * an unexpected new tab is disorienting, and more so when it is not announced.
 */
export type SourceLinkProps = {
  name: string;
  url?: string | null;
  /** Rendered before the name, e.g. "Source:". */
  prefix?: string;
  dict?: Dictionary;
  className?: string;
};

export function SourceLink({
  name,
  url,
  prefix,
  dict = getDictionary(),
  className,
}: SourceLinkProps) {
  const safe = typeof url === 'string' && isSafeExternalLink(url);

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-1 text-xs', className)}>
      {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
      {safe ? (
        <a
          href={url as string}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 underline decoration-from-font underline-offset-2"
        >
          {name}
          <ExternalLink className="size-3 shrink-0 self-center" aria-hidden="true" />
          <span className="sr-only"> ({t(dict, 'a11y.newWindow')})</span>
        </a>
      ) : (
        <span>{name}</span>
      )}
    </span>
  );
}
