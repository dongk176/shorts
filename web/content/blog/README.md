# Official EasyCut blog content

`posts.json` is the versioned editorial source for `/blog` and `/blog/[slug]`.
The first collection contains 32 EasyCut articles prepared for the Naver blog:
5 beginner posts, 5 comparison posts, 10 use-case guides, and 12 editing/budget
guides. The old private music-academy archive is excluded. Naver publication and
reservation state is independent of official-site publication.

## Maintaining posts

- Keep existing slugs stable. Each slug has its own self-canonical public URL.
- Set the actual official-site publication date once. Update `updatedAt` only
  for material changes, and `verifiedAt` when facts have actually been checked.
- Keep the title, concise description, cover, visible author/date, source links,
  and BlogPosting metadata consistent. No invented reviews or rating schema.
- The author is EasyCut's operating team, not an independent reviewer.
- `blocks` contain either a local image or reviewed, sanitized HTML. Allowed
  HTML is p/h2/h3/strong/em/ul/ol/li/table/thead/tbody/tr/th/td/a/br/blockquote.
  Only section IDs and trusted HTTPS/internal anchor URLs are allowed as
  attributes. Do not paste scripts, styles, event handlers, or unreviewed HTML.
- For every heading, maintain a matching unique `toc` entry. Use semantic table
  headers for new tables. Keep meaningful information in text, not just images.
- Images live in `public/blog/media` with content-addressed names, dimensions,
  descriptive alt text, and captions. Captions distinguish actual captures,
  rendered output, AI-generated illustrations, and synthetic comments/demo data.
- Never include account details, mailbox chrome, internal project identifiers,
  local file paths, or private evidence files in public assets or prose.
- Price comparisons must match billing period, total payment, and recurring
  source-minute quota. The first migration revises six older Basic comparisons
  because public and logged-in AlphaCut prices differed on 2026-09-13.
- Development-history dates are not proof of first public release or copying.
  Preserve the type and limits of the supporting evidence in visible text.

The sitemap automatically includes the index and every post. The site header
and sidebar intentionally have no blog entry until the owner requests one.
Blog pages use the existing desktop sidebar and skip product announcement
overlays. Public access does not depend on client-side hydration or sign-in.
