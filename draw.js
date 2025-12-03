// draw.js — редактор с таймером, слоями, выделением и глобальной историей
// @ts-nocheck
(function () {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  window.initDrawEditor = function initDrawEditor(opts) {
    opts = opts || {};
    var baseImageUrl = opts.baseImageUrl || null;

    // DOM
    var wrap = document.getElementById('canvasWrap');
    var layerList = document.getElementById('layerList');
    var colorInp = document.getElementById('brushColor');
    var sizeInp = document.getElementById('brushSize');
    var alphaInp = document.getElementById('brushAlpha');
    var smoothInp = document.getElementById('brushSmooth');
    var toolSel = document.getElementById('toolSel');
    var opacityInp = document.getElementById('layerOpacity');
    var addBtn = document.getElementById('addLayerBtn');
    var delBtn = document.getElementById('delLayerBtn');
    var clearBtn = document.getElementById('clearBtn');
    var undoBtn = document.getElementById('undoBtn');
    var redoBtn = document.getElementById('redoBtn');
    var confirmSelBtn = document.getElementById('confirmSelBtn');
    var cancelSelBtn = document.getElementById('cancelSelBtn');
    var refInput = document.getElementById('refInput');
    var addRefBtn = document.getElementById('addRefBtn');

    if (!wrap) { console.warn('canvasWrap not found'); return; }

    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';

    var W = 1920, H = 1080;

    // ---- таймер / блокировка
    function isTimeExpired() { return document.body.classList.contains('time-expired'); }

    var hudEnabled = true;
    var exporting = false;
    var drawing = false;
    var selecting = false;
    var dragging = false;

    function applyLockState() {
      var locked = isTimeExpired();
      wrap.style.pointerEvents = locked ? 'none' : '';
      wrap.style.filter = locked ? 'grayscale(.1)' : '';
      if (confirmSelBtn) confirmSelBtn.style.display = locked ? 'none' : (tool() === 'select' ? 'inline-block' : 'none');
      if (cancelSelBtn) cancelSelBtn.style.display = locked ? 'none' : (tool() === 'select' ? 'inline-block' : 'none');
      if (locked) {
        drawing = false; selecting = false; dragging = false; dragMode = null;
        redrawPreview();
      }
    }

    var bodyObserver = new MutationObserver(function () { applyLockState(); });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // ---- слои
    var layers = [];
    var active = -1;

    function makeLayer(name, isRef) {
      if (name == null) name = 'Слой ' + (layers.length + 1);
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      c.style.position = 'absolute'; c.style.inset = '0'; c.style.width = '100%'; c.style.height = '100%';
      c.style.userSelect = 'none'; c.style.touchAction = 'none';
      var ctx = c.getContext('2d');
      var layer = {};
      layer.id = String(Date.now() + Math.random());
      layer.name = name;
      layer.canvas = c;
      layer.ctx = ctx;
      layer.visible = true;
      layer.opacity = 1;
      layer.isRef = !!isRef;
      layers.push(layer);
      wrap.appendChild(c);
      setZ();
      setActive(layers.length - 1);
      return layer;
    }

    function drawImageFit(ctx, img) {
      var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
      if (!sw || !sh) { ctx.drawImage(img, 0, 0); return; }
      var scale = Math.min(1, Math.min(W / sw, H / sh));
      var dw = Math.floor(sw * scale), dh = Math.floor(sh * scale);
      var dx = Math.floor((W - dw) / 2), dy = Math.floor((H - dh) / 2);
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function makeLayerFromImage(img, isRef) {
      var l = makeLayer(isRef ? 'Референс' : 'Слой', !!isRef);
      drawImageFit(l.ctx, img);
      if (isRef) { l.canvas.style.outline = '1px dashed #ef4444'; }
      return l;
    }

    function setZ() {
      layers.forEach(function (l, i) {
        l.canvas.style.zIndex = String(i + 1);
        l.canvas.style.display = l.visible ? '' : 'none';
        l.canvas.style.opacity = String(l.opacity);
      });
      preview.canvas.style.zIndex = String(layers.length + 10);
    }

    function setActive(i) {
      active = i;
      syncLeftPanel();
      buildLayerList();
    }

    function buildLayerList() {
      if (!layerList) return;
      layerList.innerHTML = '';
      for (var i = layers.length - 1; i >= 0; i--) {
        (function (idx) {
          var l = layers[idx];
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;padding:10px 8px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;user-select:none;min-height:36px;';
          row.setAttribute('data-idx', String(idx));
          row.draggable = true;
          if (idx === active) row.style.background = '#eef2ff';
          var danger = (l.isRef || !l.visible); if (danger) row.style.borderColor = '#ef4444';

          var vis = document.createElement('button');
          vis.textContent = l.visible ? '👁' : '🚫';
          if (!l.visible) vis.style.color = '#ef4444';
          vis.title = l.visible ? 'Скрыть слой (красные не в экспорт)' : 'Показать слой';
          vis.onclick = function (e) {
            e.stopPropagation();
            if (isTimeExpired()) return;
            l.visible = !l.visible;
            setZ();
            buildLayerList();
          };

          var nameInp = document.createElement('input');
          nameInp.type = 'text';
          nameInp.value = l.name;
          nameInp.style.flex = '1 1 160px';
          nameInp.style.minWidth = '0';
          nameInp.style.maxWidth = '200px';
          nameInp.style.overflow = 'hidden';
          nameInp.style.textOverflow = 'ellipsis';
          if (danger) nameInp.style.color = '#ef4444';
          nameInp.onchange = function (e) {
            if (isTimeExpired()) return;
            l.name = (e.target.value || '').trim() || l.name;
          };

          function moveUp() {
            if (isTimeExpired()) return;
            if (idx < layers.length - 1) {
              var t = layers.splice(idx, 1)[0];
              var dst = idx + 1;
              layers.splice(dst, 0, t);
              setActive(dst); reorderCanvases(); setZ(); buildLayerList();
            }
          }
          function moveDown() {
            if (isTimeExpired()) return;
            if (idx > 0) {
              var t = layers.splice(idx, 1)[0];
              var dst = idx - 1;
              layers.splice(dst, 0, t);
              setActive(dst); reorderCanvases(); setZ(); buildLayerList();
            }
          }

          var up = document.createElement('button'); up.textContent = '↑'; up.title = 'Выше'; up.onclick = function (e) { e.stopPropagation(); moveUp(); };
          var down = document.createElement('button'); down.textContent = '↓'; down.title = 'Ниже'; down.onclick = function (e) { e.stopPropagation(); moveDown(); };

          row.onclick = function () { if (isTimeExpired()) return; setActive(idx); };

          // DnD для смены порядка
          row.addEventListener('dragstart', function (ev) {
            if (isTimeExpired()) { ev.preventDefault(); return; }
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', String(idx));
            row.style.opacity = '0.6';
          });
          row.addEventListener('dragend', function () { row.style.opacity = ''; });
          row.addEventListener('dragover', function (ev) {
            if (isTimeExpired()) return;
            ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
          });
          row.addEventListener('drop', function (ev) {
            if (isTimeExpired()) return;
            ev.preventDefault();
            var src = Number(ev.dataTransfer.getData('text/plain'));
            var dst = idx;
            if (isNaN(src) || isNaN(dst) || src === dst) return;
            var item = layers.splice(src, 1)[0];
            if (src < dst) dst--;
            layers.splice(dst, 0, item);
            setActive(dst); reorderCanvases(); setZ(); buildLayerList();
          });

          row.appendChild(vis);
          row.appendChild(nameInp);
          row.appendChild(up);
          row.appendChild(down);
          layerList.appendChild(row);
        })(i);
      }
    }

    function reorderCanvases() {
      for (var k = 0; k < layers.length; k++) { wrap.appendChild(layers[k].canvas); }
    }

    function syncLeftPanel() {
      var l = layers[active];
      if (!opacityInp) return;
      opacityInp.value = String(l ? l.opacity : 1);
    }

    if (opacityInp) opacityInp.addEventListener('input', function () {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l) return;
      l.opacity = clamp(Number(opacityInp.value) || 0, 0, 1);
      setZ();
    });

    if (addBtn) addBtn.onclick = function () { if (isTimeExpired()) return; makeLayer(); };
    if (delBtn) delBtn.onclick = function () {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l) return;
      if (!confirm('Удалить слой «' + l.name + '»?')) return;
      var idx = active;
      layers.splice(idx, 1)[0].canvas.remove();
      setActive(Math.max(0, Math.min(idx, layers.length - 1)));
      setZ();
    };
    if (clearBtn) clearBtn.onclick = function () {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l) return;
      if (!confirm('Очистить слой «' + l.name + '»?')) return;
      if (!l.isRef) snapshot(l);
      l.ctx.clearRect(0, 0, W, H);
      redrawPreview();
    };

    if (addRefBtn) addRefBtn.onclick = function () {
      if (isTimeExpired()) return;
      var f = refInput && refInput.files && refInput.files[0];
      if (!f) { alert('Сначала выберите файл'); return; }
      var img = new Image();
      img.onload = function () {
        var lay = makeLayerFromImage(img, true);
        setActive(layers.indexOf(lay));
      };
      img.src = URL.createObjectURL(f);
    };

    // ---- история (глобальная по слоям)
    var imgHistory = new Map();
    var ACTION_LIMIT = 50;
    var historyOrder = [];
    var redoOrder = [];

    function snapshot(l) {
      try {
        if (!l || l.isRef) return;
        var rec = imgHistory.get(l.id) || { undo: [], redo: [] };
        var url = l.canvas.toDataURL('image/png');
        rec.undo.push(url);
        if (rec.undo.length > ACTION_LIMIT) rec.undo.shift();
        rec.redo.length = 0;
        imgHistory.set(l.id, rec);
        historyOrder.push({ layerId: l.id });
        if (historyOrder.length > ACTION_LIMIT) {
          var removed = historyOrder.shift();
          var r = imgHistory.get(removed.layerId);
          if (r && r.undo.length > 0) r.undo.shift();
        }
        redoOrder.length = 0;
      } catch (e) { }
    }

    function applyImageToLayer(l, url) {
      var img = new Image();
      img.onload = function () {
        l.ctx.clearRect(0, 0, W, H);
        l.ctx.drawImage(img, 0, 0, W, H);
        redrawPreview();
      };
      img.src = url;
    }

    function findLayerById(id) {
      for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return layers[i];
      return null;
    }

    function undo() {
      if (isTimeExpired()) return;
      if (!historyOrder.length) return;
      var entry = historyOrder.pop();
      var l = findLayerById(entry.layerId);
      if (!l || l.isRef) return;
      var rec = imgHistory.get(l.id);
      if (!rec || !rec.undo.length) return;
      var cur = l.canvas.toDataURL('image/png');
      var prev = rec.undo.pop();
      rec.redo.push(cur);
      if (rec.redo.length > ACTION_LIMIT) rec.redo.shift();
      imgHistory.set(l.id, rec);
      redoOrder.push({ layerId: l.id });
      applyImageToLayer(l, prev);
    }

    function redo() {
      if (isTimeExpired()) return;
      if (!redoOrder.length) return;
      var entry = redoOrder.pop();
      var l = findLayerById(entry.layerId);
      if (!l || l.isRef) return;
      var rec = imgHistory.get(l.id);
      if (!rec || !rec.redo.length) return;
      var cur = l.canvas.toDataURL('image/png');
      var next = rec.redo.pop();
      rec.undo.push(cur);
      if (rec.undo.length > ACTION_LIMIT) rec.undo.shift();
      imgHistory.set(l.id, rec);
      historyOrder.push({ layerId: l.id });
      applyImageToLayer(l, next);
    }

    if (undoBtn) undoBtn.onclick = undo;
    if (redoBtn) redoBtn.onclick = redo;

    // ---- preview-слой
    var preview = (function () {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      c.style.position = 'absolute'; c.style.inset = '0'; c.style.width = '100%'; c.style.height = '100%';
      c.style.pointerEvents = 'none';
      var ctx = c.getContext('2d');
      wrap.appendChild(c);
      return { canvas: c, ctx: ctx };
    })();

    // ---- зум и панорамирование
    var zoomLevel = 1;
    var minZoom = 0.5;
    var maxZoom = 4;
    var panX = 0;
    var panY = 0;
    var isPanning = false;
    var panStartX = 0;
    var panStartY = 0;
    var panStartOffsetX = 0;
    var panStartOffsetY = 0;

    function applyViewTransform() {
      if (!wrap) return;
      wrap.style.transformOrigin = 'center center';
      wrap.style.transform =
        'translate(' + panX + 'px,' + panY + 'px) scale(' + zoomLevel + ')';
    }
    applyViewTransform();

    // ---- параметры кисти
    function tool() { return toolSel ? toolSel.value : 'brush'; }
    function size() { return sizeInp ? Number(sizeInp.value) || 8 : 8; }
    function color() { return colorInp ? colorInp.value : '#000000'; }
    function alpha() {
      if (!alphaInp) return 1;
      var v = Number(alphaInp.value);
      if (!isFinite(v) || isNaN(v)) v = 1;
      // 0 = полностью прозрачная кисть, 1 = максимально плотная
      return clamp(v, 0, 1);
    }
    function smooth() {
      // 0 — без сглаживания, 1 на ползунке — сглаживание ×3
      if (!smoothInp) return 0;
      var v = Number(smoothInp.value) || 0;
      return clamp(v * 3, 0, 3);
    }

    function updateToolCursor() {
      if (!wrap) return;
      var t = tool();
      if (t === 'zoom') {
        wrap.style.cursor = isPanning ? 'grabbing' : 'grab';
      } else if (t === 'select') {
        wrap.style.cursor = 'crosshair';
      } else {
        wrap.style.cursor = 'crosshair';
      }
    }

    if (toolSel) {
      toolSel.addEventListener('change', function () {
        updateToolCursor();
        redrawPreview();
      });
    }

    function setupStroke(ctx, l) {
      var a = alpha();
      var isPreview = (ctx === preview.ctx);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size();

      if (tool() === 'eraser') {
        if (isPreview) {
          // На превью рисуем обычным штрихом, чтобы не "пробивать дырки"
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = clamp(l.opacity * a, 0, 1);
          ctx.strokeStyle = '#000000';
          ctx.fillStyle = '#000000';
        } else {
          // На реальном слое ластик стирает до прозрачности
          ctx.globalCompositeOperation = 'destination-out';
          // Сила стирания управляется ползунком "прозрачность кисти"
          ctx.globalAlpha = clamp(a, 0, 1);
          ctx.strokeStyle = '#000000';
          ctx.fillStyle = '#000000';
        }
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = clamp(l.opacity * a, 0, 1);
        ctx.strokeStyle = color();
        ctx.fillStyle = color();
      }
    }

    // ---- сглаживание Catmull–Rom → Bezier
    function drawSmoothPath(ctx, pts, t) {
      if (pts.length < 2) return;
      if (t <= 0) {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (var i1 = 1; i1 < pts.length; i1++) ctx.lineTo(pts[i1].x, pts[i1].y);
        ctx.stroke();
        return;
      }
      function p(i) { return pts[Math.max(0, Math.min(pts.length - 1, i))]; }
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var i2 = 0; i2 < pts.length - 1; i2++) {
        var p0 = p(i2 - 1), p1 = p(i2), p2 = p(i2 + 1), p3 = p(i2 + 2);
        var cp1x = p1.x + (p2.x - p0.x) * (t / 6), cp1y = p1.y + (p2.y - p0.y) * (t / 6);
        var cp2x = p2.x - (p3.x - p1.x) * (t / 6), cp2y = p2.y - (p3.y - p1.y) * (t / 6);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      ctx.stroke();
    }

    function drawSmoothFill(ctx, pts, t) {
      if (pts.length < 2) return;
      function p(i) { return pts[Math.max(0, Math.min(pts.length - 1, i))]; }
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      if (t <= 0) {
        for (var i3 = 1; i3 < pts.length; i3++) ctx.lineTo(pts[i3].x, pts[i3].y);
      } else {
        for (var i4 = 0; i4 < pts.length - 1; i4++) {
          var p0 = p(i4 - 1), p1 = p(i4), p2 = p(i4 + 1), p3 = p(i4 + 2);
          var cp1x = p1.x + (p2.x - p0.x) * (t / 6), cp1y = p1.y + (p2.y - p0.y) * (t / 6);
          var cp2x = p2.x - (p3.x - p1.x) * (t / 6), cp2y = p2.y - (p3.y - p1.y) * (t / 6);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }
      ctx.closePath();
      ctx.fill();
    }

    function redraw(ctx, l, pts) {
      if (pts.length < 2) return;
      ctx.save(); setupStroke(ctx, l);
      var t = smooth();
      if (tool() === 'fill') drawSmoothFill(ctx, pts, t); else drawSmoothPath(ctx, pts, t);
      ctx.restore();
    }

    // ---- координаты и HUD
    function localXY(e) {
      var l = layers[active]; if (!l) return { x: 0, y: 0 };
      var r = l.canvas.getBoundingClientRect();
      return {
        x: clamp((e.clientX - r.left) * (W / r.width), 0, W),
        y: clamp((e.clientY - r.top) * (H / r.height), 0, H)
      };
    }

    var lastPos = { x: W / 2, y: H / 2 };
    var hudTimer = null;

    function drawCursorCircle() {
      if (!hudEnabled || exporting || isTimeExpired()) return;
      if (tool() !== 'brush' && tool() !== 'eraser') return;
      var p = preview.ctx;
      var rr = Math.max(2, size() / 2);
      p.save();
      p.globalAlpha = 0.7;
      p.beginPath();
      p.arc(lastPos.x, lastPos.y, rr, 0, Math.PI * 2);
      p.strokeStyle = '#111827';
      p.lineWidth = 1.5;
      p.stroke();
      p.restore();
    }

    function redrawPreview() {
      preview.ctx.clearRect(0, 0, W, H);
      if (!hudEnabled || exporting || isTimeExpired()) return;
      if (selection) {
        preview.ctx.drawImage(selection.img, selection.x, selection.y, selection.w, selection.h);
        drawSelectionFrame();
      }
      drawCursorCircle();
    }

    function showSizeHUD(r) {
      if (!hudEnabled || isTimeExpired()) return;
      if (hudTimer) { clearTimeout(hudTimer); hudTimer = null; }
      redrawPreview();
      var cx = W / 2, cy = H / 2;
      var p = preview.ctx;
      p.save();
      p.globalAlpha = 0.55;
      p.beginPath();
      p.arc(cx, cy, Math.max(2, r / 2), 0, Math.PI * 2);
      p.strokeStyle = '#111827';
      p.lineWidth = 2;
      p.stroke();
      p.restore();
      hudTimer = setTimeout(function () { redrawPreview(); }, 600);
    }

    // ---- выделение
    var pathPoints = [];
    var selection = null;        // {img,x,y,w,h,layerId,fromRef}
    var selectionFromRef = false;
    var dragMode = null; var dragOffX = 0, dragOffY = 0; var beforeSelectSnapshot = null;
    var clipboardSel = null;     // {img,w,h}

    var HANDLE = 8;

    function drawSelectionFrame() {
      if (!hudEnabled || isTimeExpired()) return;
      if (!selection) return;
      var p = preview.ctx; p.save();
      p.setLineDash([6, 4]); p.strokeStyle = '#3b82f6';
      p.strokeRect(selection.x, selection.y, selection.w, selection.h);
      p.setLineDash([]);
      p.fillStyle = '#3b82f6';
      var hs = HANDLE;
      var cs = [
        [selection.x, selection.y],
        [selection.x + selection.w, selection.y],
        [selection.x + selection.w, selection.y + selection.h],
        [selection.x, selection.y + selection.h]
      ];
      for (var i = 0; i < cs.length; i++) {
        var cx = cs[i][0], cy = cs[i][1];
        p.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }
      p.restore();
    }

    function hitHandle(x, y) {
      if (!selection) return null;
      var hs = HANDLE;
      var pts = [
        [selection.x, selection.y, 'tl'],
        [selection.x + selection.w, selection.y, 'tr'],
        [selection.x + selection.w, selection.y + selection.h, 'br'],
        [selection.x, selection.y + selection.h, 'bl']
      ];
      for (var i = 0; i < pts.length; i++) {
        var cx = pts[i][0], cy = pts[i][1], n = pts[i][2];
        if (Math.abs(x - cx) <= hs && Math.abs(y - cy) <= hs) return n;
      }
      if (x > selection.x && x < selection.x + selection.w && y > selection.y && y < selection.y + selection.h) return 'move';
      return null;
    }

    function updateSelButtons() {
      var show = (tool() === 'select' && !!selection && !isTimeExpired());
      if (confirmSelBtn) confirmSelBtn.style.display = show ? 'inline-block' : 'none';
      if (cancelSelBtn) cancelSelBtn.style.display = show ? 'inline-block' : 'none';
    }

    function copySelection() {
      if (!selection) return;
      if (selectionFromRef || selection.fromRef) {
        alert('Нельзя копировать содержимое с референс-слоя.');
        return;
      }
      var off = document.createElement('canvas');
      off.width = selection.w;
      off.height = selection.h;
      off.getContext('2d').drawImage(selection.img, 0, 0);
      clipboardSel = { img: off, w: selection.w, h: selection.h };
    }

    function pasteSelection() {
      if (!clipboardSel) return;
      var l = layers[active];
      if (!l || l.isRef) return;
      var off = document.createElement('canvas');
      off.width = clipboardSel.w;
      off.height = clipboardSel.h;
      off.getContext('2d').drawImage(clipboardSel.img, 0, 0);
      var pos = lastPos || { x: W / 2, y: H / 2 };
      var nx = clamp(pos.x - clipboardSel.w / 2, 0, W - clipboardSel.w);
      var ny = clamp(pos.y - clipboardSel.h / 2, 0, H - clipboardSel.h);
      selection = {
        img: off,
        x: nx,
        y: ny,
        w: clipboardSel.w,
        h: clipboardSel.h,
        layerId: l.id,
        fromRef: false
      };
      selectionFromRef = false;
      selecting = false;
      dragging = true;
      dragMode = 'move';
      dragOffX = pos.x - selection.x;
      dragOffY = pos.y - selection.y;
      redrawPreview();
      updateSelButtons();
    }

    function beginDraw(e) {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l || !l.visible) return;
      var t = tool();
      if (t === 'select') {
        if (selection) return;
        selecting = true;
        pathPoints = [];
        // сохраняем снимок слоя для последующей отмены, даже для референса
        beforeSelectSnapshot = l.canvas.toDataURL('image/png');
        selectionFromRef = !!l.isRef;
        pathPoints.push(localXY(e));
        redrawPreview(); updateSelButtons(); return;
      }
      drawing = true;
      if (!l.isRef) snapshot(l);
      pathPoints = [];
      pathPoints.push(localXY(e));
      redrawPreview();
    }

    function moveDraw(e) {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l) return;
      lastPos = localXY(e);
      var t = tool();
      if (t === 'select') {
        if (dragging && selection) {
          var p = lastPos;
          if (dragMode === 'move' || !dragMode) {
            selection.x = clamp(p.x - dragOffX, 0, W - selection.w);
            selection.y = clamp(p.y - dragOffY, 0, H - selection.h);
          } else {
            var s = selection, ox = s.x, oy = s.y, ow = s.w, oh = s.h;
            if (dragMode === 'tl') {
              var nx = clamp(p.x, 0, ox + ow - 1), ny = clamp(p.y, 0, oy + oh - 1);
              s.w = (ox + ow) - nx; s.h = (oy + oh) - ny; s.x = nx; s.y = ny;
            }
            if (dragMode === 'tr') {
              var nx2 = clamp(p.x, ox + 1, W), ny2 = clamp(p.y, 0, oy + oh - 1);
              s.w = nx2 - ox; s.h = (oy + oh) - ny2; s.y = ny2;
            }
            if (dragMode === 'br') {
              var nx3 = clamp(p.x, ox + 1, W), ny3 = clamp(p.y, oy + 1, H);
              s.w = nx3 - ox; s.h = ny3 - oy;
            }
            if (dragMode === 'bl') {
              var nx4 = clamp(p.x, 0, ox + ow - 1), ny4 = clamp(p.y, oy + 1, H);
              s.w = (ox + ow) - nx4; s.h = ny4 - oy; s.x = nx4;
            }
          }
          redrawPreview();
          return;
        }
        if (!selecting) return;
        pathPoints.push(lastPos);
        redrawPreview();
        if (hudEnabled) {
          var p2 = preview.ctx;
          p2.save(); p2.globalAlpha = 0.25; p2.fillStyle = '#3b82f6';
          drawSmoothFill(p2, pathPoints, smooth());
          p2.restore();
        }
        return;
      }
      if (!drawing) return;
      pathPoints.push(lastPos);
      redrawPreview();
      if (hudEnabled) redraw(preview.ctx, l, pathPoints);
    }

    function endDraw(e) {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l) return;
      var t = tool();
      if (t === 'select') {
        if (dragging && selection) {
          dragging = false; dragMode = null;
          redrawPreview(); updateSelButtons(); return;
        }
        if (!selecting) return;
        selecting = false;
        var xs = pathPoints.map(function (p) { return p.x; });
        var ys = pathPoints.map(function (p) { return p.y; });
        var minx = Math.max(0, Math.min.apply(Math, xs) | 0), miny = Math.max(0, Math.min.apply(Math, ys) | 0);
        var maxx = Math.min(W, Math.max.apply(Math, xs) | 0), maxy = Math.min(H, Math.max.apply(Math, ys) | 0);
        var bw = maxx - minx, bh = maxy - miny;
        if (bw <= 2 || bh <= 2) {
          redrawPreview();
          pathPoints = [];
          selection = null;
          selectionFromRef = false;
          updateSelButtons();
          return;
        }
        var temp = document.createElement('canvas'); temp.width = bw; temp.height = bh;
        var tctx = temp.getContext('2d');
        tctx.save();
        tctx.translate(-minx, -miny);
        tctx.beginPath();
        tctx.moveTo(pathPoints[0].x, pathPoints[0].y);
        for (var i7 = 1; i7 < pathPoints.length; i7++) tctx.lineTo(pathPoints[i7].x, pathPoints[i7].y);
        tctx.closePath();
        tctx.clip();
        tctx.drawImage(l.canvas, 0, 0);
        tctx.restore();

        // вырезаем из слоя (перемещение) — в т.ч. с референса
        l.ctx.save();
        l.ctx.globalCompositeOperation = 'destination-out';
        l.ctx.beginPath();
        l.ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
        for (var i8 = 1; i8 < pathPoints.length; i8++) l.ctx.lineTo(pathPoints[i8].x, pathPoints[i8].y);
        l.ctx.closePath();
        l.ctx.fill();
        l.ctx.restore();

        selection = {
          img: temp,
          x: minx,
          y: miny,
          w: bw,
          h: bh,
          layerId: l.id,
          fromRef: !!l.isRef
        };
        selectionFromRef = !!l.isRef;

        var p3 = localXY(e);
        dragging = true; dragMode = 'move';
        dragOffX = p3.x - selection.x;
        dragOffY = p3.y - selection.y;
        redrawPreview(); updateSelButtons(); pathPoints = [];
        return;
      }
      if (!drawing) return;
      drawing = false;
      if (!l.isRef) redraw(l.ctx, l, pathPoints);
      redrawPreview(); pathPoints = [];
    }



    // ---- pointer события
    wrap.addEventListener('pointerdown', function (e) {
      if (isTimeExpired()) return;
      try { wrap.setPointerCapture(e.pointerId); } catch (_) { }
      e.preventDefault();

      // Режим лупы: панорамирование
      if (tool() === 'zoom') {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartOffsetX = panX;
        panStartOffsetY = panY;
        updateToolCursor();
        return;
      }

      if (tool() === 'select') {
        // ПКМ — отмена выделения и возврат объекта
        if (e.button === 2) {
          var baseLayer = selection ? findLayerById(selection.layerId) : layers[active];
          if (baseLayer && beforeSelectSnapshot) {
            applyImageToLayer(baseLayer, beforeSelectSnapshot);
          }
          selection = null;
          selectionFromRef = false;
          selecting = false;
          dragging = false;
          dragMode = null;
          beforeSelectSnapshot = null;
          redrawPreview();
          updateSelButtons();
          return;
        }
        if (selection) {
          var p = localXY(e);
          var hit = hitHandle(p.x, p.y);
          if (hit) {
            dragging = true; dragMode = hit;
            dragOffX = p.x - selection.x; dragOffY = p.y - selection.y;
          }
          return;
        }
      }

      beginDraw(e);
    });

    wrap.addEventListener('pointermove', function (e) {
      if (isTimeExpired()) return;
      if (isPanning && tool() === 'zoom') {
        e.preventDefault();
        var dx = e.clientX - panStartX;
        var dy = e.clientY - panStartY;
        panX = panStartOffsetX + dx;
        panY = panStartOffsetY + dy;
        applyViewTransform();
        return;
      }
      moveDraw(e);
    });

    wrap.addEventListener('pointerup', function (e) {
      if (isTimeExpired()) return;
      if (isPanning && tool() === 'zoom') {
        isPanning = false;
        updateToolCursor();
        return;
      }
      endDraw(e);
    });
    wrap.addEventListener('pointerleave', function (e) {
      if (isTimeExpired()) return;
      if (isPanning && tool() === 'zoom') {
        isPanning = false;
        updateToolCursor();
        return;
      }
      endDraw(e);
    });
    wrap.addEventListener('contextmenu', function (e) { if (tool() === 'select') { e.preventDefault(); } });



    wrap.addEventListener('pointermove', moveDraw);
    wrap.addEventListener('pointerup', endDraw);
    wrap.addEventListener('pointerleave', endDraw);
    wrap.addEventListener('contextmenu', function (e) { if (tool() === 'select') { e.preventDefault(); } });


    // Зум колесиком мыши в режиме лупы
    wrap.addEventListener('wheel', function (e) {
      if (isTimeExpired()) return;
      if (tool() !== 'zoom') return;
      e.preventDefault();
      var delta = e.deltaY || 0;
      if (delta === 0) return;
      var factor = delta > 0 ? 1.1 : 1 / 1.1;
      var newZoom = zoomLevel * factor;
      newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
      // Снэп к 1.0 чтобы легко вернуться в исходный масштаб
      if (Math.abs(newZoom - 1) < 0.05) newZoom = 1;
      zoomLevel = newZoom;
      applyViewTransform();
    }, { passive: false });

    document.addEventListener('mousemove', function (e) {
      if (isTimeExpired()) return;
      var l = layers[active]; if (!l) return;
      var r = l.canvas.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        lastPos = {
          x: clamp((e.clientX - r.left) * (W / r.width), 0, W),
          y: clamp((e.clientY - r.top) * (H / r.height), 0, H)
        };
        if (tool() === 'brush' || tool() === 'eraser') redrawPreview();
      }
    });

    // ---- кнопки подтверждения/отмены выделения
    if (confirmSelBtn) confirmSelBtn.addEventListener('click', function () {
      if (isTimeExpired()) return;
      if (!selection) return;

      var dest = layers[active];
      if (!dest) return;

      var srcLayer = findLayerById(selection.layerId);
      var fromRef = !!selection.fromRef;

      // если выделение с референс-слоя — всегда возвращаем на него
      if (fromRef && srcLayer) {
        dest = srcLayer;
      }

      if (!dest.isRef) {
        snapshot(dest);
      }
      dest.ctx.drawImage(selection.img, selection.x, selection.y, selection.w, selection.h);

      selection = null; selectionFromRef = false;
      selecting = false; dragging = false; dragMode = null; beforeSelectSnapshot = null;
      redrawPreview(); updateSelButtons();
    });

    if (cancelSelBtn) cancelSelBtn.addEventListener('click', function () {
      if (isTimeExpired()) return;
      var baseLayer = selection ? findLayerById(selection.layerId) : layers[active];
      if (baseLayer && beforeSelectSnapshot) {
        applyImageToLayer(baseLayer, beforeSelectSnapshot);
      }
      selection = null; selectionFromRef = false;
      selecting = false; dragging = false; dragMode = null; beforeSelectSnapshot = null;
      redrawPreview(); updateSelButtons();
    });

    // ---- пипетка
    function pickColorAt(pos) {
      var off = document.createElement('canvas'); off.width = W; off.height = H;
      var o = off.getContext('2d');
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i]; if (!l.visible) continue;
        o.globalAlpha = l.opacity;
        o.drawImage(l.canvas, 0, 0);
      }
      var d = o.getImageData(Math.floor(pos.x), Math.floor(pos.y), 1, 1).data;
      function hx(n) { return ('0' + n.toString(16)).slice(-2); }
      var hex = '#' + hx(d[0]) + hx(d[1]) + hx(d[2]);
      if (colorInp) colorInp.value = hex;
    }

    if (sizeInp) sizeInp.addEventListener('input', function () { showSizeHUD(size()); });

    // ---- хоткеи кисти / пипетки / толщины
    document.addEventListener('keydown', function (e) {
      if (isTimeExpired()) return;
      if ((e.target && ('value' in e.target)) && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      var code = e.code || '';
      var key = (e.key || '').toLowerCase();

      if (code === 'KeyB' || key === 'b' || key === 'и') {
        if (toolSel) { toolSel.value = 'brush'; toolSel.dispatchEvent(new Event('change')); }
        e.preventDefault(); return;
      }
      if (code === 'KeyE' || key === 'e' || key === 'у') {
        if (toolSel) {
          toolSel.value = 'eraser'; toolSel.dispatchEvent(new Event('change'));
          if (!colorInp.value) colorInp.value = '#ffffff';
        }
        e.preventDefault(); return;
      }

      // Пипетка — только по P / З, без Ctrl/Meta/Alt
      if (!e.ctrlKey && !e.metaKey && !e.altKey &&
        (code === 'KeyP' || key === 'p' || key === 'з')) {
        pickColorAt(lastPos);
        e.preventDefault();
        return;
      }

      if (code === 'BracketRight' || key === ']' || key === 'ъ') {
        if (sizeInp) {
          sizeInp.value = String(clamp(Number(sizeInp.value) + 2, 1, 120));
          sizeInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault(); return;
      }
      if (code === 'BracketLeft' || key === '[' || key === 'х') {
        if (sizeInp) {
          sizeInp.value = String(clamp(Number(sizeInp.value) - 2, 1, 120));
          sizeInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault(); return;
      }
      if (code === 'Equal' || key === '=') {
        if (alphaInp) {
          alphaInp.value = String(clamp(Number(alphaInp.value) + 0.05, 0, 1));
          alphaInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault(); return;
      }
      if (code === 'Minus' || key === '-') {
        if (alphaInp) {
          alphaInp.value = String(clamp(Number(alphaInp.value) - 0.05, 0, 1));
          alphaInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault(); return;
      }
    });

    // ---- хоткеи undo/redo и copy/paste (работают в обеих раскладках)
    document.addEventListener('keydown', function (e) {
      if (isTimeExpired()) return;
      var target = e.target;
      var tag = target && target.tagName ? target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

      var code = e.code || '';
      var key = (e.key || '').toLowerCase();

      // UNDO: Z / Я (с Ctrl или без, но без Alt)
      if (!e.altKey && (code === 'KeyZ' || key === 'z' || key === 'я')) {
        e.preventDefault();
        undo();
        return;
      }

      // REDO: A / Ф (с Ctrl или без, но без Alt)
      if (!e.altKey && (code === 'KeyA' || key === 'a' || key === 'ф')) {
        e.preventDefault();
        redo();
        return;
      }

      // COPY: C / С (с Ctrl или без, но без Alt)
      if (!e.altKey && (code === 'KeyC' || key === 'c' || key === 'с')) {
        if (selection) {
          e.preventDefault();
          copySelection();
        }
        return;
      }

      // PASTE: V / М (с Ctrl или без, но без Alt)
      if (!e.altKey && (code === 'KeyV' || key === 'v' || key === 'м')) {
        e.preventDefault();
        pasteSelection();
        return;
      }
    });

    // ---- экспорт PNG (без HUD и референсов)
    function exportComposite() {
      var prevHUD = hudEnabled; hudEnabled = false; exporting = true; preview.ctx.clearRect(0, 0, W, H);
      var off = document.createElement('canvas'); off.width = W; off.height = H;
      var ctx = off.getContext('2d');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (!l.visible || l.isRef) continue;
        if (l.opacity <= 0) continue;
        ctx.globalAlpha = l.opacity;
        ctx.drawImage(l.canvas, 0, 0);
      }
      return new Promise(function (res) {
        off.toBlob(function (b) {
          hudEnabled = prevHUD; exporting = false; redrawPreview(); res(b);
        }, 'image/png');
      });
    }

    window.drawAPI = window.drawAPI || {};
    window.drawAPI.exportCompositeBlob = function () { return exportComposite(); };

    // ---- инициализация
    (function initBase() {
      var base = makeLayer('Базовый слой', false);
      if (baseImageUrl) {
        try { base.canvas.style.opacity = '1'; } catch (_) { }
        var img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = function () { base.ctx.clearRect(0, 0, W, H); drawImageFit(base.ctx, img); };
        img.onerror = function () { console.warn('[draw.js] baseImageUrl load failed'); };
        img.src = baseImageUrl;
      }
      setZ(); buildLayerList(); updateSelButtons();
      applyLockState();
    })();
  };
})();
