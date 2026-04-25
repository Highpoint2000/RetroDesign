////////////////////////////////////////////////////////////
///                                                      ///
///  RETRODESIGN SCRIPT FOR FM-DX-WEBSERVER     (V1.1)   ///
///                                                      ///
///  by Highpoint                last update: 24.04.25   ///
///                                                      ///
///  https://github.com/Highpoint2000/RetroDesign        ///
///                                                      ///
////////////////////////////////////////////////////////////

(() => {
  const PLUGIN_VERSION = "1.1";
  const PLUGIN_NAME    = "RetroDesign";
  const pluginHomepageUrl = "https://github.com/Highpoint2000/RetroDesign/releases";
  const pluginUpdateUrl   = "https://raw.githubusercontent.com/Highpoint2000/RetroDesign/main/RetroDesign/retrodesign.js";
  const CHECK_FOR_UPDATES = true;

  let FM_MIN = 87.5;
  let FM_MAX = 108.0;

  // Try to read the server-side tuning limit from the HTML (Webserver-Config)
  const limitSpan = document.querySelector('.tuner-desc .color-4');
  if (limitSpan && limitSpan.textContent.includes('MHz')) {
    const match = limitSpan.textContent.match(/([\d.]+)\s*MHz\s*-\s*([\d.]+)\s*MHz/);
    if (match && match.length === 3) {
      FM_MIN = parseFloat(match[1]);
      FM_MAX = parseFloat(match[2]);
      console.log(`[RetroDesign] Limits detected: ${FM_MIN} - ${FM_MAX} MHz`);
    }
  }
  
  // The lower the value, the heavier and smoother the needle trails
  const SMOOTHING = 0.160;

  let isVisible   = false;
  let currentFreq = null;
  let animFreq    = null;
  let dragFreq    = null;
  let rafId       = null;

  // --- DYNAMICALLY SUPPRESS SPECTRUM HIGHLIGHTER ---
  // We slightly override the browser's default drawing function to hide the white cursor line
  const originalFillRect = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function(x, y, w, h) {
      // If the original spectrum is trying to draw AND the Retro Scale is currently visible...
      if (this.canvas && this.canvas.id === 'sdr-graph' && isVisible) {
          // ...and it is exactly the highlighter line (which always starts at y = 9)
          if (y === 9) {
              return; // Abort! Do not draw the line.
          }
      }
      // Otherwise (or if the Retro Scale is closed), draw normally
      originalFillRect.call(this, x, y, w, h);
  };
  // ---------------------------------------------------

  // ── Performance Optimization State ────────────────────────
  let lastScaleFrame = 0;
  let lastMagicEyeFrame = 0;
  const TARGET_FPS = 30; // Limit animations to 30 frames per second
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  // "Dirty checking" memory - only redraw when these values actually change
  let lastDrawnFreq = -999;
  let lastDrawnOuterAngle = -999;
  let lastDrawnInnerAngle = -999;
  let lastDrawnVuL = -999;
  let lastDrawnVuR = -999;
  let lastDrawnMagicEyeLevel = -999;
  // ──────────────────────────────────────────────────────────
  
  // DOM Elements (Analog Scale)
  let scaleWrap   = null;
  let scaleCanvas = null;
  let knobCanvas  = null;
  let vuCanvas    = null;

  // DOM Elements (Magic Eye)
  let magicEyeCanvas = null;
  let magicEyeLightCanvas = null;
  let magicEyeLevel = 0;

  // ── Settings State ────────────────────────────────────────
  // Default to true if not explicitly set to 'false'
  let isAutostart       = localStorage.getItem('analog_scale_autostart') !== 'false';
  let isVuEnabled       = localStorage.getItem('analog_vu_enabled') !== 'false';
  let isMagicEyeEnabled = localStorage.getItem('magic_eye_enabled') !== 'false';
  let currentBrightness = parseFloat(localStorage.getItem('analog_scale_brightness')) || 1.50;

  // ── Drag / Tune state ─────────────────────────────────────
  let isDraggingScale = false;
  let isDraggingOuterKnob = false;
  let isDraggingInnerKnob = false;
  let lastDragAngle  = 0;
  
  let accumulatedOuterAngle = 0;
  let accumulatedInnerAngle = 0;
  
  let outerKnobAngle = 0;
  let innerKnobAngle = 0;
  
  let isFineTuningMode = false;
  let knobDragMoved = false;

  const TUNE_INTERVAL = 80;
  let lastTuneTime   = 0;
  let finalTuneTimer = null;

  // ── Flywheel / Inertia State ──────────────────────────────
  let outerVelocity = 0;
  let innerVelocity = 0;
  const FRICTION = 0.90; // Friction: 0.90 to 0.98 (higher = spins longer)
  let lastDragTime = 0;

  // ── Layout Metrics ─────────────────────────────────────────
  let mX, mY, mW, mH; // Scale window bounds
  let knobX, knobY, knobOuterR, knobInnerR; // Knob bounds

  // ── Audio Variables for VU & Magic Eye ─────────────────────
  let audioInitialized = false;
  let audioCtx = null;
  let analyserL = null, analyserR = null;
  let dataL = null, dataR = null;
  let currentVuLeft = 0, currentVuRight = 0;

  // ── Audio Context Initialization ───────────────────────────
  function tryInitAudio() {
      if (audioInitialized) return;
      if (typeof Stream !== 'undefined' && Stream && Stream.Fallback && Stream.Fallback.Player && Stream.Fallback.Player.Amplification) {
          try {
              let source = Stream.Fallback.Player.Amplification;
              if (!source.context) return;
              audioCtx = source.context;
              let splitter = audioCtx.createChannelSplitter(2);
              analyserL = audioCtx.createAnalyser();
              analyserR = audioCtx.createAnalyser();
              analyserL.fftSize = 1024;
              analyserR.fftSize = 1024;
              dataL = new Float32Array(analyserL.fftSize);
              dataR = new Float32Array(analyserR.fftSize);
              try { source.connect(splitter); } catch(e){}
              try { splitter.connect(analyserL, 0); } catch(e){}
              try { splitter.connect(analyserR, 1); } catch(e){}
              audioInitialized = true;
          } catch(e) {}
      }
  }

  function getLevel(floatArray) {
      if (!floatArray || floatArray.length === 0) return 0;
      let max = 0;
      for (let i = 0; i < floatArray.length; i++) {
          let abs = Math.abs(floatArray[i]);
          if (abs > max) max = abs;
      }
      if (max < 0.01) return 0; 
      return Math.min(1.0, max * 2.0); 
  }

  // ── Update Check ──────────────────────────────────────────
  function _checkUpdate() {
    fetch(pluginUpdateUrl + "?t=" + Date.now(), { cache: "no-store" })
      .then(r => r.ok ? r.text() : null)
      .then(txt => {
        if (!txt) return;
        const m = txt.match(/const\s+PLUGIN_VERSION\s*=\s*["']([^"']+)["']/);
        if (!m) return;
        const remote = m[1];
        if (remote === PLUGIN_VERSION) return;
        console.log("[" + PLUGIN_NAME + "] Update available: " + PLUGIN_VERSION + " → " + remote);

        const settings = document.getElementById("plugin-settings");
        if (settings && settings.innerHTML.indexOf(pluginHomepageUrl) === -1) {
          settings.innerHTML +=
            "<br><a href='" + pluginHomepageUrl + "' target='_blank'>[" +
            PLUGIN_NAME + "] Update: " + PLUGIN_VERSION + " → " + remote + "</a>";
        }

        const icon =
          document.querySelector(".wrapper-outer #navigation .sidenav-content .fa-puzzle-piece") ||
          document.querySelector(".wrapper-outer .sidenav-content") ||
          document.querySelector(".sidenav-content");
        if (icon && !icon.querySelector("." + PLUGIN_NAME + "-update-dot")) {
          const dot = document.createElement("span");
          dot.className = PLUGIN_NAME + "-update-dot";
          dot.style.cssText =
            "display:block;width:12px;height:12px;border-radius:50%;" +
            "background-color:#FE0830;margin-left:82px;margin-top:-12px;";
          icon.appendChild(dot);
        }
      })
      .catch(e => console.warn("[" + PLUGIN_NAME + "] Update check failed:", e));
  }

  // ── Read CSS variables from the active theme (MEMORY OPTIMIZED) ──
  let _cachedTheme = null;
  let _lastThemeCheck = 0;

  function getTheme() {
    const now = Date.now();
    // Only query the DOM for CSS variables every 2 seconds to prevent Layout Thrashing
    if (_cachedTheme && (now - _lastThemeCheck < 2000)) {
        return _cachedTheme;
    }
    
    const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    _cachedTheme = {
      bg1:     cssVar("--color-1", "#071c33"),
      bg2:     cssVar("--color-2", "#0d2640"),
      accent:  cssVar("--color-4", "#3abf9a"),
      text:    cssVar("--color-text", "#e0e0e0")
    };
    _lastThemeCheck = now;
    return _cachedTheme;
  }

  const _colorCache = {};
  // Create ONE single canvas for color parsing, instead of a new one every time (Reduces Garbage Collection)
  const _parseCanvas = document.createElement("canvas");
  _parseCanvas.width = 1; _parseCanvas.height = 1;
  const _parseCtx = _parseCanvas.getContext("2d", { willReadFrequently: true });

  function parseColor(cssColor) {
    if (_colorCache[cssColor]) return _colorCache[cssColor];
    
    _parseCtx.fillStyle = "#000"; _parseCtx.fillRect(0,0,1,1);
    _parseCtx.fillStyle = cssColor; _parseCtx.fillRect(0,0,1,1);
    const d = _parseCtx.getImageData(0,0,1,1).data;
    
    const result = { r: d[0], g: d[1], b: d[2] };
    _colorCache[cssColor] = result;
    return result;
  }

  function rgba(cssColor, alpha) {
    const { r, g, b } = parseColor(cssColor);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── Apply Layout Configuration ────────────────────────────
  function applyScaleLayout() {
      if (!scaleWrap) return;
      const scaleDiv = document.getElementById("analog-scale-container");
      const knobDiv = document.getElementById("analog-knob-container");
      const vuDiv = document.getElementById("analog-vu-container");
      
      if (isVuEnabled) {
          scaleDiv.style.flex = "0 0 59%";
          knobDiv.style.flex = "0 0 12%";
          vuDiv.style.display = "block";
          vuDiv.style.flex = "0 0 30%"; 
      } else {
          // Hide VU and extend Scale width to fill the gap
          scaleDiv.style.flex = "0 0 88%";
          knobDiv.style.flex = "0 0 12%";
          vuDiv.style.display = "none";
      }
      resizeCanvas();
      if (!rafId && isVisible) {
          lastDrawnFreq = -999; // Force redraw
          drawScale(scaleCanvas, animFreq);
          if (knobCanvas) { lastDrawnOuterAngle = -999; drawKnob(knobCanvas); }
      }
  }

  function toggleMagicEyeVisibility() {
      const wrapper = document.getElementById('magic-eye-wrapper');
      if (wrapper) {
          if (isMagicEyeEnabled) {
              wrapper.classList.remove('magic-eye-hidden');
          } else {
              wrapper.classList.add('magic-eye-hidden');
          }
      }
  }

  // ── Inject Settings UI ────────────────────────────────────
  function injectSettingsUI() {
    const modalContent = document.querySelector('.modal-panel-content');
    if (!modalContent) {
      setTimeout(injectSettingsUI, 500);
      return;
    }

    const imperialInput = document.getElementById('imperial-units');
    if (!imperialInput || document.getElementById('analog-settings-wrapper')) return;

    let baseWrapper = imperialInput;
    while (baseWrapper.parentElement && !baseWrapper.parentElement.classList.contains('auto')) {
        baseWrapper = baseWrapper.parentElement;
    }

    const container = document.createElement('div');
    container.id = 'analog-settings-wrapper';
    container.style.marginTop = '15px';
    container.style.marginBottom = '15px';
    container.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    container.style.paddingTop = '15px';

    // Helper to clone standard webserver settings switches
    function addToggle(id, labelText, checkedState, onChange) {
        const clone = baseWrapper.cloneNode(true);
        const input = clone.querySelector('input');
        if (input) {
            input.id = id;
            input.checked = checkedState;
            input.addEventListener('change', onChange);
        }
        function replaceText(node) {
            if (node.nodeType === 3 && /imperial units/i.test(node.nodeValue)) {
                node.nodeValue = node.nodeValue.replace(/imperial units/i, labelText);
            } else {
                if (node.tagName === 'LABEL' && node.getAttribute('for') === 'imperial-units') {
                    node.setAttribute('for', id);
                }
                node.childNodes.forEach(replaceText);
            }
        }
        replaceText(clone);
        container.appendChild(clone);
    }

    addToggle('analog-scale-autostart', 'AUTOSTART FM SCALE', isAutostart, (e) => {
        isAutostart = e.target.checked;
        localStorage.setItem('analog_scale_autostart', isAutostart);
    });

    addToggle('analog-vu-toggle', 'ENABLE VU METER', isVuEnabled, (e) => {
        isVuEnabled = e.target.checked;
        localStorage.setItem('analog_vu_enabled', isVuEnabled);
        applyScaleLayout();
    });

    addToggle('magic-eye-toggle', 'ENABLE MAGIC EYE', isMagicEyeEnabled, (e) => {
        isMagicEyeEnabled = e.target.checked;
        localStorage.setItem('magic_eye_enabled', isMagicEyeEnabled);
        toggleMagicEyeVisibility();
    });

    const sliderDiv = document.createElement('div');
    sliderDiv.className = 'panel-full flex-center no-bg m-0';
    sliderDiv.style.flexDirection = 'column';
    sliderDiv.style.marginTop = '15px';
	sliderDiv.innerHTML = `
        <span class="text-bold" style="color: var(--color-4); text-transform: uppercase; font-size: 13px; margin-bottom: 8px; display: block;">FM Scale Brightness</span>
        <div style="width: 220px;">
            <input type="range" id="analog-scale-brightness" min="0.2" max="1.8" step="0.05" value="${currentBrightness}">
        </div>
    `;
    const slider = sliderDiv.querySelector('input');
    slider.addEventListener('input', (e) => {
        currentBrightness = parseFloat(e.target.value);
        localStorage.setItem('analog_scale_brightness', currentBrightness);
        if (!rafId && scaleCanvas && isVisible) {
            lastDrawnFreq = -999; // Force redraw to apply brightness
            drawScale(scaleCanvas, animFreq);
        }
    });
    container.appendChild(sliderDiv);

    baseWrapper.parentNode.insertBefore(container, baseWrapper.nextSibling);
  }

  // ── Tune command ──────────────────────────────────────────
  function tuneTo(freq) {
    freq = Math.round(freq * 100) / 100;
    const input = document.getElementById("commandinput");
    if (!input) return;
    input.value = freq.toFixed(2);
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Helper functions ──────────────────────────────────────
  function snapFreq(f) {
      const step = 0.1;
      let snappedOffset = Math.round((f - FM_MIN) / step) * step;
      let snappedFreq = FM_MIN + snappedOffset;
      return parseFloat(Math.max(FM_MIN, Math.min(FM_MAX, snappedFreq)).toFixed(3));
  }

  // ── Drag / Inertia handlers ───────────────────────────────
  function getClientX(evt) {
    if (evt.touches && evt.touches.length > 0) return evt.touches[0].clientX;
    return evt.clientX;
  }
  
  function getClientY(evt) {
      if (evt.touches && evt.touches.length > 0) return evt.touches[0].clientY;
      return evt.clientY;
  }

  function getAngle(x, y) {
      return Math.atan2(y - knobY, x - knobX);
  }

  function updateMetrics(sW, sH, kW) {
    mX = sW * 0.005 + 10; 
    mY = sH * 0.10;
    mW = sW - mX * 2 - 10;
    mH = sH * 0.80;
    
    knobX = kW * 0.5; 
    knobY = sH * 0.5;
    knobOuterR = Math.min(kW * 0.45, sH * 0.45); 
    knobInnerR = knobOuterR * 0.65;
  }

  function applyKnobRotation(isOuter, deltaAngle) {
      let f = currentFreq;
      const step = 0.1;

      if (isOuter) {
          outerKnobAngle += deltaAngle;
          accumulatedOuterAngle += deltaAngle;
          const anglePerStep = Math.PI / 20; 
          if (Math.abs(accumulatedOuterAngle) >= anglePerStep) {
              const steps = Math.trunc(accumulatedOuterAngle / anglePerStep);
              accumulatedOuterAngle -= steps * anglePerStep;
              f = snapFreq(f);
              f += steps * step;
          }
      } else {
          innerKnobAngle += deltaAngle;
          accumulatedInnerAngle += deltaAngle;
          const anglePerInnerStep = Math.PI / 6; 
          if (Math.abs(accumulatedInnerAngle) >= anglePerInnerStep) {
              const steps = Math.trunc(accumulatedInnerAngle / anglePerInnerStep);
              accumulatedInnerAngle -= steps * anglePerInnerStep;
              if (!isFineTuningMode) {
                  f = snapFreq(f);
                  f += steps * step; 
              } else {
                  f += steps * (step / 10);
                  f = parseFloat(f.toFixed(4));
              }
          }
      }

      f = Math.max(FM_MIN, Math.min(FM_MAX, f));
      f = parseFloat(f.toFixed(3));
      
      if (dragFreq !== f) {
          dragFreq = f; 
          currentFreq = f; // New target for the needle
          
          const now = Date.now();
          if (now - lastTuneTime > TUNE_INTERVAL) { tuneTo(f); lastTuneTime = now; }
          clearTimeout(finalTuneTimer);
          finalTuneTimer = setTimeout(() => {
              const finalF = isFineTuningMode ? parseFloat(dragFreq.toFixed(3)) : snapFreq(dragFreq);
              tuneTo(finalF);
          }, 100);
      }
  }

  function startKnobDrag(evt) {
    if (!knobCanvas) return;
    const rect = knobCanvas.getBoundingClientRect();
    const x = getClientX(evt) - rect.left;
    const y = getClientY(evt) - rect.top;

    const dx = x - knobX;
    const dy = y - knobY;
    const distSq = dx * dx + dy * dy;
    
    knobDragMoved = false; 
    outerVelocity = 0; // Stop wheel on grab
    innerVelocity = 0; 
    lastDragTime = Date.now(); 

    if (distSq <= knobInnerR * knobInnerR) {
        isDraggingInnerKnob = true;
        lastDragAngle = getAngle(x, y);
        knobCanvas.style.cursor = "grabbing";
    } else if (distSq <= knobOuterR * knobOuterR) {
        isDraggingOuterKnob = true;
        accumulatedOuterAngle = 0; 
        lastDragAngle = getAngle(x, y);
        knobCanvas.style.cursor = "grabbing";
    }
  }

  function handleGlobalMove(evt) {
    if (!scaleCanvas || !knobCanvas) return;
    if (isDraggingOuterKnob || isDraggingInnerKnob || isDraggingScale) {
        if (evt.cancelable) evt.preventDefault();
    } else {
        return; 
    }
    
    if (isDraggingOuterKnob || isDraggingInnerKnob) {
        const rect = knobCanvas.getBoundingClientRect();
        const x = getClientX(evt) - rect.left;
        const y = getClientY(evt) - rect.top;

        const currentAngle = getAngle(x, y);
        let deltaAngle = currentAngle - lastDragAngle;
        
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

        if (Math.abs(deltaAngle) > 0.02) {
            knobDragMoved = true;
        }

        lastDragTime = Date.now(); // Track time for momentum calculation
        
        // Apply rotation and store velocity
        if (isDraggingOuterKnob) {
            outerVelocity = deltaAngle; 
            applyKnobRotation(true, deltaAngle);
        } else {
            innerVelocity = deltaAngle; 
            applyKnobRotation(false, deltaAngle);
        }
        lastDragAngle = currentAngle;

    } else if (isDraggingScale) {
        const rect = scaleCanvas.getBoundingClientRect();
        const x = getClientX(evt) - rect.left;

        const paperX = mX + 2;
        const paperW = mW - 4;
        const tX = paperX + paperW * 0.04;
        const tW = paperW * 0.92;
        
        let rawF = FM_MIN + ((x - tX) / tW) * (FM_MAX - FM_MIN);
        let f = isFineTuningMode ? rawF : snapFreq(rawF);
        
        f = Math.max(FM_MIN, Math.min(FM_MAX, f));
        f = parseFloat(f.toFixed(3));
        
        if (dragFreq !== f) {
            dragFreq = f; 
            currentFreq = f; 
            animFreq = f; // Hard snap since we are dragging the scale directly
            
            const now = Date.now();
            if (now - lastTuneTime > TUNE_INTERVAL) { tuneTo(f); lastTuneTime = now; }
            clearTimeout(finalTuneTimer);
            finalTuneTimer = setTimeout(() => {
                const finalF = isFineTuningMode ? parseFloat(dragFreq.toFixed(3)) : snapFreq(dragFreq);
                tuneTo(finalF);
            }, 100);
        }
    }
  }

  function stopDrag() {
    const wasActivelyDragging = (isDraggingScale) || ((isDraggingInnerKnob || isDraggingOuterKnob) && knobDragMoved);

    if ((isDraggingInnerKnob || isDraggingOuterKnob) && !knobDragMoved) {
        isFineTuningMode = !isFineTuningMode;
        if (navigator.vibrate) navigator.vibrate(50);
        if (knobCanvas) {
            lastDrawnOuterAngle = -999; // Force redraw
            drawKnob(knobCanvas);
        }
    }

    // If held still before releasing, kill momentum
    if (Date.now() - lastDragTime > 50) {
        outerVelocity = 0;
        innerVelocity = 0;
    }

    isDraggingOuterKnob = false;
    isDraggingInnerKnob = false;
    isDraggingScale = false;
    if (scaleCanvas) scaleCanvas.style.cursor = "default";
    if (knobCanvas) knobCanvas.style.cursor = "default";
    clearTimeout(finalTuneTimer);
    
    if (wasActivelyDragging && dragFreq !== null) {
        const finalF = isFineTuningMode ? parseFloat(dragFreq.toFixed(3)) : snapFreq(dragFreq);
        tuneTo(finalF);
    }
  }

  function startScaleDrag(evt) {
    if (!scaleCanvas) return;
    const rect = scaleCanvas.getBoundingClientRect();
    const x = getClientX(evt) - rect.left;
    const y = getClientY(evt) - rect.top;

    // --- CHECK: WAS REFRESH CLICKED? ---
    const sdrBtnClick = document.getElementById('spectrum-graph-button');
    const isSpecVisibleClick = sdrBtnClick && (sdrBtnClick.classList.contains('active') || sdrBtnClick.classList.contains('bg-color-4'));

    const scanBtnLeft = mX + mW - 75; 
    const scanBtnRight = mX + mW - 25;
    const scanBtnTop = mY;
    const scanBtnBottom = mY + 30;

    // Only allow clicking if the spectrum is actually visible
    if (isSpecVisibleClick && x >= scanBtnLeft && x <= scanBtnRight && y >= scanBtnTop && y <= scanBtnBottom) {
        const origBtn = document.getElementById('spectrum-scan-button');
        if (origBtn) origBtn.click(); // Trigger scan

        window._retroScanClicked = Date.now();
        
        // TRICK: Force the scale to redraw every frame for the next 4 seconds 
        window._forceRedrawUntil = Date.now() + 4000;

        if (typeof animFreq !== 'undefined' && animFreq !== null) drawScale(scaleCanvas, animFreq);
        return; // Prevents the scale from being grabbed!
    }
    // ------------------------------------

    // Normal grabbing function for the scale
    if (x >= mX && x <= mX + mW && y >= mY && y <= mY + mH) {
        isDraggingScale = true;
        scaleCanvas.style.cursor = "col-resize";
        handleGlobalMove(evt);
    }
  }

  // ── Hide/restore other canvas elements ────────────────────
  function mmHide(el) {
    if (!el || el.dataset.asHid !== undefined) return;
    el.dataset.asHid = el.style.display ?? "";
    el.style.display = "none";
  }
  function mmRestore(el) {
    if (!el || el.dataset.asHid === undefined) return;
    el.style.display = el.dataset.asHid;
    delete el.dataset.asHid;
  }
  function setStdCanvases(show) {
    ["signal-canvas", "sdr-graph", "Antenna", "containerRotator", "sdr-graph-button-container", "mm-mpx-combo-flex", "mm-signal-analyzer-flex", "mm-scope-flex"].forEach(id => {
      const el = document.getElementById(id);
      show ? mmRestore(el) : mmHide(el);
    });
  }
  function applyWrapperStyle() {
    const cc = document.querySelector(".canvas-container.hide-phone");
    if (!cc) return;
    cc.style.cssText += ";padding:0;margin:0;lineHeight:0;overflow:visible";
    const p = cc.parentElement;
    if (p) {
      const cs = getComputedStyle(p);
      const pL = parseFloat(cs.paddingLeft)  || 0;
      const pR = parseFloat(cs.paddingRight) || 0;
      cc.style.marginLeft  = `-${pL}px`;
      cc.style.marginRight = `-${pR}px`;
      cc.style.width       = `calc(98.4% + ${pL + pR}px)`;
    }
  }
  function resetWrapperStyle() {
    const cc = document.querySelector(".canvas-container.hide-phone");
    if (!cc) return;
    const mmActive = ["mm-mpx-combo-flex", "mm-signal-analyzer-flex", "mm-scope-flex"].some(id => {
      const el = document.getElementById(id);
      return el && (el.style.display === "flex" || el.dataset.asHid === "flex");
    });
    if (!mmActive) {
      ["padding", "margin", "lineHeight", "overflow", "marginLeft", "marginRight", "width"].forEach(p => cc.style[p] = "");
    }
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Rendering Functions ────────────────────────────────────
  function drawSilverKnurledRing(ctx, radius, width, ridges, angleOffset) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.arc(0, 0, radius - width, 0, Math.PI * 2, true);
      
      const silverGrad = ctx.createLinearGradient(-radius, -radius, radius, radius);
      silverGrad.addColorStop(0, "#777777");
      silverGrad.addColorStop(0.2, "#aaaaaa");
      silverGrad.addColorStop(0.5, "#555555");
      silverGrad.addColorStop(0.8, "#bbbbbb");
      silverGrad.addColorStop(1, "#444444");
      ctx.fillStyle = silverGrad;
      ctx.fill();

      ctx.lineWidth = 1.0;
      for (let i = 0; i < ridges; i++) {
          const angle = (i / ridges) * Math.PI * 2 + angleOffset;
          const x1 = Math.cos(angle) * radius;
          const y1 = Math.sin(angle) * radius;
          const x2 = Math.cos(angle) * (radius - width);
          const y2 = Math.sin(angle) * (radius - width);

          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

          const a2 = angle + (Math.PI * 2 / ridges) * 0.4;
          const x3 = Math.cos(a2) * radius;
          const y3 = Math.sin(a2) * radius;
          const x4 = Math.cos(a2) * (radius - width);
          const y4 = Math.sin(a2) * (radius - width);
          ctx.strokeStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x4, y4); ctx.stroke();
      }
  }
  
  function drawConcentricKnob(ctx, x, y, outerR, innerR, T) {
      ctx.save();
      ctx.translate(x, y);
      
      ctx.beginPath();
      ctx.arc(0, 0, outerR + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
      ctx.fill();
      ctx.shadowColor = "transparent";

      ctx.beginPath();
      ctx.arc(0, 0, outerR, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.stroke();

      drawSilverKnurledRing(ctx, outerR, outerR * 0.07, 80, outerKnobAngle);

      ctx.beginPath();
      ctx.arc(0, 0, outerR * 0.93, 0, Math.PI * 2);
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowColor = "transparent";

      const outerDarkR = outerR * 0.93;
      ctx.beginPath();
      ctx.arc(0, 0, outerDarkR, 0, Math.PI * 2);
      
      const outerGrad = ctx.createLinearGradient(-outerDarkR, -outerDarkR, outerDarkR, outerDarkR);
      outerGrad.addColorStop(0, rgba(T.bg2, 1.0));
      outerGrad.addColorStop(0.5, rgba(T.bg1, 0.9));
      outerGrad.addColorStop(1, rgba(T.bg1, 1.0));
      ctx.fillStyle = outerGrad;
      ctx.fill();

      const outerDimpleX = Math.cos(outerKnobAngle - Math.PI / 2) * (outerDarkR * 0.82);
      const outerDimpleY = Math.sin(outerKnobAngle - Math.PI / 2) * (outerDarkR * 0.82);

      ctx.beginPath(); ctx.arc(outerDimpleX, outerDimpleY, outerR * 0.06, 0, Math.PI * 2);
      const outerDimpleGrad = ctx.createRadialGradient(outerDimpleX, outerDimpleY, 0, outerDimpleX, outerDimpleY, outerR * 0.06);
      
      if (!isFineTuningMode) { 
          outerDimpleGrad.addColorStop(0, "#ffffff");
          outerDimpleGrad.addColorStop(1, "#3498db");
          ctx.shadowColor = "#3498db"; ctx.shadowBlur = 8;
      } else {
          outerDimpleGrad.addColorStop(0, "#111");
          outerDimpleGrad.addColorStop(1, rgba(T.bg2, 1.0));
      }
      ctx.fillStyle = outerDimpleGrad; ctx.fill(); ctx.shadowColor = "transparent";

      ctx.beginPath(); ctx.arc(outerDimpleX, outerDimpleY, outerR * 0.06, 0, Math.PI * 2);
      ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke(); ctx.shadowColor = "transparent";

      ctx.beginPath();
      ctx.arc(0, 0, innerR + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,1.0)";
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 10;
      ctx.shadowOffsetX = 4;
      ctx.fill();
      ctx.shadowColor = "transparent";
      
      ctx.beginPath();
      ctx.arc(0, 0, innerR + 1, 0, Math.PI * 1);
      ctx.fillStyle = "#000000";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, innerR + 1, 0, Math.PI * 2);
      const rimGrad = ctx.createLinearGradient(0, -innerR, 0, innerR);
      rimGrad.addColorStop(0, rgba(T.bg2, 1.0));
      rimGrad.addColorStop(1, "#111");
      ctx.fillStyle = rimGrad;
      ctx.fill();
      
      drawSilverKnurledRing(ctx, innerR, innerR * 0.10, 60, innerKnobAngle);

      ctx.beginPath();
      ctx.arc(0, 0, innerR * 0.90, 0, Math.PI * 2);
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowColor = "transparent";

      const innerDarkR = innerR * 0.90;
      ctx.beginPath();
      ctx.arc(0, 0, innerDarkR, 0, Math.PI * 2);
      const innerGrad = ctx.createLinearGradient(-innerDarkR, -innerDarkR, innerDarkR, innerDarkR);
      innerGrad.addColorStop(0, rgba(T.bg2, 1.0));
      innerGrad.addColorStop(0.6, rgba(T.bg1, 0.9));
      innerGrad.addColorStop(1, rgba(T.bg1, 1.0));
      ctx.fillStyle = innerGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, innerDarkR, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      const highlightGrad = ctx.createLinearGradient(0, -innerDarkR, 0, innerDarkR);
      highlightGrad.addColorStop(0, "rgba(255,255,255,0.4)");
      highlightGrad.addColorStop(0.3, "rgba(255,255,255,0.05)");
      highlightGrad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = highlightGrad;
      ctx.stroke();
      
      const dimpleX = Math.cos(innerKnobAngle - Math.PI / 2) * (innerDarkR * 0.7);
      const dimpleY = Math.sin(innerKnobAngle - Math.PI / 2) * (innerDarkR * 0.7);

      ctx.beginPath();
      ctx.arc(dimpleX, dimpleY, innerR * 0.08, 0, Math.PI * 2);
      const dimpleGrad = ctx.createRadialGradient(dimpleX, dimpleY, 0, dimpleX, dimpleY, innerR * 0.08);
      
      if (isFineTuningMode) { 
          dimpleGrad.addColorStop(0, "#ffffff"); 
          dimpleGrad.addColorStop(1, "#3498db"); 
          ctx.shadowColor = "#3498db"; ctx.shadowBlur = 8;
      } else {
          dimpleGrad.addColorStop(0, "#111"); 
          dimpleGrad.addColorStop(1, rgba(T.bg2, 1.0));
      }
      ctx.fillStyle = dimpleGrad; ctx.fill(); ctx.shadowColor = "transparent";

      ctx.beginPath();
      ctx.arc(dimpleX, dimpleY, innerR * 0.08, 0, Math.PI * 2);
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
      ctx.shadowColor = "transparent";

      ctx.beginPath();
      ctx.arc(dimpleX, dimpleY, innerR * 0.08, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.restore(); 
  }

  function drawScale(canvas, freq) {
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    const CW  = canvas.width  / dpr;
    const CH  = canvas.height / dpr;
    
    if(CW === 0 || CH === 0) return;
    
    const T   = getTheme(); 

    let dRange = FM_MAX - FM_MIN;
    let lblStep = 2, majStep = 2, midStep = 1, minStep = 0.1;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, CW, CH);

    ctx.fillStyle = rgba(T.bg1, 1.0); 
    ctx.fillRect(0, 0, CW, CH);
    
    const mR = 3;

    ctx.save();
    ctx.shadowColor  = "rgba(0,0,0,0.85)";
    ctx.shadowBlur   = 10;
    ctx.shadowOffsetY = 4;
    ctx.shadowOffsetX = 2;
    rrect(ctx, mX, mY, mW, mH, mR);
    ctx.fillStyle = rgba(T.bg1, 1.0); 
    ctx.fill();
    ctx.restore();

    ctx.save(); 
    ctx.filter = `brightness(${currentBrightness})`;

    const paperX = mX + 2;
    const paperY = mY + 2;
    const paperW = mW - 4;
    const paperH = mH - 4;

    ctx.fillStyle = rgba(T.bg2, 0.5);
    rrect(ctx, paperX, paperY, paperW, paperH, 2);
    ctx.fill();

    const paper = ctx.createRadialGradient(
      paperX + paperW * 0.5,  paperY + paperH * 0.5, paperH * 0.1,
      paperX + paperW * 0.5,  paperY + paperH * 0.5, paperW * 0.65
    );
    paper.addColorStop(0.00, rgba(T.accent, 0.80)); 
    paper.addColorStop(0.40, rgba(T.accent, 0.50)); 
    paper.addColorStop(1.00, rgba(T.accent, 0.10)); 
    ctx.fillStyle = paper;
    rrect(ctx, paperX, paperY, paperW, paperH, 2);
    ctx.fill();

    // --- START SPECTRUM OVERLAY ---
    try {
        const sdrCanvas = document.getElementById('sdr-graph');
        const specBtn = document.getElementById('spectrum-graph-button');
        
        const isSpecActive = specBtn && (specBtn.classList.contains('active') || specBtn.classList.contains('bg-color-4'));

        if (sdrCanvas && isSpecActive && sdrCanvas.width > 100) {
            
            const scaleStartX = paperX + paperW * 0.04;
            const scaleWidth = paperW * 0.92;
            const scaleBaseY = paperY + paperH * 0.85;

            const signalText = localStorage.getItem('signalUnit') || 'dbf';
            let sdrXOffset = (signalText === 'dbm') ? 36 : 30;

            const srcX = sdrXOffset + 1;
            const srcY = 16; 
            const srcW = sdrCanvas.width - sdrXOffset - 2;
            const srcH = sdrCanvas.height - 40; 

            const destX = scaleStartX;
            const destY = paperY + 2; 
            const destW = scaleWidth;
            const destH = (scaleBaseY - paperY) - 2;

            if (srcW > 0 && srcH > 0) {
                ctx.save();
                
                rrect(ctx, paperX, paperY, paperW, paperH, 2);
                ctx.clip();

                // Apply shadow filter
                ctx.filter = 'invert(1) grayscale(1) contrast(2.0) brightness(0.9)';
                ctx.globalAlpha = 0.3; 
                ctx.globalCompositeOperation = 'multiply';

                ctx.drawImage(sdrCanvas, srcX, srcY, srcW, srcH, destX, destY, destW, destH);

                ctx.restore();
            }
        }
    } catch (e) {
        console.warn("[RetroDesign] Error rendering spectrum background:", e);
    }
    // --- END SPECTRUM OVERLAY ---

    const tX    = paperX + paperW * 0.04;
    const tW    = paperW * 0.92;
    const baseY = paperY + paperH * 0.85;  
    const numY  = paperY + paperH * 0.32;  
    const fX    = f => tX + ((f - FM_MIN) / dRange) * tW;

    const inkColor = "rgba(10, 15, 20, 0.95)";
    const inkFaded = "rgba(10, 15, 20, 0.70)";

    ctx.beginPath();
    ctx.moveTo(tX, baseY);
    ctx.lineTo(tX + tW, baseY);
    ctx.strokeStyle = inkFaded;
    ctx.lineWidth   = 2.0;
    ctx.stroke();

    let iStart = Math.floor(FM_MIN / minStep);
    let iEnd = Math.ceil(FM_MAX / minStep);
    
    for (let i = iStart; i <= iEnd; i++) {
        const f = i * minStep;
        if (f < FM_MIN - 0.001 || f > FM_MAX + 0.001) continue;
        
        const x = fX(f);
        const isMaj = Math.abs(Math.round(f / majStep) * majStep - f) < 0.001;
        const isMid = !isMaj && Math.abs(Math.round(f / midStep) * midStep - f) < 0.001;
        
        let tH = paperH * 0.06, col = "rgba(10,15,20,0.5)", lw = 1.0;
        if (isMaj) { tH = paperH * 0.35; col = inkColor; lw = 2.0; } 
        else if (isMid) { tH = paperH * 0.22; col = inkColor; lw = 1.5; } 
        
        ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY - tH);
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
    }

    const numSize = Math.max(12, Math.min(18, paperW / 55));
    ctx.font         = `700 ${numSize}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = inkColor;

    let startNum = Math.ceil(FM_MIN / lblStep) * lblStep;
    for (let f = startNum; f <= FM_MAX + 0.001; f += lblStep) {
        let text = lblStep < 1 ? f.toFixed(1) : Math.round(f).toString();
        ctx.fillText(text, fX(f), numY);
    }

    const lblSize = Math.max(10, paperH * 0.20);
    const topTextY = paperY + 5;
    const smallLabelFont = `700 ${lblSize * 0.6}px Arial, sans-serif`;

    ctx.textBaseline = "top"; ctx.textAlign = "left"; 
    ctx.font = `900 ${lblSize}px "Arial Narrow", Arial, sans-serif`;
    ctx.fillStyle = inkColor; 
    ctx.fillText("FM", paperX + 8, topTextY);
    
    ctx.textAlign = "right"; 
    ctx.font = smallLabelFont;
    ctx.fillStyle = inkColor; 
    ctx.fillText("MHz", paperX + paperW - 8, topTextY);

    // --- START: PRINTED SCAN BUTTON ---
    const sdrBtnDraw = document.getElementById('spectrum-graph-button');
    const isSpecVisible = sdrBtnDraw && (sdrBtnDraw.classList.contains('active') || sdrBtnDraw.classList.contains('bg-color-4'));

    if (isSpecVisible) {
        ctx.font = `700 ${lblSize * 0.65}px Arial, sans-serif`; // Slightly larger for the symbol
        let scanColor = inkFaded;
        
        // Visual feedback: Red when clicked, darker ink when hovered
        if (window._retroScanClicked && Date.now() - window._retroScanClicked < 150) {
            scanColor = "#ff3300"; 
        } else if (window._retroScanHovered) {
            scanColor = inkColor; 
        }
        
        ctx.fillStyle = scanColor; 
        ctx.fillText("↻  ", paperX + paperW - 35, topTextY - 1); // Using Unicode Refresh Symbol
    }
    // --- END: PRINTED SCAN BUTTON ---

    const nx = fX(Math.max(FM_MIN, Math.min(FM_MAX, freq)));

    ctx.save();
    ctx.shadowColor   = "rgba(0,0,0,0.60)";
    ctx.shadowBlur    = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 1;
    
    ctx.beginPath();
    ctx.moveTo(nx, mY - 1);
    ctx.lineTo(nx, mY + mH + 1);
    ctx.strokeStyle = "#ff3300"; 
    ctx.lineWidth   = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(nx, mY);
    ctx.lineTo(nx, mY + mH);
    ctx.strokeStyle = "rgba(255,200,200,0.60)";
    ctx.lineWidth   = 0.9;
    ctx.stroke();

    const blockH = CH * 0.09;
    const blockW = 10;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.70)";
    ctx.shadowBlur  = 4;
    ctx.shadowOffsetY = 2;
    const topBlock = ctx.createLinearGradient(nx - blockW/2, 0, nx + blockW/2, 0);
    topBlock.addColorStop(0,   "#c01500");
    topBlock.addColorStop(0.4, "#ff3a1a");
    topBlock.addColorStop(0.6, "#ff3a1a");
    topBlock.addColorStop(1,   "#8a0d00");
    ctx.fillStyle = topBlock;
    ctx.fillRect(nx - blockW / 2, 0, blockW, blockH);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,200,180,0.45)";
    ctx.lineWidth   = 0.7;
    ctx.strokeRect(nx - blockW / 2, 0, blockW, blockH);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.70)";
    ctx.shadowBlur  = 4;
    ctx.shadowOffsetY = -1;
    const botBlock = ctx.createLinearGradient(nx - 4, 0, nx + 4, 0);
    botBlock.addColorStop(0,   "#8a0d00");
    botBlock.addColorStop(0.5, "#dd2a10");
    botBlock.addColorStop(1,   "#8a0d00");
    ctx.fillStyle = botBlock;
    ctx.fillRect(nx - 4, CH - blockH * 0.85, 8, blockH * 0.85);
    ctx.restore();

    ctx.restore(); 

    ctx.save();
    const bezelTop = ctx.createLinearGradient(0, mY, 0, mY + 6);
    bezelTop.addColorStop(0,   "rgba(255,255,255,0.40)");
    bezelTop.addColorStop(1,   "rgba(255,255,255,0.00)");
    ctx.fillStyle = bezelTop;
    ctx.fillRect(mX, mY, mW, 6);

    const bezelBot = ctx.createLinearGradient(0, mY + mH - 6, 0, mY + mH);
    bezelBot.addColorStop(0,   "rgba(0,0,0,0.00)");
    bezelBot.addColorStop(1,   "rgba(0,0,0,0.60)");
    ctx.fillStyle = bezelBot;
    ctx.fillRect(mX, mY + mH - 6, mW, 6);
    ctx.restore();

    ctx.save();
    rrect(ctx, mX, mY, mW, mH, mR);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth   = 1;
    ctx.stroke();
    rrect(ctx, mX + 1, mY + 1, mW - 2, mH - 2, mR - 1);
    ctx.strokeStyle = "rgba(0,0,0,0.50)";
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    rrect(ctx, mX, mY, mW, mH, mR);
    ctx.clip();
    const glare = ctx.createLinearGradient(0, mY, 0, mY + mH * 0.22);
    glare.addColorStop(0,   "rgba(255,255,255,0.08)");
    glare.addColorStop(1,   "rgba(255,255,255,0.00)");
    ctx.fillStyle = glare;
    ctx.fillRect(mX, mY, mW, mH * 0.22);
    
    ctx.beginPath();
    ctx.moveTo(mX + mW * 0.05, mY);
    ctx.lineTo(mX + mW * 0.30, mY);
    ctx.lineTo(mX + mW * 0.18, mY + mH * 0.55);
    ctx.lineTo(mX + mW * 0.00, mY + mH * 0.55);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.restore();

    ctx.restore(); 
  }

  function drawKnob(canvas) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    const CW  = canvas.width  / dpr;
    const CH  = canvas.height / dpr;
    
    if(CW === 0 || CH === 0) return;
    
    const T   = getTheme(); 

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, CW, CH);

    ctx.fillStyle = rgba(T.bg1, 1.0); 
    ctx.fillRect(0, 0, CW, CH);

    drawConcentricKnob(ctx, knobX, knobY, knobOuterR, knobInnerR, T);

    ctx.restore();
  }

  function drawVuMeter(canvas, levelL, levelR) {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = canvas.getContext("2d");
      const cw = canvas.width;
      const ch = canvas.height;
      
      if(cw === 0 || ch === 0) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      const w = cw / dpr;
      const h = ch / dpr;

      const T = getTheme();
      ctx.fillStyle = rgba(T.bg1, 1.0);
      ctx.fillRect(0, 0, w, h);

      const mR = 3; 
      const mX = 10;
      const vY = mY; 
      const vH = mH;
      const vW = w - 20;

      // Outer casing shadow
      ctx.save();
      ctx.shadowColor   = "rgba(0,0,0,0.85)";
      ctx.shadowBlur    = 10;
      ctx.shadowOffsetY = 4;
      ctx.shadowOffsetX = 2;
      rrect(ctx, mX, vY, vW, vH, mR);
      ctx.fillStyle = rgba(T.bg1, 1.0);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.filter = `brightness(${currentBrightness})`;

      const paperX = mX + 2;
      const paperY = vY + 2;
      const paperW = vW - 4;
      const paperH = vH - 4;

      ctx.fillStyle = rgba(T.bg2, 0.5);
      rrect(ctx, paperX, paperY, paperW, paperH, 2);
      ctx.fill();

      const paper = ctx.createRadialGradient(paperX + paperW * 0.5, paperY + paperH * 0.5, paperH * 0.1, paperX + paperW * 0.5, paperY + paperH * 0.5, paperW * 0.65);
      paper.addColorStop(0.00, rgba(T.accent, 0.80)); 
      paper.addColorStop(0.40, rgba(T.accent, 0.50)); 
      paper.addColorStop(1.00, rgba(T.accent, 0.10)); 
      ctx.fillStyle = paper; 
      rrect(ctx, paperX, paperY, paperW, paperH, 2); 
      ctx.fill();

      ctx.save();
      rrect(ctx, paperX, paperY, paperW, paperH, 2);
      ctx.clip();
      
      const innerTop = ctx.createLinearGradient(0, paperY, 0, paperY + 15);
      innerTop.addColorStop(0, "rgba(0,0,0,0.7)");
      innerTop.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = innerTop;
      ctx.fillRect(paperX, paperY, paperW, 15);
      
      const vignette = ctx.createRadialGradient(paperX + paperW/2, paperY + paperH/2, paperW*0.3, paperX + paperW/2, paperY + paperH/2, paperW*0.6);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vignette;
      rrect(ctx, paperX, paperY, paperW, paperH, 2);
      ctx.fill();
      ctx.restore();

      const cx1 = paperX + paperW * 0.26;
      const cx2 = paperX + paperW * 0.74;
      const cy  = paperY + paperH * 0.85;
      
      const radius = Math.min(paperW * 0.21, paperH * 0.48); 
      const minAngle = -1.00; 
      const maxAngle = 1.00;  

      drawDial(ctx, cx1, cy, radius, minAngle, maxAngle);
      drawDial(ctx, cx2, cy, radius, minAngle, maxAngle);

      const angleL = minAngle + (levelL * (maxAngle - minAngle));
      const angleR = minAngle + (levelR * (maxAngle - minAngle));

      drawNeedle(ctx, cx1, cy, radius * 0.9, angleL);
      drawNeedle(ctx, cx2, cy, radius * 0.9, angleR);

      ctx.restore();

      ctx.save();
      const bezelTop = ctx.createLinearGradient(0, vY, 0, vY + 6);
      bezelTop.addColorStop(0, "rgba(255,255,255,0.40)");
      bezelTop.addColorStop(1, "rgba(255,255,255,0.00)");
      ctx.fillStyle = bezelTop;
      ctx.fillRect(mX, vY, vW, 6);

      const bezelBot = ctx.createLinearGradient(0, vY + vH - 6, 0, vY + vH);
      bezelBot.addColorStop(0, "rgba(0,0,0,0.00)");
      bezelBot.addColorStop(1, "rgba(0,0,0,0.60)");
      ctx.fillStyle = bezelBot;
      ctx.fillRect(mX, vY + vH - 6, vW, 6);
      ctx.restore();

      ctx.save();
      rrect(ctx, mX, vY, vW, vH, mR);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
      rrect(ctx, mX + 1, vY + 1, vW - 2, vH - 2, mR - 1);
      ctx.strokeStyle = "rgba(0,0,0,0.50)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      rrect(ctx, mX, vY, vW, vH, mR);
      ctx.clip(); 
      const glare = ctx.createLinearGradient(0, vY, 0, vY + vH * 0.22);
      glare.addColorStop(0, "rgba(255,255,255,0.08)");
      glare.addColorStop(1, "rgba(255,255,255,0.00)");
      ctx.fillStyle = glare;
      ctx.fillRect(mX, vY, vW, vH * 0.22);
      
      ctx.beginPath(); 
      ctx.moveTo(mX + vW * 0.05, vY); 
      ctx.lineTo(mX + vW * 0.30, vY); 
      ctx.lineTo(mX + vW * 0.18, vY + vH * 0.55); 
      ctx.lineTo(mX + vW * 0.00, vY + vH * 0.55); 
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.03)"; 
      ctx.fill();
      ctx.restore();

      ctx.restore(); 
  }

  function drawDial(ctx, cx, cy, radius, minAngle, maxAngle) {
      const inkColor = "rgba(10, 15, 20, 0.85)";
      const redColor = "#e63946";
      const zeroAngle = minAngle + 0.8 * (maxAngle - minAngle); 

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.shadowOffsetX = 1;

      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * 1.5 + minAngle, Math.PI * 1.5 + zeroAngle);
      ctx.strokeStyle = inkColor; ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * 1.5 + zeroAngle, Math.PI * 1.5 + maxAngle);
      ctx.strokeStyle = redColor; ctx.stroke();

      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 4, Math.PI * 1.5 + minAngle, Math.PI * 1.5 + zeroAngle);
      ctx.strokeStyle = inkColor; ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 4, Math.PI * 1.5 + zeroAngle, Math.PI * 1.5 + maxAngle);
      ctx.strokeStyle = redColor; ctx.stroke();

      const ticks = [
          { label: '-20', pos: 0.0,   isRed: false, major: true },
          { label: '10',  pos: 0.25,  isRed: false, major: true },
          { label: '7',   pos: 0.4,   isRed: false, major: true },
          { label: '5',   pos: 0.52,  isRed: false, major: true },
          { label: '',    pos: 0.58,  isRed: false, major: false },
          { label: '3',   pos: 0.64,  isRed: false, major: true },
          { label: '',    pos: 0.69,  isRed: false, major: false },
          { label: '1',   pos: 0.74,  isRed: false, major: true },
          { label: '0',   pos: 0.8,   isRed: false, major: true },
          { label: '1',   pos: 0.86,  isRed: true,  major: true },
          { label: '',    pos: 0.895, isRed: true,  major: false },
          { label: '3',   pos: 0.93,  isRed: true,  major: true },
          { label: '',    pos: 0.965, isRed: true,  major: false },
          { label: '+5',  pos: 1.0,   isRed: true,  major: true }
      ];

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      ticks.forEach(t => {
          const angle = minAngle + t.pos * (maxAngle - minAngle);
          const aRad = Math.PI * 1.5 + angle;

          ctx.strokeStyle = t.isRed ? redColor : inkColor;
          ctx.fillStyle = t.isRed ? redColor : inkColor;
          ctx.lineWidth = t.major ? 2.5 : 1.5;

          const innerR = radius - 4;
          const outerR = t.major ? radius + 8 : radius + 3; 
          
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(aRad) * innerR, cy + Math.sin(aRad) * innerR);
          ctx.lineTo(cx + Math.cos(aRad) * outerR, cy + Math.sin(aRad) * outerR);
          ctx.stroke();

          if (t.label) {
              const fontSize = Math.max(9, radius * 0.12);
              ctx.font = `bold ${fontSize}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
              const textR = radius + (radius * 0.30); 
              ctx.fillText(t.label, cx + Math.cos(aRad) * textR, cy + Math.sin(aRad) * textR + (fontSize * 0.4));
          }
      });

      const vuSize = Math.max(10, radius * 0.18);
      ctx.font = `bold ${vuSize}px "Arial Narrow", Arial, sans-serif`;
      ctx.fillStyle = inkColor;
      ctx.fillText("VU", cx, cy - (radius * 0.25));

      ctx.restore();
  }

  function drawNeedle(ctx, cx, cy, length, angle) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.shadowColor   = "rgba(0,0,0,0.60)";
      ctx.shadowBlur    = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 1;
      
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -length);
      ctx.strokeStyle = "#ff3300"; ctx.lineWidth = 2.5; ctx.stroke();
      
      ctx.shadowColor = "transparent";
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -length);
      ctx.strokeStyle = "rgba(255,200,200,0.60)"; ctx.lineWidth = 0.9; ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, length * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = "#111"; ctx.fill();

      ctx.restore();
  }

  // ── Magic Eye Engine ────────────────────────────────────────
  function initMagicEye() {
      const signalValueSpan = document.getElementById('data-signal');
      if (!signalValueSpan) {
          setTimeout(initMagicEye, 1000);
          return;
      }

      let signalPanel = signalValueSpan.closest('.panel-33') || signalValueSpan.closest('div[class*="panel"]');
      if (!signalPanel) return;

      if (signalPanel.dataset.magicEyeInit === "true") return;
      signalPanel.dataset.magicEyeInit = "true";

      const rowWrapper = document.createElement('div');
      rowWrapper.className = 'magic-eye-row-wrapper';
      rowWrapper.style.display = "flex";
      rowWrapper.style.alignItems = "center";
      // Center the entire group so the Eye and Text stay close together
      rowWrapper.style.justifyContent = "center"; 
      rowWrapper.style.width = "100%";
      rowWrapper.style.minWidth = "0"; 
      rowWrapper.style.overflow = "hidden"; 

      const textWrapper = document.createElement('div');
      textWrapper.className = 'magic-eye-text-wrapper';
      
      // Fixed 55% width -> completely stops jitter and prevents it from pushing the Eye too far left
      textWrapper.style.flex = "0 0 55%"; 
      textWrapper.style.minWidth = "0"; 
      textWrapper.style.overflow = "hidden"; 
      textWrapper.style.whiteSpace = "nowrap"; 
      textWrapper.style.textAlign = "center"; 
      
      const children = Array.from(signalPanel.childNodes);
      children.forEach(child => {
          if (child.id === 'cci-aci-container') return;
          textWrapper.appendChild(child);
      });

      signalPanel.classList.add('magic-eye-panel-override');

      const wrapper = document.createElement('div');
      wrapper.id = "magic-eye-wrapper"; 
      
      wrapper.style.flex = "0 1 85px"; 
      wrapper.style.maxWidth = "30%"; 
      wrapper.style.aspectRatio = "1 / 1"; 
      wrapper.style.height = "auto";
      wrapper.style.position = "relative";
      wrapper.style.marginRight = "2%"; 
      wrapper.style.marginLeft = "4%"; 

      if (!isMagicEyeEnabled) wrapper.classList.add('magic-eye-hidden');
      
      magicEyeCanvas = document.createElement('canvas');
      magicEyeCanvas.id = 'magic-eye-canvas';
      magicEyeCanvas.style.width = '100%';
      magicEyeCanvas.style.height = '100%';
      magicEyeCanvas.style.display = 'block'; 
      wrapper.appendChild(magicEyeCanvas);

      rowWrapper.appendChild(wrapper);
      rowWrapper.appendChild(textWrapper);
      signalPanel.appendChild(rowWrapper);

      magicEyeLightCanvas = document.createElement('canvas');

      requestAnimationFrame(updateMagicEyeLoop);
  }

  function updateMagicEyeLoop(timestamp) {
      if (!isMagicEyeEnabled || !magicEyeCanvas || !magicEyeLightCanvas) {
          requestAnimationFrame(updateMagicEyeLoop);
          return;
      }

      // FPS Limit for CPU optimization
      if (timestamp && timestamp - lastMagicEyeFrame < FRAME_INTERVAL) {
          requestAnimationFrame(updateMagicEyeLoop);
          return;
      }
      lastMagicEyeFrame = timestamp || performance.now();

      tryInitAudio();
      
      const signalElem = document.getElementById('data-signal');
      if (!signalElem) {
          requestAnimationFrame(updateMagicEyeLoop);
          return;
      }

      const signalText = signalElem.textContent;
      let textVal = parseFloat(signalText);
      let targetBaseLevel = 0; 

      if (!isNaN(textVal)) {
          const panelText = signalElem.parentElement ? signalElem.parentElement.textContent.toLowerCase() : "";
          let ssu = 'dbf'; 
          
          if (panelText.includes('dbm')) {
              ssu = 'dbm';
          } else if (panelText.includes('dbuv') || panelText.includes('dbµv') || panelText.includes('dbμv')) {
              ssu = 'dbuv';
          }

          let resultSensitivity;
          if (ssu === 'dbuv' || ssu === 'dbµv' || ssu === 'dbμv') {
              resultSensitivity = Math.round(textVal + 10.875);
          } else if (ssu === 'dbm') {
              resultSensitivity = Math.round(textVal + 119.75);
          } else {
              resultSensitivity = Math.round(textVal); 
          }

          let clampedVal = Math.max(0.0, resultSensitivity);
          targetBaseLevel = Math.min(1.0, clampedVal / 100.0);
      }

      let audioPulse = 0;
      if (audioInitialized && audioCtx && audioCtx.state === 'running' && dataL) {
          analyserL.getFloatTimeDomainData(dataL);
          let sum = 0;
          for (let i = 0; i < dataL.length; i++) { sum += dataL[i] * dataL[i]; }
          let rmsLevel = Math.sqrt(sum / dataL.length);
          audioPulse = Math.min(1.0, rmsLevel * 10.0);
      }

      const targetCombinedLevel = (targetBaseLevel * 0.9) + (audioPulse * 0.1);
      magicEyeLevel += (targetCombinedLevel - magicEyeLevel) * 0.12;

      const dpr = window.devicePixelRatio || 1;
      const w = magicEyeCanvas.parentElement.offsetWidth;
      const h = magicEyeCanvas.parentElement.offsetHeight;

      if (w > 0 && h > 0) {
          // ONLY REDRAW IF LEVEL CHANGED OR RESIZED (Massive CPU/RAM saver)
          if (Math.abs(magicEyeLevel - lastDrawnMagicEyeLevel) > 0.005 || magicEyeCanvas.width !== Math.round(w * dpr)) {
              magicEyeCanvas.width = Math.round(w * dpr);
              magicEyeCanvas.height = Math.round(h * dpr);
              magicEyeLightCanvas.width = magicEyeCanvas.width;
              magicEyeLightCanvas.height = magicEyeCanvas.height;
              
              const ctx = magicEyeCanvas.getContext('2d');
              const lCtx = magicEyeLightCanvas.getContext('2d');
              ctx.scale(dpr, dpr);
              lCtx.scale(dpr, dpr);
              
              drawExtremeGlowTube(ctx, lCtx, w, h, magicEyeLevel);
              lastDrawnMagicEyeLevel = magicEyeLevel;
          }
      }
      
      requestAnimationFrame(updateMagicEyeLoop);
  }

  function drawExtremeGlowTube(ctx, lCtx, w, h, level) {
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(cx, cy) - 2; 
      const innerR = r * 0.88; 
      const capR = innerR * 0.45;

      // ==========================================
      // PASS 1: GENERATE PURE PHOSPHOR LIGHT
      // ==========================================
      lCtx.clearRect(0, 0, w, h);

      const glowGrad = lCtx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
      glowGrad.addColorStop(0.00, "rgba(0, 40, 10, 0.4)");   
      glowGrad.addColorStop(0.35, "rgba(0, 180, 30, 1.0)");  
      glowGrad.addColorStop(0.65, "rgba(0, 255, 40, 1.0)");  
      glowGrad.addColorStop(0.90, "rgba(30, 255, 60, 1.0)"); 
      glowGrad.addColorStop(1.00, "rgba(0, 20, 5, 0.0)");    
      
      lCtx.fillStyle = glowGrad;
      lCtx.beginPath();
      lCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
      lCtx.fill();

      // PHYSICAL CROSSHAIR
      lCtx.save();
      lCtx.globalCompositeOperation = "destination-out";
      lCtx.lineWidth = 3.5; 
      for(let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
          lCtx.beginPath();
          lCtx.moveTo(cx + Math.cos(a) * capR, cy + Math.sin(a) * capR);
          lCtx.lineTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
          lCtx.strokeStyle = "rgba(0, 0, 0, 0.55)"; 
          lCtx.stroke();
      }
      lCtx.restore();

      // CONCENTRIC CIRCULAR LINES
      lCtx.save();
      lCtx.globalCompositeOperation = "source-atop"; 
      lCtx.lineWidth = 1.5; 
      
      let j = 0;
      for (let rCircle = capR + 1; rCircle <= innerR; rCircle += 3.5) {
          lCtx.beginPath();
          lCtx.arc(cx, cy, rCircle, 0, Math.PI * 2);
          if (j % 2 === 0) {
              lCtx.strokeStyle = "rgba(0, 40, 5, 0.06)";
          } else {
              lCtx.strokeStyle = "rgba(150, 255, 150, 0.04)";
          }
          lCtx.stroke();
          j++;
      }
      lCtx.restore();

      // DYNAMIC CURVED SHADOWS
      lCtx.globalCompositeOperation = "destination-out";
      
      const maxShadowAngle = Math.PI; 
      const minShadowAngle = Math.PI * 0.05; 
      const currentShadowAngle = maxShadowAngle - (level * (maxShadowAngle - minShadowAngle));

      lCtx.fillStyle = "black";
      lCtx.shadowColor = "black";
      lCtx.shadowBlur = innerR * 0.15; 

      const curveFactor = level * 0.65; 

      function drawCurvedShadow(midAngle) {
          const startAngle = midAngle - currentShadowAngle / 2;
          const endAngle = midAngle + currentShadowAngle / 2;
          const R_out = innerR * 1.5;

          lCtx.beginPath();
          lCtx.moveTo(cx + Math.cos(startAngle) * capR, cy + Math.sin(startAngle) * capR);
          
          let cp1Angle = startAngle + (midAngle - startAngle) * curveFactor;
          let cpR = capR + (R_out - capR) * 0.38; 
          lCtx.quadraticCurveTo(
              cx + Math.cos(cp1Angle) * cpR, cy + Math.sin(cp1Angle) * cpR,
              cx + Math.cos(startAngle) * R_out, cy + Math.sin(startAngle) * R_out
          );
          
          lCtx.arc(cx, cy, R_out, startAngle, endAngle);
          
          let cp2Angle = endAngle - (endAngle - midAngle) * curveFactor;
          lCtx.quadraticCurveTo(
              cx + Math.cos(cp2Angle) * cpR, cy + Math.sin(cp2Angle) * cpR,
              cx + Math.cos(endAngle) * capR, cy + Math.sin(endAngle) * capR
          );
          lCtx.fill();
      }

      drawCurvedShadow(0);
      drawCurvedShadow(Math.PI);

      lCtx.shadowBlur = 0;
      lCtx.globalCompositeOperation = "source-over";

      // ==========================================
      // PASS 2: DRAW ON MAIN CANVAS
      // ==========================================
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.shadowColor   = "rgba(0,0,0,0.85)";
      ctx.shadowBlur    = 8;
      ctx.shadowOffsetY = 4;
      ctx.shadowOffsetX = 2;
      
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      
      const glassRimGrad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
      glassRimGrad.addColorStop(0, "rgba(200, 200, 200, 0.80)"); 
      glassRimGrad.addColorStop(0.15, "rgba(100, 100, 100, 0.7)"); 
      glassRimGrad.addColorStop(0.5, "rgba(30, 30, 30, 0.5)"); 
      glassRimGrad.addColorStop(0.85, "rgba(80, 80, 80, 0.7)"); 
      glassRimGrad.addColorStop(1, "rgba(180, 180, 180, 0.7)"); 
      ctx.fillStyle = glassRimGrad;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(cx, cy, innerR + 1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)"; 
      ctx.lineWidth = 2.0;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.clip(); 

      ctx.fillStyle = "#010401"; 
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.lineWidth = 1.5; 
      ctx.shadowColor = "rgba(0,0,0,0.4)"; 
      ctx.shadowBlur = 4;
      let i = 0;
      for (let rLine = capR + 3; rLine < innerR; rLine += 7.0) { 
          ctx.beginPath();
          ctx.arc(cx, cy, rLine, 0, Math.PI * 2);
          const op = 0.02 + (i % 3) * 0.01;
          ctx.strokeStyle = `rgba(0, 0, 0, ${op})`; 
          ctx.stroke();
          i++;
      }
      ctx.restore();

      const dpr = window.devicePixelRatio || 1;
      ctx.globalCompositeOperation = "screen";
      ctx.shadowColor = "rgba(0, 255, 50, 0.8)"; 
      ctx.shadowBlur = 15; 
      ctx.drawImage(magicEyeLightCanvas, 0, 0, w * dpr, h * dpr, 0, 0, w, h);
      
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      ctx.drawImage(magicEyeLightCanvas, 0, 0, w * dpr, h * dpr, 0, 0, w, h);

      const funnelGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
      funnelGrad.addColorStop(0.00, "rgba(0, 0, 0, 0.95)");  
      funnelGrad.addColorStop(0.25, "rgba(0, 0, 0, 0.70)");  
      funnelGrad.addColorStop(0.50, "rgba(0, 0, 0, 0.05)");  
      funnelGrad.addColorStop(0.82, "rgba(0, 0, 0, 0.00)");  
      funnelGrad.addColorStop(0.90, "rgba(200, 255, 200, 0.08)"); 
      funnelGrad.addColorStop(0.96, "rgba(0, 0, 0, 0.60)");  
      funnelGrad.addColorStop(1.00, "rgba(0, 0, 0, 1.00)");  
      ctx.fillStyle = funnelGrad;
      ctx.fillRect(0, 0, w, h);

      ctx.restore();

      // ==========================================
      // PASS 3: CATHODE CAP & SPHERICAL GLASS
      // ==========================================
      ctx.beginPath();
      ctx.arc(cx, cy, capR, 0, Math.PI * 2);
      const capGrad = ctx.createLinearGradient(cx - capR, cy - capR, cx + capR, cy + capR);
      capGrad.addColorStop(0, "#222");
      capGrad.addColorStop(0.5, "#0f0f0f");
      capGrad.addColorStop(1, "#000");
      ctx.fillStyle = capGrad;
      
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = innerR * 0.4;
      ctx.shadowOffsetY = 0; 
      ctx.shadowOffsetX = 0; 
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.clip(); 
      
      const glassGlare = ctx.createRadialGradient(cx, cy - innerR * 0.5, 0, cx, cy, innerR * 1.1);
      glassGlare.addColorStop(0, "rgba(255,255,255,0.18)"); 
      glassGlare.addColorStop(0.4, "rgba(255,255,255,0.03)");
      glassGlare.addColorStop(1, "rgba(255,255,255,0.00)");
      
      ctx.fillStyle = glassGlare;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
  }

  // ── Scale Render Loop ──────────────────────────────────────
  function renderLoop(timestamp) {
    if (!scaleCanvas || !isVisible) { rafId = null; return; }
    
    // FPS Limit
    if (timestamp && timestamp - lastScaleFrame < FRAME_INTERVAL) {
        rafId = requestAnimationFrame(renderLoop);
        return;
    }
    lastScaleFrame = timestamp || performance.now();

    tryInitAudio();
    let targetL = 0; let targetR = 0;

    if (audioInitialized && audioCtx && audioCtx.state === 'running' && dataL && dataR) {
        analyserL.getFloatTimeDomainData(dataL);
        analyserR.getFloatTimeDomainData(dataR);
        targetL = getLevel(dataL);
        targetR = getLevel(dataR);
    }

    const attack = 0.06; const decay = 0.02;
    currentVuLeft += (targetL > currentVuLeft) ? (targetL - currentVuLeft) * attack : (targetL - currentVuLeft) * decay;
    currentVuRight += (targetR > currentVuRight) ? (targetR - currentVuRight) * attack : (targetR - currentVuRight) * decay;
    
    if (isVuEnabled && vuCanvas) {
        // ONLY REDRAW VU METER IF LEVELS CHANGED (CPU Saver)
        if (Math.abs(currentVuLeft - lastDrawnVuL) > 0.005 || Math.abs(currentVuRight - lastDrawnVuR) > 0.005) {
            drawVuMeter(vuCanvas, currentVuLeft, currentVuRight);
            lastDrawnVuL = currentVuLeft;
            lastDrawnVuR = currentVuRight;
        }
    }

    // ── Flywheel / Inertia Engine (Knobs spinning down) ──
    if (!isDraggingOuterKnob && Math.abs(outerVelocity) > 0.001) {
        outerVelocity *= FRICTION; // Friction slows the wheel
        applyKnobRotation(true, outerVelocity);
    } else if (!isDraggingOuterKnob) {
        outerVelocity = 0;
    }

    if (!isDraggingInnerKnob && Math.abs(innerVelocity) > 0.001) {
        innerVelocity *= FRICTION; // Friction slows the wheel
        applyKnobRotation(false, innerVelocity);
    } else if (!isDraggingInnerKnob) {
        innerVelocity = 0;
    }
    // ──────────────────────────────────────────────────────

    // Needle trailing smoothly
    if (!isDraggingScale) {
      const diff = currentFreq - animFreq;
      animFreq += Math.abs(diff) > 0.002 ? diff * SMOOTHING : diff;
    }
    
    // ONLY REDRAW SCALE IF FREQUENCY MOVED *OR* IF A SCAN WAS JUST TRIGGERED
    const isForcedRedraw = window._forceRedrawUntil && Date.now() < window._forceRedrawUntil;
    
    if (Math.abs(animFreq - lastDrawnFreq) > 0.001 || isForcedRedraw) {
        drawScale(scaleCanvas, animFreq);
        lastDrawnFreq = animFreq;
    }

    // ONLY REDRAW KNOBS IF THEY ROTATED
    if (knobCanvas) {
        if (Math.abs(outerKnobAngle - lastDrawnOuterAngle) > 0.005 || Math.abs(innerKnobAngle - lastDrawnInnerAngle) > 0.005) {
            drawKnob(knobCanvas);
            lastDrawnOuterAngle = outerKnobAngle;
            lastDrawnInnerAngle = innerKnobAngle;
        }
    }
    
    rafId = requestAnimationFrame(renderLoop);
  }

  function resizeCanvas() {
    if (!scaleCanvas || !knobCanvas || !vuCanvas || !scaleWrap) return;
    const dpr = window.devicePixelRatio || 1;
    
    const sW = scaleCanvas.parentElement.clientWidth;
    const sH = scaleCanvas.parentElement.clientHeight || 160;
    
    const kW = knobCanvas.parentElement.clientWidth   || 96;
    const kH = knobCanvas.parentElement.clientHeight  || 160;

    const vW = vuCanvas.parentElement.clientWidth;
    const vH = vuCanvas.parentElement.clientHeight    || 160;

    if(sW === 0 || sH === 0) return;

    scaleCanvas.width  = Math.round(sW * dpr);
    scaleCanvas.height = Math.round(sH * dpr);

    knobCanvas.width   = Math.round(kW * dpr);
    knobCanvas.height  = Math.round(kH * dpr);

    vuCanvas.width     = Math.round(vW * dpr);
    vuCanvas.height    = Math.round(vH * dpr);

    updateMetrics(sW, sH, kW);

    // FORCE ALL ELEMENTS TO REDRAW IMMEDIATELY UPON RESIZE
    lastDrawnFreq = -999;
    lastDrawnOuterAngle = -999;
    lastDrawnInnerAngle = -999;
    lastDrawnVuL = -999;
    lastDrawnVuR = -999;
    lastDrawnMagicEyeLevel = -999;
  }

  // ── Frequency hook ────────────────────────────────────────
  function hookFrequency() {
      const el = document.getElementById("data-frequency");
      if (!el) { setTimeout(hookFrequency, 500); return; }

      const applyFreq = (v) => {
          // Ignore external updates if we are actively dragging or the wheel is still spinning
          if (isDraggingScale || isDraggingOuterKnob || isDraggingInnerKnob || Math.abs(outerVelocity) > 0.001 || Math.abs(innerVelocity) > 0.001) return;
          if (!isNaN(v) && v >= FM_MIN && v <= FM_MAX) {
              if (currentFreq === null) {
                  animFreq = v; // Initial snap
              }
              currentFreq = v; // Target updates, needle follows in renderLoop
          }
      };

      const parse = () => {
          const v = parseFloat(el.textContent.replace(/[^\d.]/g, ""));
          applyFreq(v);
      };

      parse();
      new MutationObserver(parse).observe(el, { childList: true, subtree: true, characterData: true });

      if (window.socketPromise) {
          window.socketPromise.then(ws => {
              if (!ws) return;
              ws.addEventListener("message", evt => {
                  try {
                      const msg = JSON.parse(evt.data);
                      applyFreq(parseFloat(msg.freq));
                  } catch (_) {}
              });
          });
      }
  }

  // ── DOM elements ──────────────────────────────────────────
  function ensureElements() {
    const cc = document.querySelector(".canvas-container.hide-phone");
    if (!cc) return false;
    if (document.getElementById("analog-scale-wrap")) {
      scaleWrap   = document.getElementById("analog-scale-wrap");
      scaleCanvas = document.getElementById("analog-scale-canvas");
      knobCanvas  = document.getElementById("analog-knob-canvas");
      vuCanvas    = document.getElementById("analog-vu-canvas");
      return true;
    }

    scaleWrap = document.createElement("div");
    scaleWrap.id = "analog-scale-wrap";
    Object.assign(scaleWrap.style, {
      display         : "none",  
      flexDirection   : "row",
      width           : "100%",
      height          : "160px",
      position        : "relative",
      zIndex          : "5",
      transform       : "translate(10px, -20px)", 
      marginBottom    : "-35px", 
      overflow        : "hidden",
      boxSizing       : "border-box",
      userSelect      : "none",
      webkitUserSelect: "none",
    });

    // 1. Scale Section
    const scaleDiv = document.createElement("div");
    scaleDiv.id = "analog-scale-container";
    Object.assign(scaleDiv.style, {
      flex: "0 0 59%",
      position: "relative",
      height: "100%"
    });

    scaleCanvas = document.createElement("canvas");
    scaleCanvas.id = "analog-scale-canvas";
    Object.assign(scaleCanvas.style, {
      width      : "100%",
      height     : "100%",
      display    : "block",
      cursor     : "default",
      touchAction: "none",
    });
    scaleDiv.appendChild(scaleCanvas);
    scaleWrap.appendChild(scaleDiv);

    // 2. Knob Section
    const knobDiv = document.createElement("div");
    knobDiv.id = "analog-knob-container";
    Object.assign(knobDiv.style, {
      flex: "0 0 12%",
      position: "relative",
      height: "100%"
    });

    knobCanvas = document.createElement("canvas");
    knobCanvas.id = "analog-knob-canvas";
    Object.assign(knobCanvas.style, {
      width      : "100%",
      height     : "100%",
      position   : "relative",
      marginLeft : "-10px",
      display    : "block",
      cursor     : "default",
      touchAction: "none",
    });
    knobDiv.appendChild(knobCanvas);
    scaleWrap.appendChild(knobDiv);

    // 3. VU Meter Section
    const vuDiv = document.createElement("div");
    vuDiv.id = "analog-vu-container";
    Object.assign(vuDiv.style, {
      flex: "0 0 30%",
      position: "relative",
      marginLeft: "0px",
      height: "100%"
    });

    vuCanvas = document.createElement("canvas");
    vuCanvas.id = "analog-vu-canvas";
    Object.assign(vuCanvas.style, {
      width      : "100%",
      height     : "100%",
      display    : "block",
      position   : "relative",
      marginLeft : "-10px",
      cursor     : "default",
      touchAction: "none",
    });
    vuDiv.appendChild(vuCanvas);
    scaleWrap.appendChild(vuDiv);

    cc.appendChild(scaleWrap);

    // Apply layout preferences (hide VU if necessary)
    applyScaleLayout();

    // -- Event Listeners (Scale) --
    scaleCanvas.addEventListener("mousemove", (evt) => {
        if (isDraggingScale || isDraggingOuterKnob || isDraggingInnerKnob) return;
        const rect = scaleCanvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        
        // 1. CHECK: IS MOUSE OVER THE REFRESH AREA?
        const sdrBtnHover = document.getElementById('spectrum-graph-button');
        const isSpecVisibleHover = sdrBtnHover && (sdrBtnHover.classList.contains('active') || sdrBtnHover.classList.contains('bg-color-4'));

        const scanBtnLeft = mX + mW - 75;
        const scanBtnRight = mX + mW - 25;
        const scanBtnTop = mY;
        const scanBtnBottom = mY + 30;

        if (isSpecVisibleHover && x >= scanBtnLeft && x <= scanBtnRight && y >= scanBtnTop && y <= scanBtnBottom) {
            scaleCanvas.style.cursor = "pointer";
            if (!window._retroScanHovered) {
                window._retroScanHovered = true;
                if (typeof animFreq !== 'undefined' && animFreq !== null) drawScale(scaleCanvas, animFreq);
            }
            return;
        } else {
            if (window._retroScanHovered) {
                window._retroScanHovered = false;
                if (typeof animFreq !== 'undefined' && animFreq !== null) drawScale(scaleCanvas, animFreq);
            }
        }

        // 2. CHECK: IS MOUSE DIRECTLY OVER THE RED NEEDLE?
        const paperX = mX + 2;
        const paperW = mW - 4;
        const tX = paperX + paperW * 0.04;
        const tW = paperW * 0.92;
        
        // Calculate the current visual X position of the needle
        const needleX = tX + ((animFreq - FM_MIN) / (FM_MAX - FM_MIN)) * tW;
        
        // Define a "grab zone" of 10 pixels to the left and right of the needle
        const isOverNeedle = (x >= needleX - 10 && x <= needleX + 10 && y >= mY && y <= mY + mH);

        if (isOverNeedle) {
            scaleCanvas.style.cursor = "ew-resize";
        } else {
            scaleCanvas.style.cursor = "default";
        }
    });

    scaleCanvas.addEventListener("mousedown",  startScaleDrag);
    scaleCanvas.addEventListener("touchstart", startScaleDrag, { passive: false });

    // -- Event Listeners (Knob) --
    knobCanvas.addEventListener("mousemove", (evt) => {
        if (isDraggingScale || isDraggingOuterKnob || isDraggingInnerKnob) return;
        const rect = knobCanvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const distSq = (x - knobX) * (x - knobX) + (y - knobY) * (y - knobY);
        
        if (distSq <= knobOuterR * knobOuterR) {
            knobCanvas.style.cursor = "grab";
        } else {
            knobCanvas.style.cursor = "default";
        }
    });
    knobCanvas.addEventListener("mousedown",  startKnobDrag);
    knobCanvas.addEventListener("touchstart", startKnobDrag, { passive: false });
	
    knobCanvas.addEventListener("dblclick", (evt) => {
        const rect = knobCanvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const distSq = (x - knobX) * (x - knobX) + (y - knobY) * (y - knobY);
        
        if (distSq <= knobInnerR * knobInnerR) {
            if (currentFreq !== null) {
                let sFreq = snapFreq(currentFreq);
                currentFreq = sFreq; animFreq = sFreq; dragFreq = sFreq;
                tuneTo(sFreq);
            }
        }
    });

    // -- Global drag listeners --
    window.addEventListener("mousemove",   handleGlobalMove);
    window.addEventListener("mouseup",     stopDrag);
    window.addEventListener("mouseleave",  stopDrag);
    
    window.addEventListener("touchmove",   handleGlobalMove, { passive: false });
    window.addEventListener("touchend",    stopDrag);
    window.addEventListener("touchcancel", stopDrag);

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return true;
  }

  // ── Show / hide ───────────────────────────────────────────
  function showScale() {
    if (!ensureElements()) return;
    
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    setStdCanvases(false);
    scaleWrap.style.display = "flex"; 
    applyWrapperStyle();
    isVisible = true;
    resizeCanvas();
    if (!rafId) rafId = requestAnimationFrame(renderLoop);
  }
  
  function hideScale() {
    isVisible = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (scaleWrap) scaleWrap.style.display = "none";
    resetWrapperStyle();
    setStdCanvases(true);
  }

  // ── Toggle with smooth fade ───────────────────────────────
  let isFading = false;
  function toggle() {
    if (isFading) return;
    const btn = document.getElementById("analog-scale-btn");
    
    if (isVisible) {
      isFading = true;
      if (scaleWrap) {
        scaleWrap.style.transition = "opacity 400ms ease-in-out";
        scaleWrap.style.opacity    = "0";
      }
      setTimeout(() => {
        hideScale();
        if (scaleWrap) { scaleWrap.style.transition = ""; }
        if (btn) btn.classList.remove("active");
        isFading = false;
      }, 400);
    } else {
      showScale();
      if (scaleWrap) {
        scaleWrap.style.opacity    = "0";
        scaleWrap.style.transition = "opacity 400ms ease-in-out";
        
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scaleWrap.style.opacity = "1";
          });
        });
        
        setTimeout(() => { 
          if (scaleWrap) scaleWrap.style.transition = ""; 
          isFading = false; 
        }, 400);
      } else { 
        isFading = false; 
      }
      if (btn) btn.classList.add("active");
    }
  }

  // ── Plugin button ─────────────────────────────────────────
  function addButton() {
    const BTN_ID = "analog-scale-btn";
    if (document.getElementById(BTN_ID)) return;
    document.head.insertAdjacentHTML("beforeend", `<style>
      #${BTN_ID}:hover { filter: brightness(130%); }
      #${BTN_ID}.active { background-color: var(--color-2,#333) !important; }
    </style>`);
    const tryAdd = (attempt = 0) => {
      if (typeof addIconToPluginPanel === "function") {
        try { 
          addIconToPluginPanel(BTN_ID, "FM Scale", "solid", "ruler-horizontal", `FM Scale v${PLUGIN_VERSION}`);
          setTimeout(() => {
            const btn = document.getElementById(BTN_ID);
            if (btn) btn.classList.add("hide-phone");
          }, 50);
        }
        catch(e) { legacyButton(BTN_ID); }
        hookBtnClick(BTN_ID);
        return;
      }
      if (attempt < 60) setTimeout(() => tryAdd(attempt + 1), 500);
      else { legacyButton(BTN_ID); hookBtnClick(BTN_ID); }
    };
    tryAdd();
  }
  function hookBtnClick(id) {
    const tryHook = (n = 0) => {
      const btn = document.getElementById(id);
      if (btn) { btn.addEventListener("click", toggle); return; }
      if (n < 20) setTimeout(() => tryHook(n + 1), 300);
    };
    tryHook();
  }
  function legacyButton(id) {
    if (document.getElementById(id)) return;
    const btn = document.createElement("button");
    btn.id        = id;
    btn.className = "hide-phone bg-color-2";
    btn.style.cssText = "border-radius:0;width:90px;height:22px;margin-top:16px;margin-left:5px;";
    btn.title = "FM Scale v" + PLUGIN_VERSION;
    btn.innerHTML = "<strong>FM Scale</strong>";
    btn.addEventListener("click", toggle);
    const t = document.querySelector(".dashboard-panel-plugin-list .flex-container.scrollable-container") || document.getElementById("button-wrapper");
    if (t) t.appendChild(btn);
  }

// ── Start ─────────────────────────────────────────────────
  function start() {
    // Inject unified CSS for Magic Eye and Range Slider
    if (!document.getElementById('magic-eye-responsive-styles')) {
        const style = document.createElement('style');
        style.id = 'magic-eye-responsive-styles';
        style.textContent = `
            @media (max-width: 768px) {
                #magic-eye-wrapper { display: none !important; }
                .magic-eye-panel-override { display: block !important; }
                .magic-eye-text-wrapper { display: contents !important; }
            }
            .magic-eye-hidden { display: none !important; }

            /* --- Unified Range Slider Fix (Chrome & Firefox) --- */
            #analog-scale-brightness {
                -webkit-appearance: none;
                -moz-appearance: none;
                appearance: none;
                width: 100%;
                height: 24px;
                background: transparent !important;
                cursor: pointer;
                border: none;
            }

            /* Track (Die Schiene) - Firefox */
            #analog-scale-brightness::-moz-range-track {
                width: 100%;
                height: 24px;
                background: rgba(58, 191, 154, 0.2); 
                border-radius: 12px;
                border: none;
            }

            /* Track - Chrome/Safari */
            #analog-scale-brightness::-webkit-slider-runnable-track {
                width: 100%;
                height: 24px;
                background: rgba(58, 191, 154, 0.2);
                border-radius: 12px;
            }

            /* Thumb - Chrome/Safari */
            #analog-scale-brightness::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 40px;
                height: 24px;
                background: var(--color-4, #3abf9a);
                border-radius: 12px;
                margin-top: 0px; 
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>');
                background-repeat: no-repeat;
                background-position: center;
            }
        `;
        document.head.appendChild(style);
    }

    hookFrequency();
    addButton();
    injectSettingsUI(); 
    
    // Attempt initialization of the Magic Eye display in the UI
    setTimeout(initMagicEye, 1000);

    console.log(`[${PLUGIN_NAME}] v${PLUGIN_VERSION} loaded.`);

    // --- Instant Theme Update Hook (Fixed Timing) ---
    const forceThemeRedraw = () => {
        // 1. Clear the color cache so getTheme() fetches the new CSS variables
        _cachedTheme = null;
        _lastThemeCheck = 0;

        // 2. Invalidate the "dirty checking" memory to force a full redraw on the next frame
        lastDrawnFreq = -999;
        lastDrawnOuterAngle = -999;
        lastDrawnInnerAngle = -999;
        lastDrawnVuL = -999;
        lastDrawnVuR = -999;
        lastDrawnMagicEyeLevel = -999;
    };

    // Method 1: Listen for clicks directly on the theme dropdown options
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
        const options = themeSelector.querySelectorAll('.option');
        options.forEach(option => {
            option.addEventListener('click', () => {
                // Wait 150ms to allow the main webserver script to update the DOM's CSS variables first
                setTimeout(forceThemeRedraw, 150);
            });
        });
    }

    // Method 2: Global Fallback - watch the HTML/Body tags for theme class/style changes
    const themeObserver = new MutationObserver(() => {
        setTimeout(forceThemeRedraw, 150);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    // ---------------------------------

    if (CHECK_FOR_UPDATES) {
      _checkUpdate();
    }

    if (isAutostart) {
      setTimeout(() => {
        if (!isVisible) toggle(); 
      }, 600);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start, 2000));
  } else {
    setTimeout(start, 2000);
  }
})();