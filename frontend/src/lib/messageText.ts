// Message text for history views, without the formatting markers.
//
// A message reads like the printout instead of like markup: "# Hi" shows as
// "Hi", **bold** as bold's plain text, and a --- line as a short divider. The
// rules mirror client/layout.js, including which messages get formatted at
// all — ASCII art (sent with word wrap off) shows exactly as typed, just as it
// prints. The result is plain text; it's never rendered as HTML.

interface MessageLike {
  body?: string | null;
  word_wrap?: number;
  source?: string;
}

/** Whether the printer applied formatting to this message. */
function isFormatted(m: MessageLike): boolean {
  // The client always wraps API and email messages, whatever word_wrap says.
  if (m.source === 'api' || m.source === 'email') return true;
  // LEGACY(old-client): guest history saved before 4.0 has no word_wrap, so
  // show it as typed — remove once every printer reports a new client.
  return m.word_wrap !== undefined && m.word_wrap !== 0;
}

// Removes paired ** and __ markers. A marker without a partner later in the
// line stays, because the printer prints it too.
function stripInline(line: string): string {
  const parts = line.split(/(\*\*|__)/);
  const isMarker = (p: string) => p === '**' || p === '__';
  const remaining = { '**': 0, '__': 0 };
  for (const p of parts) if (isMarker(p)) remaining[p as '**' | '__']++;
  remaining['**'] -= remaining['**'] % 2;
  remaining['__'] -= remaining['__'] % 2;
  return parts
    .filter((p) => !(isMarker(p) && remaining[p as '**' | '__']-- > 0))
    .join('');
}

function plainText(body: string): string {
  return body.split(/\r?\n/).map((line) => {
    if (/^\s*-{3,}\s*$/.test(line)) return '───';
    const header = line.match(/^#{1,4}\s+(.+)$/);
    return stripInline(header ? header[1].trim() : line);
  }).join('\n');
}

/** A message's body as history should show it. */
export function displayBody(m: MessageLike): string | undefined {
  if (!m.body) return undefined;
  return isFormatted(m) ? plainText(m.body) : m.body;
}
