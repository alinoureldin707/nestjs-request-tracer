/**
 * The viewer page: recent requests on the left, the selected request's call
 * tree on the right with each call's arguments, result, error and timing.
 * Self-contained — no external script or stylesheet.
 */
export const VIEWER_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Request traces</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --line: #e3e6eb; --text: #1b1f24;
    --muted: #6a737d; --hover: #f0f3f7; --selected: #e7effc;
    --accent: #2f6fe4; --ok: #1f8a4c; --warn: #b7791f; --err: #c93c37;
    --bar: #c9d8f5; --code: #f3f5f8;
    --k-handler: #6f42c1; --k-provider: #2f6fe4; --k-http: #d9480f;
    --k-prisma: #0b7285; --k-cache: #5c940d; --k-custom: #868e96;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216; --panel: #161a20; --line: #262c35; --text: #e6e9ee;
      --muted: #8b949e; --hover: #1c222a; --selected: #1d2a40;
      --accent: #6ea0ff; --ok: #4cc38a; --warn: #e3b341; --err: #ff7b72;
      --bar: #2a3f66; --code: #11151a;
      --k-handler: #b392f0; --k-provider: #6ea0ff; --k-http: #ff9e64;
      --k-prisma: #4fc1d1; --k-cache: #9bd35a; --k-custom: #adb5bd;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .app { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; height: 100vh; }
  aside { border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  main { min-width: 0; min-height: 0; overflow: auto; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .toolbar h1 { font-size: 14px; margin: 0 auto 0 0; }
  input[type=search] {
    width: 100%; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--bg); color: var(--text); font: inherit;
  }
  button, label.toggle {
    font: inherit; font-size: 12px; padding: 5px 9px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--line); background: var(--panel); color: var(--text);
  }
  button:hover, label.toggle:hover { background: var(--hover); }
  label.toggle { display: inline-flex; gap: 6px; align-items: center; }
  .filter { padding: 8px 12px; border-bottom: 1px solid var(--line); }
  .list { overflow: auto; flex: 1; }
  .item { padding: 9px 12px; border-bottom: 1px solid var(--line); cursor: pointer; display: grid; gap: 2px; }
  .item:hover { background: var(--hover); }
  .item.selected { background: var(--selected); }
  .row1 { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
  .method { font-weight: 600; font-size: 11px; color: var(--muted); width: 48px; flex: none; }
  .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .status { font-weight: 600; font-variant-numeric: tabular-nums; }
  .s2 { color: var(--ok); } .s4 { color: var(--warn); } .s5, .sx { color: var(--err); } .sp { color: var(--muted); }
  .row2 { display: flex; gap: 10px; color: var(--muted); font-size: 11px; padding-left: 56px; }
  .row2 .err { color: var(--err); }
  .empty { padding: 40px 20px; color: var(--muted); text-align: center; }
  .detail-head { padding: 16px 20px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 1; }
  .detail-head h2 { margin: 0 0 6px; font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
  .meta { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 12px; align-items: center; }
  .meta .actions { margin-left: auto; display: flex; gap: 6px; }
  .tree { padding: 8px 0 40px; }
  .node > .line {
    display: grid; grid-template-columns: 1fr 180px; gap: 12px; align-items: center;
    padding: 3px 20px 3px 0; cursor: pointer; border-left: 3px solid transparent;
  }
  .node > .line:hover { background: var(--hover); }
  .node.open > .line { background: var(--selected); border-left-color: var(--accent); }
  .label { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
  .chev { width: 14px; flex: none; color: var(--muted); text-align: center; font-size: 10px; }
  .kind { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; padding: 1px 5px; border-radius: 4px; color: #fff; flex: none; }
  .k-handler { background: var(--k-handler); } .k-provider { background: var(--k-provider); }
  .k-http { background: var(--k-http); } .k-prisma { background: var(--k-prisma); } .k-cache { background: var(--k-cache); } .k-custom { background: var(--k-custom); }
  .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .name .cls { color: var(--muted); }
  .badge-err { color: var(--err); font-weight: 600; font-size: 11px; flex: none; }
  .timing { display: flex; align-items: center; gap: 8px; }
  .track { flex: 1; height: 6px; position: relative; background: var(--code); border-radius: 3px; }
  .bar { position: absolute; top: 0; bottom: 0; background: var(--bar); border-radius: 3px; min-width: 2px; }
  .bar.e { background: var(--err); opacity: .55; }
  .ms { width: 56px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 11px; }
  .details { display: none; padding: 6px 20px 12px; }
  .node.open > .details { display: grid; gap: 10px; }
  .details h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); display: flex; gap: 8px; align-items: center; }
  .details h4 button { padding: 1px 6px; font-size: 10px; }
  pre {
    margin: 0; padding: 10px 12px; background: var(--code); border: 1px solid var(--line); border-radius: 6px;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: auto; max-height: 420px; white-space: pre-wrap; word-break: break-word;
  }
  pre.error { border-color: var(--err); }
  .j-key { color: var(--accent); } .j-str { color: var(--ok); } .j-num { color: var(--k-http); }
  .j-bool, .j-null { color: var(--k-handler); } .j-red { color: var(--err); font-weight: 600; }
  .note { color: var(--muted); font-size: 12px; padding: 4px 20px; }
  @media (max-width: 760px) {
    .app { grid-template-columns: 1fr; grid-template-rows: 40vh 1fr; }
    aside { border-right: 0; border-bottom: 1px solid var(--line); }
    .node > .line { grid-template-columns: 1fr 90px; }
    .track { display: none; }
  }
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="toolbar">
      <h1>Request traces</h1>
      <label class="toggle"><input type="checkbox" id="live" checked> Live</label>
      <button id="clear" title="Forget every recorded request">Clear</button>
    </div>
    <div class="filter"><input type="search" id="filter" placeholder="Filter by path, handler, status, error…" autocomplete="off"></div>
    <div class="list" id="list"><div class="empty">Loading…</div></div>
  </aside>
  <main id="detail"><div class="empty">Select a request to see every call it made.</div></main>
</div>
<script>
(() => {
  const listEl = document.getElementById('list');
  const detailEl = document.getElementById('detail');
  const filterEl = document.getElementById('filter');
  const liveEl = document.getElementById('live');
  let summaries = [];
  let selectedId = location.hash.slice(1) || null;
  let current = null;
  const open = new Set();
  const api = location.pathname.replace(/[/]+$/, '') + '/data';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statusClass = (t) => t.state === 'pending' ? 'sp' : t.statusCode == null ? 'sx' : 's' + String(t.statusCode)[0];
  const statusText = (t) => t.state === 'pending' ? '…' : t.state === 'aborted' ? 'aborted' : t.statusCode;
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function highlight(value) {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) return '<span class="j-null">undefined</span>';
    return esc(json).replace(
      /(&quot;(?:\\\\.|[^&]|&(?!quot;))*?&quot;)(\\s*:)?|\\b(true|false)\\b|\\bnull\\b|-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?/gi,
      (m, str, colon, bool) => {
        if (str) {
          if (colon) return '<span class="j-key">' + str + '</span>' + colon;
          if (str === '&quot;[REDACTED]&quot;') return '<span class="j-red">' + str + '</span>';
          return '<span class="j-str">' + str + '</span>';
        }
        if (bool) return '<span class="j-bool">' + m + '</span>';
        if (m === 'null') return '<span class="j-null">null</span>';
        return '<span class="j-num">' + m + '</span>';
      });
  }

  function renderList() {
    const q = filterEl.value.trim().toLowerCase();
    const shown = summaries.filter((t) => !q ||
      [t.method, t.url, t.route, t.handler, t.statusCode, t.error, t.state].join(' ').toLowerCase().includes(q));
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty">' + (summaries.length ? 'No request matches.' : 'No request yet. Call the API and it shows up here.') + '</div>';
      return;
    }
    listEl.innerHTML = shown.map((t) =>
      '<div class="item' + (t.id === selectedId ? ' selected' : '') + '" data-id="' + esc(t.id) + '">' +
        '<div class="row1"><span class="method">' + esc(t.method) + '</span>' +
        '<span class="path" title="' + esc(t.url) + '">' + esc(t.url) + '</span>' +
        '<span class="status ' + statusClass(t) + '">' + esc(statusText(t)) + '</span></div>' +
        '<div class="row2"><span>' + time(t.startedAt) + '</span>' +
        '<span>' + (t.durationMs != null ? t.durationMs + ' ms' : '') + '</span>' +
        '<span>' + t.nodeCount + ' calls</span>' +
        (t.error ? '<span class="err">' + esc(t.error) + '</span>' : '') + '</div>' +
      '</div>').join('');
  }

  function splitLabel(label) {
    const i = label.lastIndexOf('.');
    if (i < 0 || label.includes(' ')) return esc(label);
    return '<span class="cls">' + esc(label.slice(0, i + 1)) + '</span>' + esc(label.slice(i + 1));
  }

  function renderNode(node, depth, total) {
    const hasKids = node.children.length > 0;
    const isOpen = open.has(node.id);
    const start = total ? (node.startMs / total) * 100 : 0;
    const width = total && node.durationMs != null ? Math.max((node.durationMs / total) * 100, 0.4) : 0.4;
    const section = (title, value, cls) => value === undefined ? '' :
      '<div><h4>' + title + ' <button data-copy="' + node.id + ':' + title + '">copy</button></h4>' +
      '<pre class="' + (cls || '') + '">' + highlight(value) + '</pre></div>';
    return '<div class="node' + (isOpen ? ' open' : '') + '" data-node="' + node.id + '">' +
      '<div class="line"><div class="label" style="padding-left:' + (12 + depth * 18) + 'px">' +
        '<span class="chev">' + (hasKids ? '▸' : '·') + '</span>' +
        '<span class="kind k-' + node.kind + '">' + node.kind + '</span>' +
        '<span class="name" title="' + esc(node.label) + '">' + splitLabel(node.label) + '</span>' +
        (node.error ? '<span class="badge-err">✗ ' + esc(node.error.name || 'error') + '</span>' : '') +
      '</div><div class="timing"><div class="track"><div class="bar' + (node.error ? ' e' : '') + '" style="left:' + start + '%;width:' + width + '%"></div></div>' +
      '<span class="ms">' + (node.durationMs != null ? node.durationMs + ' ms' : 'pending') + '</span></div></div>' +
      '<div class="details">' + section('Arguments', node.args) + section('Result', node.result) + section('Error', node.error, 'error') +
        (node.args === undefined && node.result === undefined && node.error === undefined ? '<div class="note">No arguments, no result.</div>' : '') +
      '</div>' +
      node.children.map((c) => renderNode(c, depth + 1, total)).join('') +
    '</div>';
  }

  function findNode(node, id) {
    if (node.id === id) return node;
    for (const c of node.children) { const f = findNode(c, id); if (f) return f; }
    return null;
  }

  function allIds(node, acc = []) { acc.push(node.id); node.children.forEach((c) => allIds(c, acc)); return acc; }

  function renderDetail() {
    if (!current) { detailEl.innerHTML = '<div class="empty">Select a request to see every call it made.</div>'; return; }
    const t = current;
    detailEl.innerHTML =
      '<div class="detail-head"><h2>' + esc(t.method) + ' ' + esc(t.url) + '</h2>' +
      '<div class="meta"><span class="status ' + statusClass(t) + '">' + esc(statusText(t)) + '</span>' +
      '<span>' + esc(t.handler) + '</span>' + (t.route ? '<span>route ' + esc(t.route) + '</span>' : '') +
      '<span>' + (t.durationMs != null ? t.durationMs + ' ms' : 'running') + '</span>' +
      '<span>' + t.nodeCount + ' calls</span><span>' + new Date(t.startedAt).toLocaleString() + '</span>' +
      '<span class="actions"><button id="expand">Expand all</button><button id="collapse">Collapse all</button><button id="copy-all">Copy JSON</button></span></div></div>' +
      (t.droppedNodes ? '<div class="note">' + t.droppedNodes + ' further calls were not recorded (trace size limit).</div>' : '') +
      '<div class="tree">' + renderNode(t.root, 0, t.durationMs || t.root.durationMs || 0) + '</div>';
  }

  async function loadList() {
    try {
      const res = await fetch(api, { cache: 'no-store' });
      summaries = await res.json();
      renderList();
      const sel = summaries.find((t) => t.id === selectedId);
      if (sel && current && (sel.state !== current.state || sel.nodeCount !== current.nodeCount)) loadDetail(selectedId);
    } catch { listEl.innerHTML = '<div class="empty">Backend unreachable.</div>'; }
  }

  async function loadDetail(id) {
    const res = await fetch(api + '/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!res.ok) { current = null; renderDetail(); return; }
    const isNew = !current || current.id !== id;
    current = await res.json();
    if (isNew) { open.clear(); open.add(0); }
    renderDetail();
  }

  function select(id) {
    selectedId = id;
    history.replaceState(null, '', '#' + id);
    renderList();
    loadDetail(id);
  }

  listEl.addEventListener('click', (e) => { const item = e.target.closest('.item'); if (item) select(item.dataset.id); });
  filterEl.addEventListener('input', renderList);
  document.getElementById('clear').addEventListener('click', async () => {
    await fetch(api, { method: 'DELETE' });
    selectedId = null; current = null; history.replaceState(null, '', location.pathname);
    renderDetail(); loadList();
  });
  detailEl.addEventListener('click', (e) => {
    if (!current) return;
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const [id, title] = copy.dataset.copy.split(':');
      const node = findNode(current.root, Number(id));
      const value = { Arguments: node.args, Result: node.result, Error: node.error }[title];
      navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      copy.textContent = 'copied'; setTimeout(() => { copy.textContent = 'copy'; }, 1000);
      return;
    }
    if (e.target.id === 'expand') { allIds(current.root).forEach((i) => open.add(i)); renderDetail(); return; }
    if (e.target.id === 'collapse') { open.clear(); renderDetail(); return; }
    if (e.target.id === 'copy-all') {
      navigator.clipboard.writeText(JSON.stringify(current, null, 2));
      e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy JSON'; }, 1000);
      return;
    }
    const line = e.target.closest('.line');
    if (line) {
      const id = Number(line.parentElement.dataset.node);
      open.has(id) ? open.delete(id) : open.add(id);
      line.parentElement.classList.toggle('open');
    }
  });

  loadList().then(() => { if (selectedId) loadDetail(selectedId); });
  setInterval(() => { if (liveEl.checked) loadList(); }, 2000);
})();
</script>
</body>
</html>
`;
