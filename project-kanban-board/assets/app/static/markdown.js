/* Safe Markdown subset for descriptions and comments.
 *
 * Everything is HTML-escaped first. A fixed set of constructs is then turned
 * back into markup. Each generated tag (code, image, link) is swapped for an
 * inert placeholder as soon as it is made, so later rules (auto-linking,
 * emphasis) never see or rewrite text inside a generated tag's attributes.
 * Images may only point at uploads/; links only at http(s) or mailto.
 *
 * Loaded by the browser (window.KanbanMarkdown) and by the smoke test under
 * Node (module.exports), so the security checks exercise the real code.
 */
'use strict';
(function (root) {
  const OPEN = '\u0001';
  const CLOSE = '\u0002';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function safeImage(url) {
    return /^\/?uploads\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(url) ? url.replace(/^\//, '') : null;
  }

  function safeLink(url) {
    // url is already escaped, so it contains no quotes or angle brackets.
    return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
  }

  function inline(text) {
    // Control characters used as placeholder markers cannot come from the user.
    let s = escapeHtml(String(text).replace(/[\u0001\u0002]/g, ''));
    const stash = [];
    const keep = (html) => { stash.push(html); return OPEN + (stash.length - 1) + CLOSE; };
    // Plain text inside a generated tag must not be processed again either.
    const plain = (t) => t.replace(new RegExp(OPEN + '(\\d+)' + CLOSE, 'g'), (_, i) => stash[Number(i)]);

    s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
      const u = safeImage(url);
      return keep(u
        ? `<a href="${u}" target="_blank" rel="noopener noreferrer" class="img-link"><img src="${u}" alt="${plain(alt).replace(/<[^>]*>/g, '')}" loading="lazy"></a>`
        : '<span class="blocked-img">[image not shown: only attached images are displayed]</span>');
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const u = safeLink(url);
      return u ? keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${plain(label)}</a>`) : label;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<\u0001\u0002]+[^\s<.,;:)\u0001\u0002])/g,
      (_, pre, url) => pre + keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // Restore repeatedly: a stashed link label may itself contain stashed code.
    for (let n = 0; n < 3 && s.includes(OPEN); n += 1) s = plain(s);
    return s;
  }

  function renderMarkdown(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const isBlockStart = (l) => /^(```|#{1,4}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,})\s*$)/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^```\s*([\w-]*)\s*$/);
      if (fence) {
        const body = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i += 1;
        const code = escapeHtml(body.join('\n'));
        out.push(fence[1].toLowerCase() === 'mermaid'
          ? `<div class="mermaid-block"><pre class="mermaid-src">${code}</pre></div>`
          : `<pre><code>${code}</code></pre>`);
        continue;
      }
      if (!line.trim()) { i += 1; continue; }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 2, 6);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
      if (/^>\s?/.test(line)) {
        const body = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
        const items = [];
        while (i < lines.length && re.test(lines[i])) {
          let text = lines[i++].replace(re, '');
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) text += ' ' + lines[i++].trim();
          const task = text.match(/^\[([ xX])\]\s+(.*)$/);
          items.push(task
            ? `<li class="task-item"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${inline(task[2])}</li>`
            : `<li>${inline(text)}</li>`);
        }
        out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(inline(lines[i++]));
      if (!para.length) para.push(inline(lines[i++]));
      out.push(`<p>${para.join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  const api = { renderMarkdown, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KanbanMarkdown = api;
}(typeof window !== 'undefined' ? window : globalThis));
