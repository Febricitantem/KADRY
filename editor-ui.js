// editor-ui.js — связка нового адаптивного интерфейса с существующим draw.js.
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function dispatch(el, name) {
    if (!el) return;
    el.dispatchEvent(new Event(name, { bubbles: true }));
  }

  var toolSel = byId('toolSel');
  var drawer = byId('editorDrawer');
  var editorLayout = document.querySelector('.editor-layout');
  var drawerTitle = byId('drawerTitle');
  var drawerHandle = byId('drawerHandleBtn');
  var drawerClose = byId('drawerCloseBtn');
  var brushColor = byId('brushColor');
  var status = byId('canvasStatus');
  var panelNames = {
    tools: 'Инструменты',
    brush: 'Кисть',
    color: 'Цвет',
    layers: 'Слои',
    reference: 'Референс'
  };
  var toolNames = {
    brush: 'Кисть',
    eraser: 'Ластик',
    fill: 'Заливка',
    select: 'Лассо-выделение',
    zoom: 'Лупа и панорама',
    eyedropper: 'Пипетка'
  };

  function refit() {
    window.requestAnimationFrame(function () {
      window.dispatchEvent(new Event('resize'));
    });
  }

  function syncTools() {
    var active = toolSel ? toolSel.value : 'brush';
    document.querySelectorAll('[data-editor-tool]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.editorTool === active);
      button.setAttribute('aria-pressed', button.dataset.editorTool === active ? 'true' : 'false');
    });
    var pipette = byId('eyedropperBtn');
    if (pipette) pipette.classList.toggle('is-active', active === 'eyedropper');
    if (status) {
      status.textContent = active === 'zoom'
        ? 'Лупа: колесо изменяет масштаб, перетаскивание панорамирует холст.'
        : active === 'select'
          ? 'Лассо: обведи область, затем перемести и подтверди или отмени.'
          : (toolNames[active] || 'Инструмент') + ': работа идёт на активном слое.';
    }
  }

  function setTool(value) {
    if (!toolSel || !value) return;
    toolSel.value = value;
    dispatch(toolSel, 'change');
  }

  function syncColor() {
    if (!brushColor) return;
    var color = brushColor.value || '#000000';
    document.querySelectorAll('[data-current-color]').forEach(function (el) {
      el.style.background = color;
      el.setAttribute('aria-label', 'Текущий цвет ' + color);
    });
  }

  function setPanel(name, open) {
    if (!panelNames[name]) return;
    document.querySelectorAll('.control-panel[data-panel]').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.dataset.panel === name);
    });
    document.querySelectorAll('[data-editor-panel]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.editorPanel === name);
      button.setAttribute('aria-pressed', button.dataset.editorPanel === name ? 'true' : 'false');
    });
    if (drawerTitle) drawerTitle.textContent = panelNames[name];
    if (drawer && open !== false) drawer.classList.remove('is-peek');
    if (editorLayout) editorLayout.classList.toggle('drawer-peek', !!(drawer && drawer.classList.contains('is-peek')));
    refit();
  }

  function toggleDrawer() {
    if (!drawer) return;
    drawer.classList.toggle('is-peek');
    if (editorLayout) editorLayout.classList.toggle('drawer-peek', drawer.classList.contains('is-peek'));
    refit();
  }

  document.querySelectorAll('[data-editor-tool]').forEach(function (button) {
    button.addEventListener('click', function () { setTool(button.dataset.editorTool); });
  });
  if (toolSel) toolSel.addEventListener('change', syncTools);

  document.querySelectorAll('[data-editor-panel]').forEach(function (button) {
    button.addEventListener('click', function () { setPanel(button.dataset.editorPanel, true); });
  });
  if (drawerHandle) drawerHandle.addEventListener('click', toggleDrawer);
  if (drawerClose) drawerClose.addEventListener('click', function () {
    if (drawer && !drawer.classList.contains('is-peek')) toggleDrawer();
  });

  if (brushColor) {
    brushColor.addEventListener('input', syncColor);
    brushColor.addEventListener('change', syncColor);
  }
  window.addEventListener('kadry:colorchange', syncColor);
  window.addEventListener('orientationchange', refit);

  // Мягкий вертикальный/горизонтальный жест для панели. Это только открытие UI,
  // не новый жест управления холстом.
  if (drawer) {
    var startX = 0, startY = 0, tracking = false;
    drawer.addEventListener('pointerdown', function (event) {
      if (!event.target.closest('.drawer-handle-btn,.drawer-head')) return;
      tracking = true; startX = event.clientX; startY = event.clientY;
    });
    drawer.addEventListener('pointerup', function (event) {
      if (!tracking) return;
      tracking = false;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      var isLandscape = window.matchMedia('(orientation: landscape) and (max-width: 979px)').matches;
      if (isLandscape ? Math.abs(dx) > 26 : Math.abs(dy) > 26) {
        if (drawer.classList.contains('is-peek')) {
          drawer.classList.remove('is-peek');
        } else if (isLandscape ? dx > 0 : dy > 0) {
          drawer.classList.add('is-peek');
        }
        if (editorLayout) editorLayout.classList.toggle('drawer-peek', drawer.classList.contains('is-peek'));
        refit();
      }
    });
  }


  // Кот над справкой остаётся статичной иллюстрацией: без таймера и без переключения источника.

  // Перемещение компактной панели действий: только за отдельную ручку,
  // с ограничением внутри рабочей области. Никакие жесты холста не перехватываются.
  (function initFloatingActionsDrag() {
    var actions = byId('floatingActions');
    var handle = byId('floatingActionsHandle');
    var stage = document.querySelector('.stage');
    if (!actions || !handle || !stage || !window.PointerEvent) return;

    var drag = null;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function placeWithinStage(left, top) {
      var stageRect = stage.getBoundingClientRect();
      var actionsRect = actions.getBoundingClientRect();
      var maxLeft = Math.max(8, stageRect.width - actionsRect.width - 8);
      var maxTop = Math.max(8, stageRect.height - actionsRect.height - 8);
      var safeLeft = clamp(left, 8, maxLeft);
      var safeTop = clamp(top, 8, maxTop);

      actions.classList.add('is-manually-positioned');
      actions.style.left = safeLeft + 'px';
      actions.style.top = safeTop + 'px';
      actions.style.right = 'auto';
      actions.style.bottom = 'auto';
      actions.style.transform = 'none';
    }

    function reClamp() {
      if (!actions.classList.contains('is-manually-positioned')) return;
      var stageRect = stage.getBoundingClientRect();
      var actionsRect = actions.getBoundingClientRect();
      var left = actionsRect.left - stageRect.left;
      var top = actionsRect.top - stageRect.top;
      placeWithinStage(left, top);
    }

    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      var stageRect = stage.getBoundingClientRect();
      var actionsRect = actions.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - actionsRect.left,
        offsetY: event.clientY - actionsRect.top,
        stageLeft: stageRect.left,
        stageTop: stageRect.top
      };

      actions.classList.add('is-dragging');
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    });

    handle.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      placeWithinStage(event.clientX - drag.stageLeft - drag.offsetX, event.clientY - drag.stageTop - drag.offsetY);
    });

    function stopDrag(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      if (event) {
        try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      drag = null;
      actions.classList.remove('is-dragging');
    }

    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
    window.addEventListener('resize', function () {
      window.requestAnimationFrame(reClamp);
    });
    window.addEventListener('orientationchange', function () {
      window.setTimeout(reClamp, 80);
    });
  })();

  setPanel('tools', false);
  syncTools();
  syncColor();
})();
