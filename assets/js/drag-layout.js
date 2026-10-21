/**
 * 看板面板 + 分组 + 指数卡片拖拽重排（localStorage 持久化）
 */
(function () {
  const STORE_KEY = 'stock-dashboard-layout-v1';

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function flip(layout, selector) {
    const rects = new Map();
    layout.querySelectorAll(selector).forEach((el) => rects.set(el, el.getBoundingClientRect()));
    return function () {
      requestAnimationFrame(() => {
        layout.querySelectorAll(selector).forEach((el) => {
          const old = rects.get(el);
          if (!old) return;
          const now = el.getBoundingClientRect();
          const dx = old.left - now.left;
          const dy = old.top - now.top;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            el.style.transition = 'none';
            el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
            requestAnimationFrame(() => {
              el.style.transition = 'transform 0.22s ease, opacity 0.2s ease, box-shadow 0.2s ease';
              el.style.transform = '';
              el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
            });
          }
        });
      });
    };
  }

  /* ---------- 大面板 ---------- */
  function panelKey(p) {
    const t = p.querySelector('.panel-title');
    return t ? t.textContent.trim() : null;
  }
  function persistPanels(layout) {
    const s = loadStore();
    s.panelOrder = Array.prototype.map.call(
      layout.querySelectorAll(':scope > .panel'), panelKey).filter(Boolean);
    saveStore(s);
  }
  function restorePanels(layout) {
    const s = loadStore();
    if (!s.panelOrder || !s.panelOrder.length) return;
    const byKey = {};
    layout.querySelectorAll(':scope > .panel').forEach((p) => {
      const k = panelKey(p);
      if (k) byKey[k] = p;
    });
    s.panelOrder.forEach((k) => { if (byKey[k]) layout.appendChild(byKey[k]); });
  }

  function initPanelDrag() {
    const layout = document.querySelector('.layout');
    if (!layout) return;
    restorePanels(layout);
    const panels = layout.querySelectorAll(':scope > .panel');
    panels.forEach((p) => {
      if (p.querySelector(':scope > .panel-head > .drag-handle')) return;
      const head = p.querySelector('.panel-head');
      if (!head) return;
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.title = '拖动调整位置';
      handle.textContent = '⋮⋮';
      head.insertBefore(handle, head.firstChild);
    });

    let dragPanel = null;
    layout.addEventListener('mousedown', (e) => {
      const handle = e.target.closest(':scope > .panel-head > .drag-handle');
      if (!handle) return;
      e.preventDefault();
      dragPanel = handle.closest('.panel');
      dragPanel.classList.add('dragging');
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragPanel) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let target = null;
      for (const el of els) {
        const p = el.closest(':scope > .panel');
        if (p && p !== dragPanel && p.parentNode === layout) { target = p; break; }
      }
      if (!target) return;
      const play = flip(layout, ':scope > .panel');
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      if (after) layout.insertBefore(dragPanel, target.nextSibling);
      else layout.insertBefore(dragPanel, target);
      play();
    });
    document.addEventListener('mouseup', () => {
      if (dragPanel) {
        dragPanel.classList.remove('dragging');
        dragPanel = null;
        persistPanels(layout);
      }
    });
  }

  /* ---------- 分组（index-group） ---------- */
  function groupKey(g) {
    const t = g.querySelector('.group-title');
    return t ? t.textContent.trim() : null;
  }
  function persistGroups(box) {
    const s = loadStore();
    s.groupOrder = Array.prototype.map.call(
      box.querySelectorAll(':scope > .index-group'), groupKey).filter(Boolean);
    saveStore(s);
  }
  function restoreGroups(box) {
    const s = loadStore();
    if (!s.groupOrder || !s.groupOrder.length) return;
    const byKey = {};
    box.querySelectorAll(':scope > .index-group').forEach((g) => {
      const k = groupKey(g);
      if (k) byKey[k] = g;
    });
    s.groupOrder.forEach((k) => { if (byKey[k]) box.appendChild(byKey[k]); });
  }

  function initGroupDrag() {
    const box = document.querySelector('#indices-container');
    if (!box) return;
    let dragGroup = null;
    box.addEventListener('mousedown', (e) => {
      const head = e.target.closest('.index-group > .group-head');
      if (!head) return;
      e.preventDefault();
      dragGroup = head.parentNode;
      dragGroup.classList.add('dragging');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragGroup) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let target = null;
      for (const el of els) {
        const p = el.closest('.index-group');
        if (p && p !== dragGroup && p.parentNode === box) { target = p; break; }
      }
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      const play = flip(box, '.index-group');
      if (after) box.insertBefore(dragGroup, target.nextSibling);
      else box.insertBefore(dragGroup, target);
      play();
    });
    document.addEventListener('mouseup', () => {
      if (dragGroup) {
        dragGroup.classList.remove('dragging');
        dragGroup = null;
        persistGroups(box);
      }
    });
  }

  /* ---------- 指数卡片（quote-item） ---------- */
  function itemKey(it) { return it.getAttribute('data-secid'); }
  function persistItems(box) {
    const s = loadStore();
    s.itemOrder = {};
    box.querySelectorAll(':scope > .index-group').forEach((g) => {
      const gk = groupKey(g);
      if (!gk) return;
      s.itemOrder[gk] = Array.prototype.map.call(
        g.querySelectorAll(':scope > .group-body > .quote-item'), itemKey).filter(Boolean);
    });
    saveStore(s);
  }
  function restoreItems(box) {
    const s = loadStore();
    if (!s.itemOrder) return;
    box.querySelectorAll(':scope > .index-group').forEach((g) => {
      const gk = groupKey(g);
      const order = s.itemOrder[gk];
      if (!order || !order.length) return;
      const body = g.querySelector(':scope > .group-body');
      if (!body) return;
      const byKey = {};
      body.querySelectorAll(':scope > .quote-item').forEach((it) => {
        const k = itemKey(it);
        if (k) byKey[k] = it;
      });
      order.forEach((k) => { if (byKey[k]) body.appendChild(byKey[k]); });
    });
  }

  function initItemDrag() {
    let dragItem = null;
    document.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.group-body .quote-item');
      if (!item) return;
      const r = item.getBoundingClientRect();
      if (e.clientX - r.left > 24) return;
      e.preventDefault();
      dragItem = item;
      item.classList.add('dragging');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragItem) return;
      const body = dragItem.parentNode;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let target = null;
      for (const el of els) {
        const p = el.closest('.quote-item');
        if (p && p !== dragItem && p.parentNode === body) { target = p; break; }
      }
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      const play = flip(body, '.quote-item');
      if (after) body.insertBefore(dragItem, target.nextSibling);
      else body.insertBefore(dragItem, target);
      play();
    });
    document.addEventListener('mouseup', () => {
      if (dragItem) {
        dragItem.classList.remove('dragging');
        const box = document.querySelector('#indices-container');
        if (box) persistItems(box);
        dragItem = null;
      }
    });
  }

  /* ---------- 暴露给 app.js 在 renderIndices 完成后调用 ---------- */
  window.__restoreLayout = function () {
    const box = document.querySelector('#indices-container');
    if (!box) return;
    restoreGroups(box);
    restoreItems(box);
  };

  function initWatchDrag() {
    const box = document.querySelector('#watch-list');
    if (!box) return;
    let dragRow = null;
    box.addEventListener('mousedown', (e) => {
      const grip = e.target.closest('.watch-grip');
      if (!grip) return;
      e.preventDefault();
      dragRow = grip.closest('.watch-row');
      dragRow.classList.add('dragging');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragRow) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let target = null;
      for (const el of els) {
        const p = el.closest('.watch-row');
        if (p && p !== dragRow && p.parentNode === box) { target = p; break; }
      }
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      const play = flip(box, '.watch-row');
      if (after) box.insertBefore(dragRow, target.nextSibling);
      else box.insertBefore(dragRow, target);
      play();
    });
    document.addEventListener('mouseup', () => {
      if (!dragRow) return;
      dragRow.classList.remove('dragging');
      // 把新顺序写回 localStorage（直接通过 app.js 暴露的接口）
      if (window.__saveWatchOrder) {
        const order = Array.prototype.map.call(
          box.querySelectorAll('.watch-row'), (r) => r.getAttribute('data-secid')).filter(Boolean);
        window.__saveWatchOrder(order);
      }
      dragRow = null;
    });
  }

  /* ---------- 恢复出厂布局按钮 ---------- */
  function initResetButton() {
    const btn = document.createElement('button');
    btn.className = 'reset-layout-btn';
    btn.title = '恢复默认布局';
    btn.textContent = '⟳';
    btn.onclick = () => {
      if (!confirm('恢复默认布局？将清空所有自定义排序和置顶。')) return;
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem('watch-pinned');
      location.reload();
    };
    document.body.appendChild(btn);
  }

  function init() {
    initPanelDrag();
    initItemDrag();
    initGroupDrag();
    initWatchDrag();
    initResetButton();
    // 任何拖拽结束后统一恢复文本选中
    document.addEventListener('mouseup', () => { document.body.style.userSelect = ''; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
