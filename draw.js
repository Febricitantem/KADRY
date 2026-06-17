// draw.js — редактор с таймером, слоями, выделением и глобальной историей
// @ts-nocheck
(function () {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hsvToRgb(h, s, v) {
    h = (h % 360 + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
    var c = v * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, v = max;
    var d = max - min;
    s = max === 0 ? 0 : d / max;

    if (d !== 0) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, v: v };
  }

  function hexToRgb(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    if (hex[0] === '#') hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var num = parseInt(hex, 16);
    if (isNaN(num)) return { r: 0, g: 0, b: 0 };
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function rgbToHex(r, g, b) {
    function hx(n) {
      n = Math.max(0, Math.min(255, Math.round(n)));
      return ('0' + n.toString(16)).slice(-2);
    }
    return '#' + hx(r) + hx(g) + hx(b);
  }
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
      // подписи с процентами под ползунками
    var sizeValEl = document.getElementById('brushSizeValue');
    var alphaValEl = document.getElementById('brushAlphaValue');
    var smoothValEl = document.getElementById('brushSmoothValue');
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
    // палитра справа
    var colorWheelCanvas = document.getElementById('colorWheel');
    var hueSlider = document.getElementById('hueSlider');
    var satSlider = document.getElementById('satSlider');
    var valSlider = document.getElementById('valSlider');
    var hueTrack = hueSlider ? hueSlider.parentElement : null;
    var satTrack = satSlider ? satSlider.parentElement : null;
    var valTrack = valSlider ? valSlider.parentElement : null;
    var colorHistoryButtons = Array.prototype.slice.call(
      document.querySelectorAll('.color-history-swatch')
    );
    var colorPreviewEl = document.getElementById('colorPreview');
    var smoothValueLabel = document.getElementById('brushSmoothValue');

function updateSmoothLabel() {
  if (!smoothInp || !smoothValueLabel) return;
  var pct = clamp(Number(smoothInp.value) || 0, 0, 100);
  smoothValueLabel.textContent = pct + '%';
}


    var currentHSV = { h: 0, s: 1, v: 1 };
    var lastStrokeColorHex = null;
    var colorHistory = [];
    var isPickingColor = false;
    if (!wrap) { console.warn('canvasWrap not found'); return; }

    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';

    // ВАЖНО ДЛЯ ОСНОВНОГО РЕДАКТОРА:
    // кадры игры всегда рисуются и экспортируются строго 1920×1080.
    // Это защищает художников от ситуации, когда при рисовании они видят одно,
    // а после публикации картинка растягивается/сжимается.
    // Пользовательский размер разрешён только для отдельных режимов, например аватарок.
    var allowCustomCanvas = opts.allowCustomCanvas === true || opts.canvasPreset === 'avatar';
    var W = 1920;
    var H = 1080;
    if (allowCustomCanvas) {
      W = Number(opts.canvasWidth || opts.width || 1920);
      H = Number(opts.canvasHeight || opts.height || 1080);
      if (!isFinite(W) || W <= 0) W = 1920;
      if (!isFinite(H) || H <= 0) H = 1080;
      W = Math.round(W);
      H = Math.round(H);
    }
    try {
      document.documentElement.style.setProperty('--kadry-canvas-w', String(W));
      document.documentElement.style.setProperty('--kadry-canvas-h', String(H));
      document.documentElement.style.setProperty('--kadry-canvas-ratio', String(W) + ' / ' + String(H));
      wrap.setAttribute('aria-label', 'Рабочий холст ' + W + '×' + H);
    } catch (_) {}
    // ---- палитра справа (HSV-круг, слайдеры и история цветов)
    function applyHSVToUI() {
      var rgb = hsvToRgb(currentHSV.h, currentHSV.s, currentHSV.v);
      var hex = rgbToHex(rgb.r, rgb.g, rgb.b);

      if (colorInp) colorInp.value = hex;

      if (hueSlider) hueSlider.value = currentHSV.h;
      if (satSlider) satSlider.value = Math.round(currentHSV.s * 100);
      if (valSlider) valSlider.value = Math.round(currentHSV.v * 100);

      // визуальные градиенты дорожек (градиент кладём на track-обёртки)
      if (hueTrack) {
        hueTrack.style.background =
          'linear-gradient(to right, ' +
          'red, yellow, lime, cyan, blue, magenta, red)';
      }
      if (satTrack) {
        var rgbFull = hsvToRgb(currentHSV.h, 1, currentHSV.v);
        satTrack.style.background =
          'linear-gradient(to right, #808080, ' +
          rgbToHex(rgbFull.r, rgbFull.g, rgbFull.b) + ')';
      }
      if (valTrack) {
        var rgbFull2 = hsvToRgb(currentHSV.h, currentHSV.s, 1);
        valTrack.style.background =
          'linear-gradient(to right, #000000, ' +
          rgbToHex(rgbFull2.r, rgbFull2.g, rgbFull2.b) + ')';
      }

      drawColorWheel();
      if (isPickingColor) updateColorPreview();
    }

    function setColorFromHex(hex) {
      var rgb = hexToRgb(hex || '#000000');
      var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      currentHSV = { h: hsv.h, s: hsv.s, v: hsv.v };
      applyHSVToUI();
    }

    function pushColorToHistory(hex) {
      if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
      if (colorHistory.length && colorHistory[0] === hex) return;
      colorHistory.unshift(hex);
      if (colorHistory.length > 10) colorHistory.length = 10;
      updateColorHistoryUI();
    }

    function updateColorHistoryUI() {
      if (!colorHistoryButtons || !colorHistoryButtons.length) return;
      for (var i = 0; i < colorHistoryButtons.length; i++) {
        var btn = colorHistoryButtons[i];
        var c = colorHistory[i] || '#ffffff';
        btn.style.backgroundColor = c;
        btn.dataset.color = c;
      }
    }

    function updateColorPreview() {
      if (!colorPreviewEl) return;
      if (!isPickingColor) {
        colorPreviewEl.style.opacity = '0';
        return;
      }
      var hex = colorInp ? colorInp.value || '#000000' : '#000000';
      colorPreviewEl.style.background = hex;
      colorPreviewEl.style.opacity = '1';
    }

    
    function drawColorWheel() {
      if (!colorWheelCanvas) return;
      var ctx = colorWheelCanvas.getContext('2d');
      if (!ctx) return;

      var w = colorWheelCanvas.width;
      var h = colorWheelCanvas.height;
      var cx = w / 2;
      var cy = h / 2;
      var outerR = Math.min(cx, cy) - 4;
      var innerR = outerR - 18;
      var rTri = innerR - 4;

      ctx.clearRect(0, 0, w, h);

      // кольцо оттенков (H)
      ctx.lineWidth = outerR - innerR;
      for (var angle = 0; angle < 360; angle++) {
        var start = (angle - 1) * Math.PI / 180;
        var end = angle * Math.PI / 180;
        var rgb = hsvToRgb(angle, 1, 1);
        ctx.strokeStyle = rgbToHex(rgb.r, rgb.g, rgb.b);
        ctx.beginPath();
        ctx.arc(cx, cy, (outerR + innerR) / 2, start, end);
        ctx.stroke();
      }

      // координаты треугольника
      var sin60 = Math.sin(Math.PI / 3);
      var cos60 = Math.cos(Math.PI / 3);
      var p0 = { x: cx,                    y: cy - rTri };              // белый
      var p1 = { x: cx - rTri * sin60,     y: cy + rTri * cos60 };       // чёрный
      var p2 = { x: cx + rTri * sin60,     y: cy + rTri * cos60 };       // цвет

      // раскраска треугольника по HSV (приближение, берём сетку точек)
      var imgData = ctx.getImageData(0, 0, w, h);
      var data = imgData.data;
      function barycentric(px, py) {
        var den = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
        if (den === 0) return null;
        var w0 = ((p1.y - p2.y) * (px - p2.x) + (p2.x - p1.x) * (py - p2.y)) / den;
        var w1 = ((p2.y - p0.y) * (px - p2.x) + (p0.x - p2.x) * (py - p2.y)) / den;
        var w2 = 1 - w0 - w1;
        return { w0: w0, w1: w1, w2: w2 };
      }

      var minX = Math.floor(cx - rTri), maxX = Math.ceil(cx + rTri);
      var minY = Math.floor(cy - rTri), maxY = Math.ceil(cy + rTri);

      for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
          var bc = barycentric(x + 0.5, y + 0.5);
          if (!bc) continue;
          if (bc.w0 < 0 || bc.w1 < 0 || bc.w2 < 0) continue;
          var S = Math.max(0, Math.min(1, bc.w2));
          var V = Math.max(0, Math.min(1, bc.w0 + bc.w2));
          var rgbInside = hsvToRgb(currentHSV.h, S, V);
          var idx = (y * w + x) * 4;
          data[idx] = rgbInside.r;
          data[idx + 1] = rgbInside.g;
          data[idx + 2] = rgbInside.b;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // индикатор выбранного оттенка на кольце
      var angRad = currentHSV.h * Math.PI / 180;
      var ringR = (outerR + innerR) / 2;
      var hx = cx + ringR * Math.cos(angRad);
      var hy = cy + ringR * Math.sin(angRad);
      ctx.save();
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      ctx.restore();

      // индикатор внутри треугольника (S,B)
      var Scur = Math.max(0, Math.min(1, currentHSV.s));
      var Vcur = Math.max(0, Math.min(1, currentHSV.v));

      // ограничиваем область: V >= S
      if (Vcur < Scur) Vcur = Scur;

      var w2 = Scur;
      var w1 = 1 - Vcur;
      var w0 = Vcur - Scur;
      var px = w0 * p0.x + w1 * p1.x + w2 * p2.x;
      var py = w0 * p0.y + w1 * p1.y + w2 * p2.y;

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      ctx.restore();
    }

    function initPaletteUI() {
      function startPick() {
        isPickingColor = true;
        updateColorPreview();
      }
      function endPick() {
        isPickingColor = false;
        updateColorPreview();
      }

      function triangleGeometry() {
        if (!colorWheelCanvas) return null;
        var w = colorWheelCanvas.width;
        var h = colorWheelCanvas.height;
        var cx = w / 2;
        var cy = h / 2;
        var outerR = Math.min(cx, cy) - 4;
        var innerR = outerR - 18;
        var rTri = innerR - 4;
        var sin60 = Math.sin(Math.PI / 3);
        var cos60 = Math.cos(Math.PI / 3);
        var p0 = { x: cx,                    y: cy - rTri };
        var p1 = { x: cx - rTri * sin60,     y: cy + rTri * cos60 };
        var p2 = { x: cx + rTri * sin60,     y: cy + rTri * cos60 };
        return { cx: cx, cy: cy, outerR: outerR, innerR: innerR, rTri: rTri, p0: p0, p1: p1, p2: p2 };
      }

      function barycentric(px, py, g) {
        var p0 = g.p0, p1 = g.p1, p2 = g.p2;
        var den = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
        if (den === 0) return null;
        var w0 = ((p1.y - p2.y) * (px - p2.x) + (p2.x - p1.x) * (py - p2.y)) / den;
        var w1 = ((p2.y - p0.y) * (px - p2.x) + (p0.x - p2.x) * (py - p2.y)) / den;
        var w2 = 1 - w0 - w1;
        return { w0: w0, w1: w1, w2: w2 };
      }

      if (colorWheelCanvas) {
        var handleWheel = function (e) {
          var rect = colorWheelCanvas.getBoundingClientRect();
          var x = e.clientX - rect.left;
          var y = e.clientY - rect.top;
          var g = triangleGeometry();
          if (!g) return;
          var dx = x - g.cx;
          var dy = y - g.cy;
          var dist = Math.sqrt(dx * dx + dy * dy);

          // кольцо
          if (dist >= g.innerR && dist <= g.outerR) {
            var angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (angle < 0) angle += 360;
            currentHSV.h = angle;
            applyHSVToUI();
            return;
          }

          // треугольник
          var bc = barycentric(x, y, g);
          if (!bc) return;
          if (bc.w0 < -0.01 || bc.w1 < -0.01 || bc.w2 < -0.01) return;

          var S = Math.max(0, Math.min(1, bc.w2));
          var V = Math.max(0, Math.min(1, bc.w0 + bc.w2));
          currentHSV.s = S;
          currentHSV.v = V;
          applyHSVToUI();
        };

        colorWheelCanvas.addEventListener('pointerdown', function (e) {
          startPick();
          handleWheel(e);
          function moveHandler(ev) { handleWheel(ev); }
          function upHandler() {
            colorWheelCanvas.removeEventListener('pointermove', moveHandler);
            window.removeEventListener('pointerup', upHandler);
            endPick();
          }
          colorWheelCanvas.addEventListener('pointermove', moveHandler);
          window.addEventListener('pointerup', upHandler);
        });
      }

      if (hueSlider) {
        hueSlider.addEventListener('input', function () {
          currentHSV.h = Number(hueSlider.value) || 0;
          applyHSVToUI();
        });
        hueSlider.addEventListener('pointerdown', function () {
          startPick();
          function upHandler() {
            window.removeEventListener('pointerup', upHandler);
            endPick();
          }
          window.addEventListener('pointerup', upHandler);
        });
      }

      if (satSlider) {
        satSlider.addEventListener('input', function () {
          currentHSV.s = (Number(satSlider.value) || 0) / 100;
          applyHSVToUI();
        });
        satSlider.addEventListener('pointerdown', function () {
          startPick();
          function upHandler() {
            window.removeEventListener('pointerup', upHandler);
            endPick();
          }
          window.addEventListener('pointerup', upHandler);
        });
      }

      if (valSlider) {
        valSlider.addEventListener('input', function () {
          currentHSV.v = (Number(valSlider.value) || 0) / 100;
          applyHSVToUI();
        });
        valSlider.addEventListener('pointerdown', function () {
          startPick();
          function upHandler() {
            window.removeEventListener('pointerup', upHandler);
            endPick();
          }
          window.addEventListener('pointerup', upHandler);
        });
      }

      if (colorHistoryButtons && colorHistoryButtons.length) {
        colorHistoryButtons.forEach(function (btn) {
          btn.addEventListener('click', function () {
            var hex = btn.dataset.color;
            if (hex) setColorFromHex(hex);
          });
        });
      }

      // стартовые значения
      if (colorInp && colorInp.value) {
        setColorFromHex(colorInp.value);
      } else {
        setColorFromHex('#000000');
      }
      updateColorHistoryUI();
    }
// ---- таймер / блокировка
    function isTimeExpired() { return document.body.classList.contains('time-expired'); }

    var hudEnabled = true;
    var exporting = false;
    var drawing = false;
    var selecting = false;
    var dragging = false;
    var brushCursorVisible = true; // флаг, можно ли рисовать круг-курсор кисти
        // Сброс всех "живых" действий (мазок, превью, выделение)
    function cancelLiveOps() {
      // текущий мазок
      drawing = false;
      pathPoints = [];

      // выделение / перетаскивание
      selecting = false;
      dragging = false;
      dragMode = null;

      // если было произвольное выделение — убираем его визуально
      selection = null;
      selectionFromRef = false;
      beforeSelectSnapshot = null;

      // чистим превью-холст, чтобы не висел хвост линии
      if (preview && preview.ctx) {
        preview.ctx.clearRect(0, 0, W, H);
      }

      // обновляем интерфейс
      redrawPreview();
      updateSelButtons();
    }



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
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].id === id) return layers[i];
      }
      return null;
    }

    // UNDO с очисткой живого мазка / выделения
    function undo() {
      if (isTimeExpired()) return;

      // если в данный момент рисуем или тянем выделение — гасим это
      cancelLiveOps();

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

    // REDO тоже сначала убирает живое действие
    function redo() {
      if (isTimeExpired()) return;

      cancelLiveOps();

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
      if (!smoothInp) return 0;
      var v = Number(smoothInp.value);
      if (!isFinite(v) || isNaN(v)) v = 0;

      // v = 0..100 → 0..1 → чуть усиливаем эффект до 0..1.2
      var t = clamp(v / 100, 0, 1);
      return t * 1.2;
    }
        function updateBrushHUD() {
      // Толщина: процент относительно максимума слайдера
      if (sizeValEl && sizeInp) {
        var maxSize = Number(sizeInp.max) || 60;
        var curSize = Number(sizeInp.value) || 1;
        var pctSize = Math.round(curSize / maxSize * 100);
        sizeValEl.textContent = pctSize + '%';
      }

      // Прозрачность: 0..1 → 0..100%
      if (alphaValEl && alphaInp) {
        var a = Number(alphaInp.value);
        if (!isFinite(a) || isNaN(a)) a = 1;
        var pctAlpha = Math.round(a * 100);
        alphaValEl.textContent = pctAlpha + '%';
      }

      // Сглаживание: берём как есть из ползунка (0..100)
      if (smoothValEl && smoothInp) {
        var s = Number(smoothInp.value) || 0;
        smoothValEl.textContent = Math.round(s) + '%';
      }
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

  // базовое значение из слайдера 0..1
  var s = smooth();

  // Преобразуем в “ощутимое” сглаживание:
  // 0   → 0 (выкл)
  // 0.5 → ~0.575
  // 1   → 1 (максимально гладко)
  var t = 0;
  if (s > 0) {
    t = 0.15 + s * 0.85; // минимум 0.15, максимум 1
  }

  if (tool() === 'fill') {
    drawSmoothFill(ctx, pts, t);
  } else {
    drawSmoothPath(ctx, pts, t);
  }
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

      // 🔥 если активна пипетка или мы явно скрыли курсор — ничего не рисуем
      if (window.__kadryEyedropperOn) return;
      if (!brushCursorVisible) return;

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
      if (t === 'brush') {
        lastStrokeColorHex = colorInp ? colorInp.value : '#000000';
      }
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
          var s = smooth();
var t = s > 0 ? 0.15 + s * 0.85 : 0;
drawSmoothFill(p2, pathPoints, t);

          p2.restore();
        }
        return;
      }
          if (!drawing) return;
      pathPoints.push(lastPos);

      // Ластик: сразу стираем на реальном слое,
      // а на preview показываем только круг курсора.
      if (tool() === 'eraser') {
        // применяем ластик «вживую»
        redraw(l.ctx, l, pathPoints);

        // preview — только HUD без чёрного хвоста
        preview.ctx.clearRect(0, 0, W, H);
        if (hudEnabled) {
          drawCursorCircle();
        }
        return;
      }

      // Для остальных инструментов: линия на preview, слой обновляется при отпускании.
      preview.ctx.clearRect(0, 0, W, H);
      if (hudEnabled) {
        // рисуем временную линию
        redraw(preview.ctx, l, pathPoints);
        // и поверх — круг курсора
        drawCursorCircle();
      }


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
      if (t === 'brush' && lastStrokeColorHex) {
        pushColorToHistory(lastStrokeColorHex);
      }
    }



    // ---- pointer события
    wrap.addEventListener('pointerdown', function (e) {
      // ❌ Блокируем long-press на стилусе, который эмулирует правую кнопку
if (e.pointerType === 'pen' && e.button === 2) {
  e.preventDefault();
  return;
}

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
    wrap.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // блокируем ВСЕ варианты правого клика
});




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
      setColorFromHex(hex);
    }

        if (sizeInp) sizeInp.addEventListener('input', function () {
      showSizeHUD(size());
      updateBrushHUD();
    });

    if (alphaInp) alphaInp.addEventListener('input', function () {
      updateBrushHUD();
    });

    if (smoothInp) smoothInp.addEventListener('input', function () {
      updateBrushHUD();
    });


    // ---- хоткеи кисти / пипетки / толщины + зум
    document.addEventListener('keydown', function (e) {
      if (isTimeExpired()) return;

  // Не трогаем ТОЛЬКО текстовые поля / textarea,
  // но даём работать хоткеям, даже если фокус на слайдере (range)
  const target = e.target;
  const tag = target && target.tagName ? target.tagName.toUpperCase() : '';

  if (tag === 'TEXTAREA') return;

  if (tag === 'INPUT') {
    const type = (target.type || '').toLowerCase();
    const textLike = ['text', 'search', 'email', 'url', 'password', 'number'];
    if (textLike.indexOf(type) !== -1) return;
  }

  var code = e.code || '';
  var key = (e.key || '').toLowerCase();

      // --- инструменты ---

      // Кисть (B / И)
      if (code === 'KeyB' || key === 'b' || key === 'и') {
        if (toolSel) {
          toolSel.value = 'brush';
          toolSel.dispatchEvent(new Event('change'));
        }
        e.preventDefault();
        return;
      }

      // Ластик (E / У)
      if (code === 'KeyE' || key === 'e' || key === 'у') {
        if (toolSel) {
          toolSel.value = 'eraser';
          toolSel.dispatchEvent(new Event('change'));
          if (!colorInp.value) colorInp.value = '#ffffff';
        }
        e.preventDefault();
        return;
      }

      // Пипетка — только по P / З, без Ctrl/Meta/Alt
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (code === 'KeyP' || key === 'p' || key === 'з')
      ) {
        pickColorAt(lastPos);
        e.preventDefault();
        return;
      }

      // --- толщина кисти ---

      // Увеличить толщину (] / Ъ)
      if (code === 'BracketRight' || key === ']' || key === 'ъ') {
        if (sizeInp) {
          sizeInp.value = String(clamp(Number(sizeInp.value) + 2, 1, 120));
          sizeInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault();
        return;
      }

      // Уменьшить толщину ([ / Х)
      if (code === 'BracketLeft' || key === '[' || key === 'х') {
        if (sizeInp) {
          sizeInp.value = String(clamp(Number(sizeInp.value) - 2, 1, 120));
          sizeInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault();
        return;
      }

      // --- непрозрачность кисти ---

      // Больше непрозрачность (=)
      if (code === 'Equal' || key === '=') {
        if (alphaInp) {
          alphaInp.value = String(
            clamp(Number(alphaInp.value) + 0.05, 0, 1)
          );
          alphaInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault();
        return;
      }

      // Меньше непрозрачность (-)
      if (code === 'Minus' || key === '-') {
        if (alphaInp) {
          alphaInp.value = String(
            clamp(Number(alphaInp.value) - 0.05, 0, 1)
          );
          alphaInp.dispatchEvent(new Event('input'));
        }
        e.preventDefault();
        return;
      }

      // --- ЗУМ по стрелкам (только в режиме "Лупа") ---

      if (code === 'ArrowUp') {
        if (toolSel && toolSel.value === 'zoom') {
          var factorUp = 1.1;
          var newZoomUp = zoomLevel * factorUp;
          newZoomUp = Math.max(minZoom, Math.min(maxZoom, newZoomUp));
          if (Math.abs(newZoomUp - 1) < 0.05) newZoomUp = 1;
          zoomLevel = newZoomUp;
          applyViewTransform();
          e.preventDefault();
        }
        return;
      }

      if (code === 'ArrowDown') {
        if (toolSel && toolSel.value === 'zoom') {
          var factorDown = 1 / 1.1;
          var newZoomDown = zoomLevel * factorDown;
          newZoomDown = Math.max(minZoom, Math.min(maxZoom, newZoomDown));
          if (Math.abs(newZoomDown - 1) < 0.05) newZoomDown = 1;
          zoomLevel = newZoomDown;
          applyViewTransform();
          e.preventDefault();
        }
        return;
      }
    });


    // ---- хоткеи undo/redo и copy/paste (работают в обеих раскладках)
    document.addEventListener('keydown', function (e) {
      if (isTimeExpired()) return;
  const target = e.target;
  const tag = target && target.tagName ? target.tagName.toUpperCase() : '';

  // textarea и contentEditable — не трогаем, там нужно печатать
  if (tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

  // input: блокируем только текстовые типы, но НЕ range/checkbox/button и т.п.
  if (tag === 'INPUT') {
    const type = (target.type || '').toLowerCase();
    const textLike = ['text', 'search', 'email', 'url', 'password', 'number'];
    if (textLike.indexOf(type) !== -1) return;
  }

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

    // экспорт PNG
    window.drawAPI.exportCompositeBlob = function () {
      return exportComposite();
    };

    // управление кружком курсора кисти (используется из editor.html)
    window.drawAPI.setBrushCursorVisible = function (visible) {
      brushCursorVisible = !!visible;
      redrawPreview(); // перерисуем превью, чтобы кружок сразу исчез / появился
    };

       // ---- инициализация
    initPaletteUI();

    // сразу выставляем проценты для толщины / прозрачности / сглаживания
    updateBrushHUD();

    // этот кусок можно оставить — он отдельно обновляет подпись сглаживания
    if (smoothInp) {
      updateSmoothLabel();
      smoothInp.addEventListener('input', updateSmoothLabel);
    }

    (function initBase() {
      var base = makeLayer('Базовый слой', false);
      if (baseImageUrl) {
        try { base.canvas.style.opacity = '1'; } catch (_) { }
        var img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = function () {
          base.ctx.clearRect(0, 0, W, H);
          drawImageFit(base.ctx, img);
        };
        img.onerror = function () {
          console.warn('[draw.js] baseImageUrl load failed');
        };
        img.src = baseImageUrl;
      }
      setZ();
      buildLayerList();
      updateSelButtons();
      applyLockState();
    })();

  };
})();
