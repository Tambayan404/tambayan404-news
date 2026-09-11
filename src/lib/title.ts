/** Fetch a page title (og:title → <title>) with HTMLRewriter, cheap and streaming. */

const MAX_TITLE = 200;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

export async function fetchTitle(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; t404-news/1.0; +https://github.com/tambayan404/t404-news)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!/html|xml/.test(ct)) return null;

    let og = '';
    let title = '';
    const rewriter = new HTMLRewriter()
      .on('meta[property="og:title"], meta[name="twitter:title"]', {
        element(el) {
          if (!og) og = el.getAttribute('content') ?? '';
        },
      })
      .on('title', {
        text(t) {
          title += t.text;
        },
      });
    // Consume the (truncated) body so handlers run.
    const transformed = rewriter.transform(res);
    const reader = transformed.body?.getReader();
    if (reader) {
      let bytes = 0;
      while (bytes < 256 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (og && title) break;
      }
      await reader.cancel().catch(() => {});
    }
    const result = clean(og) || clean(title);
    return result || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
