/**
 * dsh-simple-memory-ui — client half (browser bundle).
 *
 * Injected by the DSH client module loader (`window.__ModuleLoader__.load`),
 * this contributes one **global panel** to the Web GUI: a sidebar row (「记忆」)
 * that opens a full central panel — the memory manager: reference + pending
 * items on the left, an editor for the selected item's body and index row on
 * the right; create, promote, archive and delete.
 *
 * Where it sits: the sidebar shell (@deepseek-ai/dsh-client-ui-sidebar) declares
 * the `sidebar.panellist` list for global panel icons, and the layout
 * (@deepseek-ai/dsh-client-ui-layout) hosts every such panel in its root
 * `main` keyed slot, dispatched by the entry id. A list id and its `main` key
 * are the same string, which is why PANEL_ID is registered in both places — the
 * row lands between the New Session button and the 工作区 section.
 *
 * Written with React.createElement (no JSX) so the bundle needs no build step:
 * the module loader already provides `react` and `react/jsx-runtime` as
 * platform seed words.
 *
 * Source: extends dsh-simple-wiki-memory (MIT) by rainow.
 */
(function () {
  'use strict';

  var API = '/dswm/api';

  /** List id in `sidebar.panellist`; also the key of the matching `main` cell. */
  var PANEL_ID = 'dswm-memory';

  /**
   * Panel state kept outside React: switching to the Conversation and back
   * unmounts this panel (the layout renders only the selected main cell), and a
   * half-typed memory should survive that round trip. Module scope lives as long
   * as the client plugin does, i.e. until the page reloads.
   */
  var CACHE = { list: null, sel: null, draft: null, base: null, creating: false, restored: false };

  /** fetch a JSON endpoint, throwing a readable Error on failure. */
  function call(path, options) {
    return fetch(API + path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
          return body;
        });
      });
  }

  function loadList() { return call('/list'); }
  function loadItem(kind, file) {
    return call('/get?kind=' + encodeURIComponent(kind) + '&file=' + encodeURIComponent(file));
  }
  function saveItem(payload) { return call('/save', { method: 'POST', body: JSON.stringify(payload) }); }
  function createItem(payload) { return call('/create', { method: 'POST', body: JSON.stringify(payload) }); }
  function archiveItem(payload) { return call('/archive', { method: 'POST', body: JSON.stringify(payload) }); }
  function promoteItem(payload) { return call('/promote', { method: 'POST', body: JSON.stringify(payload) }); }
  function deleteItem(payload) { return call('/delete', { method: 'POST', body: JSON.stringify(payload) }); }

  // Styling uses the GUI's own design-system tokens (`--dsw-*`, set by
  // @deepseek-ai/dsh-client-ui-theme) with plain fallbacks, so the panel follows
  // the light/dark theme and the app's type scale instead of inventing its own.
  var CSS = [
    /* ---------------------------------------------------------------- shell */
    // The panel is the whole center column: it owns its own header, scrolling
    // panes and footer, and must never make the frame grow. The center column
    // itself is painted `--dsw-alias-bg-base`, so match it.
    '.dswm-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.55;container-type:inline-size}',
    '.dswm-page *{box-sizing:border-box}',
    '.dswm-head{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:24px clamp(18px,3vw,32px) 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}',
    '.dswm-head-main{min-width:0}',
    '.dswm-h1{margin:0;font-size:20px;font-weight:500;line-height:28px}',
    '.dswm-sub{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dswm-head-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding-top:4px}',
    '.dswm-chip{font-size:12px;line-height:1.4;border-radius:999px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9))}',
    '.dswm-chip.warn{border-color:transparent;background:var(--dsw-alias-state-warn-tertiary,rgba(229,165,10,.16));color:var(--dsw-alias-state-warn-label,#8a6100)}',
    '.dswm-work{flex:1 1 auto;min-height:0;display:flex}',
    /* ------------------------------------------------------------ list pane */
    '.dswm-list{flex:0 0 272px;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04)))}',
    '.dswm-list-head{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}',
    '.dswm-list-actions{display:flex;gap:6px;align-items:center}',
    '.dswm-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:8px}',
    '.dswm-group{display:flex;align-items:center;gap:6px;margin:8px 4px 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption,rgba(127,127,127,.7))}',
    '.dswm-group .n{letter-spacing:0}',
    '.dswm-item{border-radius:var(--dsw-radius-sm,8px);padding:8px 10px;cursor:pointer;border:1px solid transparent}',
    '.dswm-item+.dswm-item{margin-top:2px}',
    '.dswm-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
    '.dswm-item.active{background:rgba(65,118,230,.14);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);border-color:rgba(65,118,230,.45);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}',
    '.dswm-item .t{display:flex;align-items:center;gap:6px;min-width:0;font-weight:600;font-size:13.5px}',
    '.dswm-item .t .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dswm-item .s{margin-top:2px;font-size:12.5px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dswm-item .m{display:flex;align-items:center;gap:8px;margin-top:3px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.6))}',
    '.dswm-item .m .file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}',
    '.dswm-item .m .grow{flex:1 1 auto}',
    '.dswm-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#e5a50a);flex:0 0 auto}',
    '.dswm-promote,.dswm-drop{border-radius:6px;padding:1px 7px;font-size:11px;line-height:1.6;cursor:pointer;flex:0 0 auto;font-family:inherit}',
    '.dswm-promote{border:1px solid rgba(65,118,230,.5);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,transparent);background:rgba(65,118,230,.14);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:inherit}',
    '.dswm-promote:hover{background:rgba(65,118,230,.3);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}',
    '.dswm-drop{border:1px solid rgba(229,72,77,.45);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:transparent;color:var(--dsw-alias-label-error,#e5484d)}',
    '.dswm-drop:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.16))}',
    '.dswm-promote[disabled],.dswm-drop[disabled]{opacity:.45;cursor:default}',
    /* ---------------------------------------------------------- detail pane */
    '.dswm-detail{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0}',
    '.dswm-detail-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:12px clamp(18px,3vw,32px) 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.12))}',
    '.dswm-title{min-width:0;font-weight:600;font-size:13.5px;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dswm-dirty{flex:0 0 auto;font-size:11.5px;color:var(--dsw-alias-state-warn-primary,#e5a50a)}',
    '.dswm-detail-scroll{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:16px clamp(18px,3vw,32px)}',
    '.dswm-detail-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px clamp(18px,3vw,32px);border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}',
    '.dswm-field{display:flex;gap:10px;align-items:flex-start}',
    '.dswm-field>label{flex:0 0 68px;padding-top:5px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85))}',
    '.dswm-field .ctl{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.dswm-fields{display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:0}',
    '.dswm-editor{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:240px}',
    '.dswm-editor>label{font-size:11.5px;color:var(--dsw-alias-label-caption,rgba(127,127,127,.6))}',
    /* ------------------------------------------------------------- controls */
    '.dswm-btn{border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));background:transparent;color:inherit;border-radius:var(--dsw-radius-sm,8px);padding:4px 11px;cursor:pointer;font-size:12.5px;font-family:inherit;white-space:nowrap;line-height:1.6}',
    '.dswm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
    '.dswm-btn[disabled]{opacity:.45;cursor:default}',
    '.dswm-btn[disabled]:hover{background:transparent}',
    '.dswm-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#111));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.dswm-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary,#333))}',
    '.dswm-btn.danger{color:var(--dsw-alias-label-error,#e5484d);border-color:rgba(229,72,77,.5);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent)}',
    '.dswm-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.14))}',
    '.dswm-btn.icon{padding:3px 8px}',
    '.dswm-input,.dswm-textarea,.dswm-search{width:100%;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-sm,8px);padding:5px 9px;color:inherit;font:inherit}',
    '.dswm-input,.dswm-search{font-size:13px}',
    '.dswm-input:focus,.dswm-textarea:focus,.dswm-search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}',
    '.dswm-textarea{flex:1 1 auto;min-height:240px;resize:vertical;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:13px;line-height:1.7;white-space:pre-wrap}',
    /* --------------------------------------------------------------- states */
    '.dswm-msg{flex:0 0 auto;margin:10px clamp(18px,3vw,32px) 0;padding:8px 11px;border-radius:var(--dsw-radius-sm,8px);font-size:12.5px}',
    '.dswm-msg.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}',
    '.dswm-msg.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}',
    '.dswm-empty{padding:24px 6px;text-align:center;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.65))}',
    '.dswm-empty.big{margin:auto;padding:40px 20px;max-width:440px}',
    '.dswm-empty .k{margin-bottom:4px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}',
    '.dswm-hint{font-size:11.5px;color:var(--dsw-alias-label-caption,rgba(127,127,127,.6))}',
    '.dswm-grow{flex:1 1 auto}',
    // In a narrow center column (or when the right bar squeezes it) stack the
    // panes. container-type on .dswm-page measures the space we actually get:
    // the viewport width says nothing about it, same trap the settings section
    // hit before.
    '@container (max-width:720px){.dswm-work{flex-direction:column}.dswm-list{flex:0 0 auto;max-height:42%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}.dswm-detail{flex:1 1 auto}}',
    // ------------------------------------------------- confirmation modal
    // Never use window.confirm() here: in the Electron desktop app a native
    // dialog leaves the window without renderer keyboard focus on Windows —
    // the caret vanishes and inputs cannot be focused again until the window
    // is deactivated and re-activated (minimize/restore). An in-panel modal
    // keeps the focus entirely inside the document.
    '.dswm-page{position:relative}',
    '.dswm-modal-backdrop{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.32)}',
    '.dswm-modal{width:min(430px,100%);display:flex;flex-direction:column;gap:14px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,inherit);box-shadow:0 18px 48px rgba(0,0,0,.3)}',
    '.dswm-modal-text{white-space:pre-wrap;font-size:13.5px;line-height:1.65}',
    '.dswm-modal-actions{display:flex;justify-content:flex-end;gap:8px}'
  ].join('\n');

  /** Inject the stylesheet once per document. */
  function ensureCss(doc) {
    if (doc.getElementById('dswm-style') !== null) return;
    var tag = doc.createElement('style');
    tag.id = 'dswm-style';
    tag.textContent = CSS;
    doc.head.appendChild(tag);
  }

  var ICON_D = [
    // an open book with a bookmark: "memory" without leaning on an emoji font
    'M3.4 4.6c1.9-.9 3.8-.9 5.7 0 .4.2.6.4.6.8v9.6c0 .5-.5.9-1 .6-1.5-.7-3-.7-4.5 0-.5.3-1-.1-1-.6V5.4c0-.3.1-.6.2-.8z',
    'M20.6 4.6c-1.9-.9-3.8-.9-5.7 0-.4.2-.6.4-.6.8v9.6c0 .5.5.9 1 .6 1.5-.7 3-.7 4.5 0 .5.3 1-.1 1-.6V5.4c0-.3-.1-.6-.2-.8z',
    'M12 5.4v10.2'
  ];

  window.__ModuleLoader__.load({
    id: 'dsh-simple-memory-ui',
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
      var react = require('react');
      var e = react.createElement;

      /** Small helper: an element with children, skipping nullish ones. */
      function h(tag, props) {
        var children = Array.prototype.slice.call(arguments, 2);
        return e.apply(null, [tag, props].concat(children));
      }

      /** Sidebar row glyph — receives the shell's `{ size, active }` owner props. */
      function MemoryIcon(props) {
        var size = (props && props.size) || 16;
        return h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: props && props.active ? 1.9 : 1.6,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false'
        }, ICON_D.map(function (d, i) { return h('path', { key: i, d: d }); }));
      }

      /** The memory panel: page header, list pane, editor pane. */
      function MemoryPanel() {
        ensureCss(document);
        var listState = react.useState(CACHE.list || { status: 'loading', items: [], total: 0 });
        var list = listState[0], setList = listState[1];
        var selState = react.useState(CACHE.sel);         // {kind, file}
        var sel = selState[0], setSel = selState[1];
        var draftState = react.useState(CACHE.draft);     // editable draft of the open item
        var draft = draftState[0], setDraft = draftState[1];
        var baseState = react.useState(CACHE.base);       // saved snapshot for dirty check
        var base = baseState[0], setBase = baseState[1];
        var msgState = react.useState(null);              // {kind:'ok'|'err', text}
        var msg = msgState[0], setMsg = msgState[1];
        var busyState = react.useState(false);
        var busy = busyState[0], setBusy = busyState[1];
        var creatingState = react.useState(CACHE.creating);
        var creating = creatingState[0], setCreating = creatingState[1];
        var queryState = react.useState('');
        var query = queryState[0], setQuery = queryState[1];

        /**
         * In-panel confirmation. Every destructive/irreversible action asks
         * through this instead of `window.confirm()`: a native dialog breaks
         * renderer keyboard focus in the Electron desktop app on Windows (no
         * caret, no focusable inputs until minimize/restore).
         * @param text - message shown in the modal.
         * @returns a promise resolving to true (determine) / false (cancel).
         */
        var askState = react.useState(null);
        var askBox = askState[0], setAskBox = askState[1];

        function ask(text) {
          return new Promise(function (resolve) {
            setAskBox({ text: text, resolve: resolve });
          });
        }

        function answerAsk(result) {
          if (askBox !== null) askBox.resolve(result);
          setAskBox(null);
        }

        // Write-through to the module cache so a panel switch does not lose state.
        react.useEffect(function () {
          CACHE.list = list; CACHE.sel = sel; CACHE.draft = draft;
          CACHE.base = base; CACHE.creating = creating;
        });

        var refresh = react.useCallback(function () {
          setList(function (s) { return Object.assign({}, s, { status: 'loading' }); });
          return loadList().then(function (res) {
            setList({ status: 'ready', items: res.items || [], total: res.total || 0 });
          }).catch(function (err) {
            setList({ status: 'error', items: [], total: 0, error: String(err.message || err) });
          });
        }, []);

        react.useEffect(function () { refresh(); }, [refresh]);

        var dirty = draft !== null && base !== null && (
          draft.title !== base.title || draft.summary !== base.summary ||
          draft.date !== base.date || draft.content !== base.content
        );

        /**
         * Open an item, loading its body and index row.
         * @param kind - 'reference' | 'pending'.
         * @param file - file name inside that directory.
         */
        function open(kind, file) {
          if (dirty) {
            ask('当前条目有未保存的修改，确定放弃并切换？').then(function (ok) { if (ok) openNow(kind, file); });
            return;
          }
          openNow(kind, file);
        }

        /** Load an item, assuming the unsaved-changes guard already passed. */
        function openNow(kind, file) {
          setMsg(null);
          setSel({ kind: kind, file: file });
          setDraft(null);
          setBase(null);
          loadItem(kind, file).then(function (res) {
            var next = {
              kind: res.kind, file: res.file, title: res.indexTitle || res.file.replace(/\.md$/, ''),
              summary: res.summary || '', date: res.date || '', content: res.content || '',
              // MUST be carried into the draft: the header renders its
              // "未写入索引" badge from draft.indexed, so dropping the field made
              // every opened item claim it was missing from the index.
              indexed: res.indexed !== false
            };
            setDraft(next);
            setBase(Object.assign({}, next));
          }).catch(function (err) {
            setMsg({ kind: 'err', text: '读取失败：' + String(err.message || err) });
          });
        }

        function patch(field, value) {
          setDraft(function (d) { return d === null ? d : Object.assign({}, d, { [field]: value }); });
        }

        /**
         * Persist a draft without touching any UI state.
         * Shared by the Save button and by actions that would replace the draft
         * (starting a new entry) — those auto-save instead of asking the user to
         * throw their edits away.
         * @returns a promise resolving to the save API result.
         */
        function persist(d) {
          return saveItem({
            kind: d.kind, file: d.file, title: d.title,
            summary: d.summary, date: d.date, content: d.content
          });
        }

        function doSave() {
          if (draft === null) return;
          if (String(draft.title).trim() === '') {
            setMsg({ kind: 'err', text: '标题不能为空（标题同时是文件名）' });
            return;
          }
          var snapshot = draft;
          setBusy(true);
          setMsg(null);
          persist(snapshot).then(function (res) {
            var renamed = res.file !== snapshot.file;
            var next = Object.assign({}, snapshot, { file: res.file });
            setDraft(next);
            setBase(Object.assign({}, next));
            setSel({ kind: next.kind, file: next.file });
            setMsg({ kind: 'ok', text: '已保存并提交 git' + (renamed ? '（文件已重命名为 ' + res.file + '）' : '') });
            return refresh();
          }).catch(function (err) {
            setMsg({ kind: 'err', text: '保存失败：' + String(err.message || err) });
          }).then(function () { setBusy(false); });
        }

        function doCreate() {
          if (draft === null) return;
          if (String(draft.title).trim() === '') {
            setMsg({ kind: 'err', text: '标题不能为空（标题同时是文件名）' });
            return;
          }
          setBusy(true);
          setMsg(null);
          createItem({
            kind: draft.kind, title: draft.title,
            summary: draft.summary, content: draft.content
          }).then(function (res) {
            setCreating(false);
            setMsg({ kind: 'ok', text: '已新建 ' + draft.kind + '/' + res.file });
            return refresh().then(function () { open(draft.kind, res.file); });
          }).catch(function (err) {
            setMsg({ kind: 'err', text: '新建失败：' + String(err.message || err) });
          }).then(function () { setBusy(false); });
        }

        function doArchive() {
          if (draft === null || creating) return;
          ask('将「' + draft.title + '」归档到 archive/？\n索引行会被移除（文件不删除，可 git 找回）。').then(function (ok) {
            if (!ok) return;
            setBusy(true);
            setMsg(null);
            archiveItem({ kind: draft.kind, file: draft.file }).then(function (res) {
              setDraft(null);
              setBase(null);
              setSel(null);
              setMsg({ kind: 'ok', text: '已归档为 ' + res.archived });
              return refresh();
            }).catch(function (err) {
              setMsg({ kind: 'err', text: '归档失败：' + String(err.message || err) });
            }).then(function () { setBusy(false); });
          });
        }

        /**
         * 「确认加入记忆」: promote a pending draft into reference/.
         * If the draft has unsaved edits they are written first, so the promoted
         * file always matches what the user is looking at.
         */
        function doPromote() {
          if (draft === null || creating) return;
          ask('把「' + draft.title + '」从待确认晋升为正式记忆？\n会移入 reference/、写入 AGENTS.md 索引、记 memory-log 并 git commit。').then(function (ok) {
            if (!ok) return;
            setBusy(true);
            setMsg(null);
            var step = dirty
              ? saveItem({
                  kind: draft.kind, file: draft.file, title: draft.title,
                  summary: draft.summary, date: draft.date, content: draft.content
                })
              : Promise.resolve(null);
            step.then(function (saved) {
              var file = saved && saved.file ? saved.file : draft.file;
              return promoteItem({ file: file });
            }).then(function (res) {
              setMsg({ kind: 'ok', text: '已晋升为正式记忆 reference/' + res.file + (res.already ? '（原本已是正式记忆）' : '') });
              return refresh().then(function () { open('reference', res.file); });
            }).catch(function (err) {
              setMsg({ kind: 'err', text: '晋升失败：' + String(err.message || err) });
            }).then(function () { setBusy(false); });
          });
        }

        /** Promote straight from the list (no need to open the editor first). */
        function promoteFile(kind, file, title) {
          if (kind !== 'pending') return;
          ask('把「' + title + '」从待确认晋升为正式记忆？').then(function (ok) {
            if (!ok) return;
            setBusy(true);
            setMsg(null);
            promoteItem({ file: file }).then(function (res) {
              setMsg({ kind: 'ok', text: '已晋升为正式记忆 reference/' + res.file });
              if (draft !== null && draft.file === file) { setDraft(null); setBase(null); setSel(null); }
              return refresh();
            }).catch(function (err) {
              setMsg({ kind: 'err', text: '晋升失败：' + String(err.message || err) });
            }).then(function () { setBusy(false); });
          });
        }

        /** Delete a throwaway draft outright (file + any stray index row). */
        function removeFile(kind, file, title) {
          if (kind !== 'pending') return;
          ask('删除草稿「' + title + '」？\n文件会被删除（不是归档），事后只能靠 git 找回。').then(function (ok) {
            if (!ok) return;
            setBusy(true);
            setMsg(null);
            deleteItem({ kind: kind, file: file }).then(function () {
              setMsg({ kind: 'ok', text: '已删除 ' + file });
              if (draft !== null && draft.file === file) { setDraft(null); setBase(null); setSel(null); }
              return refresh();
            }).catch(function (err) {
              setMsg({ kind: 'err', text: '删除失败：' + String(err.message || err) });
            }).then(function () { setBusy(false); });
          });
        }

        /**
         * Enter "new entry" mode.
         *
         * Creating a new entry does not discard the open one: unsaved edits are
         * written first (the panel is a save-on-commit editor anyway), so
         * starting a new entry never loses work and never nags.
         */
        function startCreate(kind) {
          if (creating) return;
          var begin = function (note) {
            setCreating(true);
            setSel(null);
            var next = { kind: kind, file: '', title: '', summary: '', date: new Date().toISOString().slice(0, 10), content: '', indexed: true };
            setDraft(next);
            setBase(next);
            setMsg(note === null || note === void 0 ? null : { kind: 'ok', text: note });
          };
          // Nothing to preserve: plain new entry.
          if (draft === null || base === null || !dirty || draft.file === '') {
            begin(null);
            return;
          }
          // Keep the edits the user already made, then open a blank draft.
          var snapshot = draft;
          setBusy(true);
          persist(snapshot).then(function () {
            return refresh();
          }).then(function () {
            setBusy(false);
            begin('已自动保存「' + (snapshot.title || snapshot.file) + '」，下面是新条目');
          }).catch(function (err) {
            // Saving failed: do NOT silently drop the user's edits.
            setBusy(false);
            setMsg({ kind: 'err', text: '自动保存失败，已保留当前修改：' + String(err.message || err) });
          });
        }

        /**
         * Ctrl/Cmd+S saves while the panel is open; while the confirmation
         * modal is up it owns Enter (confirm) and Esc (cancel) instead.
         */
        react.useEffect(function () {
          function onKey(ev) {
            if (askBox !== null) {
              if (ev.key === 'Escape') { ev.preventDefault(); answerAsk(false); }
              else if (ev.key === 'Enter') { ev.preventDefault(); answerAsk(true); }
              return;
            }
            if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 's') {
              ev.preventDefault();
              if (!busy && draft !== null && (dirty || creating)) (creating ? doCreate : doSave)();
            }
          }
          document.addEventListener('keydown', onKey);
          return function () { document.removeEventListener('keydown', onKey); };
        });

        /* ------------------------------------------------------------ list */

        var items = list.items || [];
        var q = query.trim().toLowerCase();
        if (q !== '') {
          items = items.filter(function (it) {
            return String(it.title || '').toLowerCase().indexOf(q) >= 0 ||
              String(it.summary || '').toLowerCase().indexOf(q) >= 0 ||
              String(it.file || '').toLowerCase().indexOf(q) >= 0;
          });
        }
        var pendingCount = (list.items || []).filter(function (it) { return it.kind === 'pending'; }).length;
        var groups = [
          { kind: 'pending', label: '待确认' },
          { kind: 'reference', label: '正式记忆' }
        ];

        var listNodes = [];
        if (list.status === 'loading' && (list.items || []).length === 0) {
          listNodes.push(h('div', { className: 'dswm-empty', key: 'loading' }, '加载中…'));
        } else if (list.status === 'error') {
          listNodes.push(h('div', { className: 'dswm-msg err', key: 'err' }, list.error));
        }
        groups.forEach(function (g) {
          var rows = items.filter(function (it) { return it.kind === g.kind; });
          if (rows.length === 0) return;
          listNodes.push(h('div', { className: 'dswm-group', key: 'g-' + g.kind },
            h('span', null, g.label), h('span', { className: 'n' }, '（' + rows.length + '）')));
          rows.forEach(function (it) {
            var active = sel !== null && sel.kind === it.kind && sel.file === it.file;
            listNodes.push(h('div', {
              className: 'dswm-item' + (active ? ' active' : ''),
              key: it.kind + '/' + it.file,
              onClick: function () { open(it.kind, it.file); },
              title: it.file
            },
              h('div', { className: 't' },
                it.indexed ? null : h('span', { className: 'dswm-dot', title: '尚未写入索引' }),
                h('span', { className: 'name' }, it.title)),
              it.summary ? h('div', { className: 's' }, it.summary) : null,
              h('div', { className: 'm' },
                h('span', null, it.date || '无日期'),
                h('span', null, it.chars + ' 字'),
                h('span', { className: 'grow' }),
                // One-click promotion for drafts, without opening the editor.
                it.kind === 'pending'
                  ? h('button', {
                      className: 'dswm-promote', disabled: busy, title: '晋升为正式记忆（移入 reference/ 并写入索引）',
                      onClick: function (ev) { ev.stopPropagation(); promoteFile(it.kind, it.file, it.title); }
                    }, '确认')
                  : null,
                // Throwaway drafts (test scratch) can be removed outright.
                it.kind === 'pending'
                  ? h('button', {
                      className: 'dswm-drop', disabled: busy, title: '删除这个草稿（不可恢复，除非用 git）',
                      onClick: function (ev) { ev.stopPropagation(); removeFile(it.kind, it.file, it.title); }
                    }, '删')
                  : null)
            ));
          });
        });
        if (listNodes.length === 0 && list.status === 'ready') {
          listNodes.push(h('div', { className: 'dswm-empty', key: 'none' },
            q === '' ? '还没有记忆条目' : '没有匹配「' + query + '」的条目'));
        }

        var listPane = h('div', { className: 'dswm-list' },
          h('div', { className: 'dswm-list-head' },
            h('input', {
              className: 'dswm-search', value: query, placeholder: '搜索标题 / 摘要 / 文件名',
              onChange: function (ev) { setQuery(ev.target.value); }
            }),
            h('div', { className: 'dswm-list-actions' },
              h('button', { className: 'dswm-btn', onClick: function () { startCreate('reference'); }, title: '新建一条正式记忆' }, '+ 正式'),
              h('button', { className: 'dswm-btn', onClick: function () { startCreate('pending'); }, title: '新建一条待确认草稿' }, '+ 草稿'),
              h('span', { className: 'dswm-grow' }),
              h('button', { className: 'dswm-btn icon', onClick: function () { refresh(); }, title: '重新读取磁盘' }, '刷新'))),
          h('div', { className: 'dswm-scroll' }, listNodes));

        /* ---------------------------------------------------------- detail */

        var detailBody;
        var detailFoot = null;
        if (draft === null) {
          detailBody = h('div', { className: 'dswm-empty big' },
            h('div', { className: 'k' }, '选择一条记忆'),
            h('div', null, '从左侧点击查看与编辑，或用「+ 正式」「+ 草稿」新建一条。'),
            h('div', { className: 'dswm-hint', style: { marginTop: '8px' } },
              '文件存于 ~/.dsh/workspace/ 的 git 仓库；保存 = 写正文 + 更新索引 + 记 memory-log + commit。'));
        } else {
          var missingTitle = creating && String(draft.title).trim() === '';
          detailBody = h('div', { className: 'dswm-fields' },
            h('div', { className: 'dswm-field' },
              h('label', null, '类别'),
              h('div', { className: 'ctl' },
                creating
                  ? h('select', {
                      className: 'dswm-input', value: draft.kind,
                      onChange: function (ev) { patch('kind', ev.target.value); }
                    },
                      h('option', { value: 'reference' }, 'reference（正式记忆）'),
                      h('option', { value: 'pending' }, 'pending（待确认草稿）'))
                  : h('div', { style: { paddingTop: '4px' } }, draft.kind,
                      h('span', { className: 'dswm-hint' }, '（类别不可改，用新建 + 归档来迁移）')))),
            h('div', { className: 'dswm-field' },
              h('label', null, '标题'),
              h('div', { className: 'ctl' },
                h('input', {
                  className: 'dswm-input', value: draft.title, placeholder: '索引条目名 / 文件名',
                  onChange: function (ev) { patch('title', ev.target.value); }
                }))),
            h('div', { className: 'dswm-field' },
              h('label', null, '摘要'),
              h('div', { className: 'ctl' },
                h('input', {
                  className: 'dswm-input', value: draft.summary, placeholder: '索引行的一句话摘要',
                  onChange: function (ev) { patch('summary', ev.target.value); }
                }))),
            h('div', { className: 'dswm-field' },
              h('label', null, '日期'),
              h('div', { className: 'ctl' },
                h('input', {
                  className: 'dswm-input', value: draft.date, placeholder: 'YYYY-MM-DD',
                  onChange: function (ev) { patch('date', ev.target.value); }
                }))),
            h('div', { className: 'dswm-editor' },
              h('label', null, '正文（Markdown，存于 ' + draft.kind + '/ 下的 .md 文件）'),
              h('textarea', {
                className: 'dswm-textarea', value: draft.content, spellCheck: false,
                onChange: function (ev) { patch('content', ev.target.value); }
              })));

          detailFoot = h('div', { className: 'dswm-detail-foot' },
            h('button', {
              className: 'dswm-btn primary',
              // Creating needs a title (it becomes the file name); saving needs
              // an actual change. The host rejects an empty title, so say so
              // before the round trip instead of after it.
              disabled: busy || (creating ? missingTitle : !dirty),
              onClick: creating ? doCreate : doSave
            }, creating ? (busy ? '新建中…' : '创建') : (busy ? '保存中…' : '保存')),
            missingTitle ? h('span', { className: 'dswm-hint' }, '先填标题（同时是文件名）') : null,
            creating ? null : h('button', {
              className: 'dswm-btn', disabled: busy || !dirty,
              onClick: function () { setDraft(Object.assign({}, base)); setMsg(null); }
            }, '放弃修改'),
            creating ? h('button', {
              className: 'dswm-btn', disabled: busy,
              onClick: function () { setCreating(false); setDraft(null); setBase(null); }
            }, '取消') : null,
            h('span', { className: 'dswm-grow' }),
            // 「确认加入记忆」 — only offered for pending drafts, since that is
            // the one transition the DSWM rules describe (pending → reference).
            (!creating && draft.kind === 'pending')
              ? h('button', {
                  className: 'dswm-btn primary', disabled: busy,
                  title: '移入 reference/、写入索引、记 memory-log 并 git commit',
                  onClick: doPromote
                }, busy ? '处理中…' : '✓ 确认加入记忆')
              : null,
            creating
              ? null
              : (draft.kind === 'pending'
                  ? h('button', {
                      className: 'dswm-btn danger', disabled: busy, title: '删除草稿（不可恢复，除非用 git）',
                      onClick: function () { removeFile(draft.kind, draft.file, draft.title); }
                    }, '删除草稿')
                  : h('button', { className: 'dswm-btn danger', disabled: busy, onClick: doArchive }, '归档')),
            h('span', { className: 'dswm-hint' }, 'Ctrl/Cmd+S 保存'));
        }

        var headNode = h('div', { className: 'dswm-head', 'data-window-drag': true },
          h('div', { className: 'dswm-head-main' },
            h('div', { className: 'dswm-h1' }, '记忆'),
            h('div', { className: 'dswm-sub' },
              'DSWM 持久记忆 · ' + (list.total || 0) + ' 条 · ~/.dsh/workspace/')),
          h('div', { className: 'dswm-head-actions' },
            pendingCount > 0 ? h('span', { className: 'dswm-chip warn', title: '待确认草稿不会进入检索，确认后才晋升为正式记忆' }, '待确认 ' + pendingCount) : null,
            h('span', { className: 'dswm-chip' }, '正式 ' + ((list.total || 0) - pendingCount))));

        var detailHead = draft === null ? null : h('div', { className: 'dswm-detail-head' },
          h('span', { className: 'dswm-title' }, creating ? '新建条目' : (draft.kind + '/' + draft.file)),
          dirty ? h('span', { className: 'dswm-dirty' }, '● 未保存') : null,
          !creating && !draft.indexed ? h('span', { className: 'dswm-dirty' }, '未写入索引') : null);

        var detailPane = h('div', { className: 'dswm-detail' },
          detailHead,
          h('div', { className: 'dswm-detail-scroll' }, detailBody),
          detailFoot);

        var askNode = askBox === null ? null : h('div', {
          className: 'dswm-modal-backdrop',
          onClick: function () { answerAsk(false); }
        }, h('div', {
          className: 'dswm-modal', role: 'dialog', 'aria-modal': 'true',
          onClick: function (ev) { ev.stopPropagation(); }
        },
          h('div', { className: 'dswm-modal-text' }, askBox.text),
          h('div', { className: 'dswm-modal-actions' },
            h('button', { className: 'dswm-btn', onClick: function () { answerAsk(false); } }, '取消'),
            h('button', { className: 'dswm-btn primary', onClick: function () { answerAsk(true); } }, '确定'))));

        return h('div', { className: 'dswm-page' },
          headNode,
          msg !== null ? h('div', { className: 'dswm-msg ' + msg.kind }, msg.text) : null,
          h('div', { className: 'dswm-work' }, listPane, detailPane),
          askNode);
      }

      /**
       * Client plugin body: contribute the sidebar row and its central panel.
       * The two registrations share one id: the row's list id is what the
       * layout's `main` keyed slot dispatches on.
       * @param ctx - client root context.
       */
      function apply(ctx) {
        var slots = ctx.slots;
        if (slots === void 0) {
          console.warn('[simple-memory-ui] slots 服务不可用，记忆面板未注册');
          return;
        }
        slots.inject('sidebar.panellist', function () {
          return slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            // Ships beside 「插件」/「自动化任务」, i.e. between the New Session
            // button and the 工作区 section.
            order: 30,
            label: function () { return '记忆'; }
          }, MemoryIcon);
        });
        slots.inject('main', function () {
          return slots.register({ name: 'main', key: PANEL_ID }, MemoryPanel);
        });
      }

      exports.name = 'dsh-simple-memory-ui';
      exports.inject = ['slots'];
      exports.apply = apply;
      return module.exports;
    }
  });
})();
