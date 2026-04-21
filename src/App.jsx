import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as THREE from "three";

// ============================================================
// AERODYNAMIC CORE
// ============================================================
function generateNACA4(code, np = 120) {
  const m = parseInt(code[0]) / 100, p = parseInt(code[1]) / 10, t = parseInt(code.slice(2)) / 100;
  const b = []; for (let i = 0; i <= np; i++) b.push((i / np) * Math.PI);
  const xc = b.map(v => 0.5 * (1 - Math.cos(v)));
  const yt = xc.map(x => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4));
  const yc = xc.map(x => { if (p === 0) return 0; return x <= p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x); });
  const dyc = xc.map(x => { if (p === 0) return 0; return x <= p ? (2 * m / (p * p)) * (p - x) : (2 * m / ((1 - p) ** 2)) * (p - x); });
  const th = dyc.map(d => Math.atan(d));
  const u = xc.map((x, i) => ({ x: x - yt[i] * Math.sin(th[i]), y: yc[i] + yt[i] * Math.cos(th[i]) }));
  const l = xc.map((x, i) => ({ x: x + yt[i] * Math.sin(th[i]), y: yc[i] - yt[i] * Math.cos(th[i]) }));
  const pts = []; for (let i = u.length - 1; i >= 0; i--) pts.push(u[i]); for (let i = 1; i < l.length; i++) pts.push(l[i]); return pts;
}
function generateNACA5(code, np = 120) {
  const pi = parseInt(code[1]), t = parseInt(code.slice(3)) / 100;
  const mv = { 1: .058, 2: .126, 3: .2025, 4: .29, 5: .391 }, kv = { 1: 361.4, 2: 51.64, 3: 15.957, 4: 6.643, 5: 3.23 };
  const m = mv[pi] || .2025, k1 = kv[pi] || 15.957;
  const b = []; for (let i = 0; i <= np; i++) b.push((i / np) * Math.PI);
  const xc = b.map(v => 0.5 * (1 - Math.cos(v)));
  const yt = xc.map(x => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4));
  const yc = xc.map(x => x <= m ? (k1 / 6) * (x ** 3 - 3 * m * x ** 2 + m ** 2 * (3 - m) * x) : (k1 * m ** 3 / 6) * (1 - x));
  const dyc = xc.map(x => x <= m ? (k1 / 6) * (3 * x ** 2 - 6 * m * x + m ** 2 * (3 - m)) : -(k1 * m ** 3) / 6);
  const th = dyc.map(d => Math.atan(d));
  const u = xc.map((x, i) => ({ x: x - yt[i] * Math.sin(th[i]), y: yc[i] + yt[i] * Math.cos(th[i]) }));
  const l = xc.map((x, i) => ({ x: x + yt[i] * Math.sin(th[i]), y: yc[i] - yt[i] * Math.cos(th[i]) }));
  const pts = []; for (let i = u.length - 1; i >= 0; i--) pts.push(u[i]); for (let i = 1; i < l.length; i++) pts.push(l[i]); return pts;
}
function parseDatFile(text) {
  const lines = text.trim().split(/\r?\n/); let name = ""; const coords = []; let si = 0;
  if (lines.length > 0 && !/^\s*[\d.-]/.test(lines[0])) { name = lines[0].trim(); si = 1; }
  let isLed = false;
  if (si < lines.length) { const sl = lines[si].trim().split(/\s+/); if (sl.length === 2) { const a = parseFloat(sl[0]), b = parseFloat(sl[1]); if (a > 1 && b > 1 && Math.abs(a - Math.round(a)) < .01 && Math.abs(b - Math.round(b)) < .01) { isLed = true; si++; } } }
  for (let i = si; i < lines.length; i++) { const ln = lines[i].trim(); if (!ln || /^[a-zA-Z]/.test(ln)) continue; const p = ln.split(/[\s,]+/).map(Number); if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) { if (Math.abs(p[0]) < 1e-10 && Math.abs(p[1]) < 1e-10 && coords.length > 2) continue; coords.push({ x: p[0], y: p[1] }); } }
  if (coords.length < 10) return { error: "Too few points.", name, points: [] };
  const mx = Math.max(...coords.map(c => c.x)); if (mx > 0 && Math.abs(mx - 1) > .01) coords.forEach(c => { c.x /= mx; c.y /= mx; });
  let points = coords;
  if (isLed) { let sp = -1; for (let i = 1; i < coords.length; i++) { if (coords[i].x < coords[i - 1].x - .3) { sp = i; break; } } if (sp > 0) points = [...coords.slice(0, sp).reverse(), ...coords.slice(sp)]; }
  const f = points[0], la = points[points.length - 1]; if (Math.sqrt((f.x - la.x) ** 2 + (f.y - la.y) ** 2) > .01) { const tx = (f.x + la.x) / 2, ty = (f.y + la.y) / 2; points[0] = { x: tx, y: ty }; points.push({ x: tx, y: ty }); }
  return { error: null, name: name || "Custom Airfoil", points };
}
function panelMethod(points, alphaRad) {
  const n = points.length - 1, xm = [], ym = [], S = [], theta = [];
  for (let i = 0; i < n; i++) { xm.push(.5 * (points[i].x + points[i + 1].x)); ym.push(.5 * (points[i].y + points[i + 1].y)); const dx = points[i + 1].x - points[i].x, dy = points[i + 1].y - points[i].y; S.push(Math.sqrt(dx * dx + dy * dy)); theta.push(Math.atan2(dy, dx)); }
  const A = Array.from({ length: n + 1 }, () => new Float64Array(n + 1)), b = new Float64Array(n + 1), cA = Math.cos(alphaRad), sA = Math.sin(alphaRad);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { if (i === j) { A[i][j] = .5; continue; } const dx = xm[i] - points[j].x, dy = ym[i] - points[j].y, Av = -(dx * Math.cos(theta[j]) + dy * Math.sin(theta[j])), Bv = dx * dx + dy * dy, Cv = Math.sin(theta[i] - theta[j]), Dv = Math.cos(theta[i] - theta[j]), Ev = dx * Math.sin(theta[j]) - dy * Math.cos(theta[j]), Sj = S[j]; const den = Bv - 2 * Av * Sj + Sj * Sj, lt = Math.log(Math.max(den / Math.max(Bv, 1e-20), 1e-20)), at = Math.atan2(Ev * Sj, Math.max(Math.abs(Bv - Av * Sj), 1e-20)) * Math.sign((Bv - Av * Sj) || 1); A[i][j] = (Cv * at + Dv * .5 * lt) / (2 * Math.PI); A[i][n] += (Dv * at - Cv * .5 * lt) / (2 * Math.PI); } b[i] = cA * Math.sin(theta[i]) - sA * Math.cos(theta[i]); }
  A[n][0] = 1; A[n][n - 1] = 1; b[n] = 0;
  const sz = n + 1, aug = Array.from({ length: sz }, (_, i) => { const r = new Float64Array(sz + 1); for (let j = 0; j < sz; j++) r[j] = A[i][j]; r[sz] = b[i]; return r; });
  for (let c = 0; c < sz; c++) { let mr = c, mv = Math.abs(aug[c][c]); for (let r = c + 1; r < sz; r++) if (Math.abs(aug[r][c]) > mv) { mv = Math.abs(aug[r][c]); mr = r; } [aug[c], aug[mr]] = [aug[mr], aug[c]]; const pv = aug[c][c]; if (Math.abs(pv) < 1e-15) continue; for (let j = c; j <= sz; j++) aug[c][j] /= pv; for (let r = 0; r < sz; r++) { if (r === c) continue; const f = aug[r][c]; for (let j = c; j <= sz; j++) aug[r][j] -= f * aug[c][j]; } }
  const sol = aug.map(r => r[sz]), gamma = sol.slice(0, n), vortex = sol[n], Vt = [], Cp = [];
  for (let i = 0; i < n; i++) { const vt = cA * Math.cos(theta[i]) + sA * Math.sin(theta[i]) + gamma[i] + vortex; Vt.push(vt); Cp.push(1 - vt * vt); }
  let cl = 0, cd = 0; for (let i = 0; i < n; i++) { cl += -Cp[i] * (points[i + 1].x - points[i].x); cd += -Cp[i] * (points[i + 1].y - points[i].y); }
  let cm = 0; for (let i = 0; i < n; i++) cm += Cp[i] * S[i] * (xm[i] - .25);
  let area = 0, maxT = 0, maxTX = 0, maxC = 0, maxCX = 0;
  for (let i = 0; i < n; i++) area += .5 * (points[i].x * points[i + 1].y - points[i + 1].x * points[i].y);
  const half = Math.floor(n / 2);
  for (let i = 0; i < Math.min(half, n - half); i++) { const li = n - 1 - i; if (li < n) { const th = Math.abs(ym[i] - ym[li]); if (th > maxT) { maxT = th; maxTX = xm[i]; } const ca = (ym[i] + ym[li]) / 2; if (Math.abs(ca) > Math.abs(maxC)) { maxC = ca; maxCX = xm[i]; } } }
  return { Cp, Vt, xm, ym, cl, cd: Math.abs(cd), cm, gamma, vortex, area: Math.abs(area), maxThickness: maxT, maxThicknessX: maxTX, maxCamber: maxC, maxCamberX: maxCX };
}

const PRESETS = { "NACA 0012": "0012", "NACA 2412": "2412", "NACA 4412": "4412", "NACA 4415": "4415", "NACA 2415": "2415", "NACA 0006": "0006", "NACA 0009": "0009", "NACA 0015": "0015", "NACA 0018": "0018", "NACA 0021": "0021", "NACA 0024": "0024", "NACA 1408": "1408", "NACA 2408": "2408", "NACA 2410": "2410", "NACA 2418": "2418", "NACA 4409": "4409", "NACA 4418": "4418", "NACA 6412": "6412", "NACA 23012": "23012", "NACA 23015": "23015", "NACA 23018": "23018" };
function fmt(n, d = 4) { return (isNaN(n) || !isFinite(n)) ? "\u2014" : n.toFixed(d); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ============================================================
// 3D FLOW VISUALIZATION COMPONENT
// ============================================================
function FlowVisualization3D({ points, alpha, results }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const frameRef = useRef(null);
  const [streamCount, setStreamCount] = useState(24);
  const [showPressure, setShowPressure] = useState(true);
  const [rotateAuto, setRotateAuto] = useState(true);
  const [spanLen, setSpanLen] = useState(1.5);

  useEffect(() => {
    if (!mountRef.current || !points || points.length < 10) return;
    const container = mountRef.current;
    const H = 420;
    // Force a layout read after mount — use a short delay so the container has its final width
    const initW = Math.max(container.offsetWidth || 600, 300);
    let W = initW;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1a);
    scene.fog = new THREE.Fog(0x0a0f1a, 8, 18);
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(2.0, 1.2, 2.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = H + "px";

    // Handle resize so the canvas always fills the container
    const onResize = () => {
      W = container.offsetWidth || 600;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    const resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(container);
    // Also run once after a tick to catch initial layout
    setTimeout(onResize, 50);

    // Lights
    scene.add(new THREE.AmbientLight(0x334155, 0.8));
    const dir = new THREE.DirectionalLight(0x94a3b8, 1.2);
    dir.position.set(3, 4, 2); scene.add(dir);
    const rim = new THREE.DirectionalLight(0x2563eb, 0.4);
    rim.position.set(-2, 1, -3); scene.add(rim);

    // Build airfoil shape in XY plane — chord along X, thickness along Y
    // Then extrude along Z for the span
    const shape = new THREE.Shape();
    const sc = 2.0;
    shape.moveTo((points[0].x - 0.5) * sc, points[0].y * sc);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo((points[i].x - 0.5) * sc, points[i].y * sc);
    }
    shape.closePath();

    // Extrude along Z (span direction)
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: spanLen, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2,
    });
    // Center so the airfoil sits at origin
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.max.x + bb.min.x) / 2, cy = (bb.max.y + bb.min.y) / 2, cz = (bb.max.z + bb.min.z) / 2;
    geo.translate(-cx, -cy, -cz);

    // Cp-based vertex coloring
    let mat;
    if (showPressure && results) {
      mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, side: THREE.DoubleSide });
      const colors = [];
      const posAttr = geo.getAttribute("position");
      for (let i = 0; i < posAttr.count; i++) {
        // Map vertex X back to chord fraction (undo the -0.5 offset and sc scale)
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const xChord = vx / sc + 0.5; // 0..1 along chord
        // Find nearest panel by x AND y
        let minD = Infinity, cpVal = 0;
        for (let j = 0; j < results.xm.length; j++) {
          const dx = results.xm[j] - xChord;
          const dy = results.ym[j] - (vy / sc);
          const d = dx * dx + dy * dy;
          if (d < minD) { minD = d; cpVal = results.Cp[j]; }
        }
        const t = clamp((cpVal + 2) / 4, 0, 1);
        colors.push(t * 0.8 + 0.1, 0.15, (1 - t) * 0.8 + 0.1);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    } else {
      mat = new THREE.MeshPhongMaterial({ color: 0x1e3a5f, shininess: 60, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    }

    // NO rotation — chord is already along X, span along Z
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 15),
      new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.15 })
    );
    scene.add(wire);

    // Streamlines — flow goes left-to-right along X (positive X = downstream)
    const alphaRad = (alpha * Math.PI) / 180;
    for (let s = 0; s < streamCount; s++) {
      const yStart = (s / (streamCount - 1) - 0.5) * 1.2;
      const streamPts = [];
      const steps = 140;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const x = -2.0 + t * 5.5; // from well upstream to well downstream
        let yOff = yStart;
        const xNorm = x / sc + 0.5; // chord-normalized x
        const distToChord = Math.abs(yStart);
        if (xNorm > -0.15 && xNorm < 1.25 && distToChord < 0.45) {
          const proximity = Math.max(0, 1 - distToChord / 0.45);
          const chordFactor = Math.sin(clamp((xNorm + 0.15) / 1.4, 0, 1) * Math.PI);
          const deflection = proximity * chordFactor * 0.18 * (yStart >= 0 ? 1 : -1);
          const alphaDeflect = Math.sin(alphaRad) * chordFactor * proximity * 0.12;
          yOff = yStart + deflection + alphaDeflect;
          if (yStart > 0) yOff += proximity * chordFactor * Math.sin(alphaRad) * 0.06;
        }
        const farField = Math.sin(alphaRad) * 0.04 * clamp(xNorm - 0.5, 0, 1);
        streamPts.push(new THREE.Vector3(x, (yOff + farField) * sc, 0));
      }

      const curve = new THREE.CatmullRomCurve3(streamPts);
      const tubePts = curve.getPoints(100);

      const lineGeo = new THREE.BufferGeometry();
      const positions = [], colors = [];
      for (let i = 0; i < tubePts.length - 1; i++) {
        const p1 = tubePts[i], p2 = tubePts[i + 1];
        const speed = p1.distanceTo(p2) * 20;
        const speedNorm = clamp(speed / 2, 0, 1);
        const r = 0.15 + speedNorm * 0.7, g = 0.5 + speedNorm * 0.4, b2 = 0.8 + speedNorm * 0.2;
        positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        colors.push(r, g, b2, r, g, b2);
      }
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      const line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
      line.position.z = (Math.random() - 0.5) * spanLen * 0.8;
      scene.add(line);
    }

    // Animated particles — flow left to right
    const particleCount = 250;
    const particleGeo = new THREE.BufferGeometry();
    const pPositions = new Float32Array(particleCount * 3);
    const pColors = new Float32Array(particleCount * 3);
    const pData = [];
    for (let i = 0; i < particleCount; i++) {
      const yS = (Math.random() - 0.5) * 1.2;
      pData.push({ x: -2.0 + Math.random() * 5.5, y: yS, z: (Math.random() - 0.5) * spanLen * 0.8, speed: 0.01 + Math.random() * 0.015 });
      pPositions[i * 3] = pData[i].x;
      pPositions[i * 3 + 1] = pData[i].y * sc;
      pPositions[i * 3 + 2] = pData[i].z;
      pColors[i * 3] = 0.4; pColors[i * 3 + 1] = 0.7; pColors[i * 3 + 2] = 1.0;
    }
    particleGeo.setAttribute("position", new THREE.Float32BufferAttribute(pPositions, 3));
    particleGeo.setAttribute("color", new THREE.Float32BufferAttribute(pColors, 3));
    const particleMat = new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.75, sizeAttenuation: true });
    const particleMesh = new THREE.Points(particleGeo, particleMat);
    scene.add(particleMesh);

    const gridHelper = new THREE.GridHelper(8, 24, 0x1e293b, 0x111827);
    gridHelper.position.y = -0.7;
    scene.add(gridHelper);

    // Mouse orbit
    let isDragging = false, prevX = 0, prevY = 0, rotX = 0.35, rotY = 0.5;
    const onMouseDown = (e) => { isDragging = true; prevX = e.clientX; prevY = e.clientY; };
    const onMouseMove = (e) => { if (isDragging) { rotY += (e.clientX - prevX) * 0.005; rotX += (e.clientY - prevY) * 0.005; rotX = clamp(rotX, -1, 1); prevX = e.clientX; prevY = e.clientY; } };
    const onMouseUp = () => { isDragging = false; };
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseup", onMouseUp);
    renderer.domElement.addEventListener("mouseleave", onMouseUp);

    let time = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      time += 0.016;

      if (rotateAuto && !isDragging) rotY += 0.003;
      const dist = 3.8;
      camera.position.x = Math.sin(rotY) * dist * Math.cos(rotX);
      camera.position.y = Math.sin(rotX) * dist * 0.5 + 0.6;
      camera.position.z = Math.cos(rotY) * dist * Math.cos(rotX);
      camera.lookAt(0, 0, 0);

      // Animate particles left→right
      const posArr = particleMesh.geometry.getAttribute("position");
      for (let i = 0; i < particleCount; i++) {
        pData[i].x += pData[i].speed;
        if (pData[i].x > 3.5) { pData[i].x = -2.0; pData[i].y = (Math.random() - 0.5) * 1.2; }
        const xN = pData[i].x / sc + 0.5;
        let yF = pData[i].y;
        const dC = Math.abs(pData[i].y);
        if (xN > -0.15 && xN < 1.25 && dC < 0.45) {
          const prox = Math.max(0, 1 - dC / 0.45);
          const cf = Math.sin(clamp((xN + 0.15) / 1.4, 0, 1) * Math.PI);
          yF += prox * cf * 0.18 * (pData[i].y >= 0 ? 1 : -1) + Math.sin(alphaRad) * cf * prox * 0.1;
        }
        posArr.setXYZ(i, pData[i].x, yF * sc, pData[i].z);
      }
      posArr.needsUpdate = true;

      renderer.render(scene, camera);
    };
    animate();
    sceneRef.current = { scene, renderer, camera };

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseup", onMouseUp);
      renderer.dispose();
      container.innerHTML = "";
    };
  }, [points, alpha, results, streamCount, showPressure, rotateAuto, spanLen]);

  return (
    <div>
      <div ref={mountRef} style={{ width: "100%", height: 420, borderRadius: 8, overflow: "hidden", background: "#0a0f1a" }} />
      <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>
          <input type="checkbox" checked={showPressure} onChange={() => setShowPressure(!showPressure)} style={{ accentColor: "#2563eb" }} />Cp Coloring
        </label>
        <label style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>
          <input type="checkbox" checked={rotateAuto} onChange={() => setRotateAuto(!rotateAuto)} style={{ accentColor: "#2563eb" }} />Auto-Rotate
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>Streams</span>
          <input type="range" min="8" max="48" step="4" value={streamCount} onChange={e => setStreamCount(parseInt(e.target.value))} style={{ width: 80 }} />
          <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>{streamCount}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>Span</span>
          <input type="range" min="0.5" max="3" step="0.25" value={spanLen} onChange={e => setSpanLen(parseFloat(e.target.value))} style={{ width: 80 }} />
          <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>{spanLen}c</span>
        </div>
        <span style={{ fontSize: 9.5, color: "#334155", marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace" }}>Click + drag to orbit</span>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function AirfoilAnalysisSuite() {
  const [mode, setMode] = useState("naca");
  const [nacaCode, setNacaCode] = useState("2412");
  const [alpha, setAlpha] = useState(4);
  const [numPanels, setNumPanels] = useState(120);
  const [results, setResults] = useState(null);
  const [points, setPoints] = useState([]);
  const [activeTab, setActiveTab] = useState("geometry");
  const [alphaRange, setAlphaRange] = useState({ min: -10, max: 15, step: 1 });
  const [polarData, setPolarData] = useState(null);
  const [computing, setComputing] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("NACA 2412");
  const [showGrid, setShowGrid] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [compareCode, setCompareCode] = useState("0012");
  const [compareResults, setCompareResults] = useState(null);
  const [comparePoints, setComparePoints] = useState([]);
  const [customPoints, setCustomPoints] = useState(null);
  const [customName, setCustomName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  // AI state
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);
  // Requirements form state
  const [reqMode, setReqMode] = useState("freeform"); // "freeform" | "form"
  const [reqApp, setReqApp] = useState("");
  const [reqRe, setReqRe] = useState("");
  const [reqSpeed, setReqSpeed] = useState("");
  const [reqPriority, setReqPriority] = useState("");
  const [reqThickness, setReqThickness] = useState("");
  const [reqExtra, setReqExtra] = useState("");

  const isValid = c => /^\d{4,5}$/.test(c);
  const genAirfoil = useCallback((code, np) => /^\d{5}$/.test(code) ? generateNACA5(code, np) : generateNACA4(code, np), []);
  const getPoints = useCallback(() => { if (mode === "custom" && customPoints) return customPoints; if (isValid(nacaCode)) return genAirfoil(nacaCode, numPanels); return null; }, [mode, customPoints, nacaCode, numPanels, genAirfoil]);
  const getLabel = useCallback(() => mode === "custom" && customName ? customName : `NACA ${nacaCode}`, [mode, customName, nacaCode]);

  const handleFile = useCallback((file) => { if (!file) return; setUploadError(""); const r = new FileReader(); r.onload = e => { const res = parseDatFile(e.target.result); if (res.error) { setUploadError(res.error); return; } setCustomPoints(res.points); setCustomName(res.name); setMode("custom"); }; r.readAsText(file); }, []);

  const runAnalysis = useCallback(() => {
    const pts = getPoints(); if (!pts || pts.length < 10) return;
    setPoints(pts); setResults(panelMethod(pts, (alpha * Math.PI) / 180));
    if (compareMode && isValid(compareCode)) { const cp = genAirfoil(compareCode, numPanels); setComparePoints(cp); setCompareResults(panelMethod(cp, (alpha * Math.PI) / 180)); }
    else { setCompareResults(null); setComparePoints([]); }
  }, [getPoints, alpha, compareMode, compareCode, numPanels, genAirfoil]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const computePolar = useCallback(() => { setComputing(true); setTimeout(() => { const pts = getPoints(); if (!pts) { setComputing(false); return; } const d = []; for (let a = alphaRange.min; a <= alphaRange.max; a += alphaRange.step) { const r = panelMethod(pts, (a * Math.PI) / 180); d.push({ alpha: a, cl: r.cl, cd: r.cd, cm: r.cm, ld: r.cl / Math.max(r.cd, 1e-8) }); } setPolarData(d); setComputing(false); }, 50); }, [getPoints, alphaRange]);

  const dlBlob = (c, n, t = "text/csv") => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([c], { type: t })); a.download = n; a.click(); };
  const exportCSV = useCallback(() => { if (!results) return; let csv = "x/c,y/c,Cp,Vt\n"; results.xm.forEach((x, i) => { csv += `${x.toFixed(6)},${results.ym[i].toFixed(6)},${results.Cp[i].toFixed(6)},${results.Vt[i].toFixed(6)}\n`; }); dlBlob(csv, `${getLabel().replace(/\s/g, "_")}_a${alpha}.csv`); }, [results, getLabel, alpha]);
  const exportDat = useCallback(() => { if (!points.length) return; let d = `${getLabel()}\n`; points.forEach(p => { d += `  ${p.x.toFixed(7)}  ${p.y.toFixed(7)}\n`; }); dlBlob(d, `${getLabel().replace(/\s/g, "_")}.dat`, "text/plain"); }, [points, getLabel]);

  // Build structured query from form
  const buildFormQuery = useCallback(() => {
    let q = "I need an airfoil recommendation for the following requirements:\n";
    if (reqApp) q += `Application: ${reqApp}\n`;
    if (reqRe) q += `Reynolds number: ${reqRe}\n`;
    if (reqSpeed) q += `Speed/Mach range: ${reqSpeed}\n`;
    if (reqPriority) q += `Primary design priority: ${reqPriority}\n`;
    if (reqThickness) q += `Thickness constraint: ${reqThickness}\n`;
    if (reqExtra) q += `Additional notes: ${reqExtra}\n`;
    q += "\nPlease recommend 2-3 specific NACA airfoils with reasoning.";
    return q;
  }, [reqApp, reqRe, reqSpeed, reqPriority, reqThickness, reqExtra]);

  const askAI = useCallback(async (overrideQuery) => {
    const query = overrideQuery || aiQuery;
    if (!query.trim() || aiLoading) return;
    setAiLoading(true); setAiResponse("");
    const ctx = results ? `\nCurrently loaded: ${getLabel()}, α=${alpha}°, CL=${fmt(results.cl)}, CD=${fmt(results.cd, 5)}, L/D=${fmt(results.cl / Math.max(results.cd, 1e-8), 1)}, t/c=${(results.maxThickness * 100).toFixed(1)}%` : "";
    const sys = `You are an expert aerospace engineer specializing in airfoil selection. You know NACA series, Eppler, Wortmann, Selig, Clark Y, GOE, and all major families.\n\nGive concrete recommendations with specific NACA 4 or 5 digit codes. Explain aerodynamic reasoning: CL needs, Re regime, stall behavior, thickness/structural tradeoffs, pitching moment. Bold airfoil names with **. Keep it focused and technical.${ctx}`;
    const msgs = [...aiHistory, { role: "user", content: query }];
    const payload = { model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sys, messages: msgs };

    // Determine which endpoint to use:
    // - Inside Claude artifacts: direct API works (no CORS, auth handled)
    // - Deployed on Vercel: must use /api/chat proxy
    const endpoints = ["/api/chat", "https://api.anthropic.com/v1/messages"];

    let succeeded = false;
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) continue;
        const data = await res.json();
        const text = data.content?.filter(c => c.type === "text").map(c => c.text).join("\n");
        if (text) {
          setAiResponse(text);
          setAiHistory([...msgs, { role: "assistant", content: text }]);
          succeeded = true;
          break;
        }
      } catch { /* try next endpoint */ }
    }
    if (!succeeded) {
      setAiResponse("Could not connect to AI.\n\nIf running locally: AI requires deployment.\nIf deployed on Vercel:\n1. Add api/chat.js to your project root\n2. Add vercel.json to your project root\n3. Set ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables\n4. Redeploy");
    }
    setAiLoading(false);
  }, [aiQuery, aiLoading, aiHistory, results, getLabel, alpha]);

  const loadFromAI = useCallback(code => { if (isValid(code)) { setNacaCode(code); setMode("naca"); setActiveTab("geometry"); } }, []);
  const renderAI = text => text.split("\n").map((line, li) => { const parts = []; let last = 0, m; const re = /\*\*(.*?)\*\*/g; while ((m = re.exec(line)) !== null) { if (m.index > last) parts.push(<span key={`t${li}-${last}`}>{line.slice(last, m.index)}</span>); parts.push(<strong key={`b${li}-${m.index}`} style={{ color: "#e2e8f0", fontWeight: 600 }}>{m[1]}</strong>); last = m.index + m[0].length; } if (last < line.length) parts.push(<span key={`e${li}`}>{line.slice(last)}</span>); return <div key={li} style={{ marginBottom: line.trim() ? 4 : 10 }}>{parts.length ? parts : line}</div>; });
  const extractCodes = text => [...new Set((text.match(/\bNACA\s*(\d{4,5})\b/gi) || []).map(m => m.replace(/\D/g, "")))].filter(c => isValid(c)).slice(0, 6);

  // SVG renderers (same as before, compressed)
  const AirfoilSVG = useMemo(() => {
    if (!points.length) return null;
    const W = 700, H = 340, pad = 50, xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    const scale = Math.min((W - 2 * pad) / (xMax - xMin), (H - 2 * pad) / Math.max(yMax - yMin, 0.3));
    const ox = W / 2 - ((xMax + xMin) / 2) * scale, oy = H / 2 + ((yMax + yMin) / 2) * scale;
    const toS = (x, y) => [ox + x * scale, oy - y * scale];
    const pathD = points.map((p, i) => `${i ? "L" : "M"}${toS(p.x, p.y).join(",")}`).join(" ") + " Z";
    const cmpPath = comparePoints.length ? comparePoints.map((p, i) => `${i ? "L" : "M"}${toS(p.x, p.y).join(",")}`).join(" ") + " Z" : null;
    const cs = toS(0, 0), ce = toS(1, 0), qc = toS(0.25, 0);
    const arrows = (results && activeTab === "pressure") ? results.xm.filter((_, i) => i % 3 === 0).map((x, idx) => { const i = idx * 3, cp = results.Cp[i], mag = clamp(Math.abs(cp) * 40, 2, 50), [px, py] = toS(x, results.ym[i]), ang = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x), dir = cp < 0 ? 1 : -1; return <line key={i} x1={px} y1={py} x2={px - Math.sin(ang) * mag * dir} y2={py - Math.cos(ang) * mag * dir} stroke={cp < 0 ? "#dc2626" : "#16a34a"} strokeWidth="1.2" opacity="0.65" />; }) : null;
    const grid = []; if (showGrid) { for (let x = 0; x <= 1; x += .1) { const [gx, g1] = toS(x, yMin - .05), [, g2] = toS(x, yMax + .05); grid.push(`M${gx},${g1} L${gx},${g2}`); } for (let y = -.3; y <= .3; y += .05) { const [g1, gy] = toS(xMin - .05, y), [g2] = toS(xMax + .05, y); grid.push(`M${g1},${gy} L${g2},${gy}`); } }
    return (<svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 340 }}><defs><linearGradient id="ag" x1="0%" x2="100%"><stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" /><stop offset="50%" stopColor="#0891b2" stopOpacity="0.12" /><stop offset="100%" stopColor="#2563eb" stopOpacity="0.2" /></linearGradient><linearGradient id="cg2" x1="0%" x2="100%"><stop offset="0%" stopColor="#d97706" stopOpacity="0.12" /><stop offset="100%" stopColor="#d97706" stopOpacity="0.12" /></linearGradient><filter id="gl"><feGaussianBlur stdDeviation="1.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>{showGrid && <path d={grid.join(" ")} stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,4" fill="none" />}{cmpPath && <path d={cmpPath} fill="url(#cg2)" stroke="#d97706" strokeWidth="1.5" strokeDasharray="6,3" />}<path d={pathD} fill="url(#ag)" stroke="#2563eb" strokeWidth="1.8" filter="url(#gl)" />{arrows}<line x1={cs[0]} y1={cs[1]} x2={ce[0]} y2={ce[1]} stroke="#475569" strokeWidth="0.8" strokeDasharray="4,4" /><circle cx={qc[0]} cy={qc[1]} r="3.5" fill="#d97706" stroke="#fbbf24" strokeWidth="1.2" /><text x={qc[0] + 7} y={qc[1] - 7} fill="#d97706" fontSize="9" fontFamily="'IBM Plex Mono', monospace">c/4</text></svg>);
  }, [points, comparePoints, results, activeTab, showGrid]);

  const CpPlot = useMemo(() => {
    if (!results) return null;
    const W = 700, H = 300, pad = 55, cpMin = Math.min(...results.Cp, -1), cpMax = Math.max(...results.Cp, 1), cpR = cpMax - cpMin || 1;
    const toX = x => pad + x * (W - 2 * pad), toY = cp => pad + ((cpMax - cp) / cpR) * (H - 2 * pad);
    const n = results.xm.length, half = Math.floor(n / 2);
    const mp = (s, e) => results.xm.slice(s, e).map((x, i) => `${i ? "L" : "M"}${toX(x)},${toY(results.Cp[s + i])}`).join(" ");
    const gy = []; const step = cpR > 4 ? 1 : cpR > 2 ? .5 : .25; for (let cp = Math.ceil(cpMin / step) * step; cp <= cpMax; cp += step) gy.push(cp);
    return (<svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>{gy.map((cp, i) => <g key={i}><line x1={pad} y1={toY(cp)} x2={W - pad} y2={toY(cp)} stroke="#1e293b" strokeWidth="0.5" strokeDasharray="3,5" /><text x={pad - 8} y={toY(cp) + 4} fill="#64748b" fontSize="9.5" textAnchor="end" fontFamily="'IBM Plex Mono', monospace">{cp.toFixed(1)}</text></g>)}{[0, .2, .4, .6, .8, 1].map((x, i) => <g key={i}><line x1={toX(x)} y1={pad} x2={toX(x)} y2={H - pad} stroke="#1e293b" strokeWidth="0.5" strokeDasharray="3,5" /><text x={toX(x)} y={H - pad + 15} fill="#64748b" fontSize="9.5" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">{x.toFixed(1)}</text></g>)}<line x1={pad} y1={toY(0)} x2={W - pad} y2={toY(0)} stroke="#334155" strokeWidth="1" /><path d={mp(0, half)} fill="none" stroke="#2563eb" strokeWidth="1.8" /><path d={mp(half, n)} fill="none" stroke="#dc2626" strokeWidth="1.8" /><g transform={`translate(${W - pad - 120}, ${pad + 8})`}><line x1="0" y1="0" x2="18" y2="0" stroke="#2563eb" strokeWidth="2" /><text x="23" y="4" fill="#94a3b8" fontSize="9.5" fontFamily="'IBM Plex Mono', monospace">Upper</text><line x1="0" y1="14" x2="18" y2="14" stroke="#dc2626" strokeWidth="2" /><text x="23" y="18" fill="#94a3b8" fontSize="9.5" fontFamily="'IBM Plex Mono', monospace">Lower</text></g><text x={W / 2} y={pad - 10} fill="#e2e8f0" fontSize="11" textAnchor="middle" fontWeight="500" fontFamily="'IBM Plex Sans', sans-serif">Cp — {getLabel()} — α = {alpha}°</text></svg>);
  }, [results, getLabel, alpha]);

  const PolarPlots = useMemo(() => {
    if (!polarData?.length) return null;
    const W = 340, H = 280, pad = 50;
    const ch = (data, xK, yK, xL, yL, title, col) => { const xs = data.map(d => d[xK]), ys = data.map(d => d[yK]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), xR = x1 - x0 || 1, yR = y1 - y0 || 1, tX = x => pad + ((x - x0) / xR) * (W - 2 * pad), tY = y => pad + ((y1 - y) / yR) * (H - 2 * pad); return (<svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}><text x={W / 2} y={16} fill="#e2e8f0" fontSize="10.5" textAnchor="middle" fontWeight="500" fontFamily="'IBM Plex Sans'">{title}</text>{[0, .25, .5, .75, 1].map((f, i) => { const y = y0 + f * yR, x = x0 + f * xR; return <g key={i}><line x1={pad} y1={tY(y)} x2={W - pad} y2={tY(y)} stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,4" /><text x={pad - 4} y={tY(y) + 3} fill="#64748b" fontSize="8.5" textAnchor="end" fontFamily="'IBM Plex Mono'">{y.toFixed(2)}</text><line x1={tX(x)} y1={pad} x2={tX(x)} y2={H - pad} stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2,4" /><text x={tX(x)} y={H - pad + 13} fill="#64748b" fontSize="8.5" textAnchor="middle" fontFamily="'IBM Plex Mono'">{x.toFixed(1)}</text></g>; })}<path d={data.map((d, i) => `${i ? "L" : "M"}${tX(d[xK])},${tY(d[yK])}`).join(" ")} fill="none" stroke={col} strokeWidth="1.8" />{data.map((d, i) => <circle key={i} cx={tX(d[xK])} cy={tY(d[yK])} r="2.5" fill={col} opacity="0.7" />)}</svg>); };
    return (<div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="polar-card">{ch(polarData, "alpha", "cl", "α", "CL", "CL vs α", "#2563eb")}</div><div className="polar-card">{ch(polarData, "cd", "cl", "CD", "CL", "Drag Polar", "#dc2626")}</div><div className="polar-card">{ch(polarData, "alpha", "cm", "α", "CM", "CM vs α", "#16a34a")}</div><div className="polar-card">{ch(polarData, "alpha", "ld", "α", "L/D", "L/D vs α", "#7c3aed")}</div></div>);
  }, [polarData]);

  const [page, setPage] = useState("landing"); // "landing" | "app"

  const tabs = [
    { id: "geometry", label: "Geometry" }, { id: "pressure", label: "Cp" }, { id: "flow3d", label: "3D Flow" },
    { id: "polar", label: "Polars" }, { id: "data", label: "Export" },
    { id: "advisor", label: "AI Advisor" }, { id: "theory", label: "Theory" },
  ];

  const ls = { fontSize: 10, color: "#64748b", marginBottom: 4, display: "block", letterSpacing: "0.06em", fontFamily: "'IBM Plex Mono', monospace" };
  const formLabel = { fontSize: 11, color: "#94a3b8", marginBottom: 3, display: "block", fontWeight: 500 };
  const formSelect = { background: "rgba(15,23,42,0.7)", border: "1px solid rgba(51,65,85,0.5)", borderRadius: 6, padding: "7px 10px", color: "#e2e8f0", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, outline: "none", width: "100%", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center", paddingRight: "26px" };

  // ============================================================
  // LANDING PAGE
  // ============================================================
  if (page === "landing") {
    const features = [
      { icon: "◇", title: "Panel Method Solver", desc: "Hess-Smith panel method with Gaussian elimination. Real-time CL, CD, CM, and Cp distribution for any NACA 4/5-digit airfoil or custom geometry." },
      { icon: "△", title: "3D Flow Visualization", desc: "Interactive WebGL scene with extruded airfoil, animated particle streamlines, and pressure-mapped surface coloring. Orbit, zoom, explore." },
      { icon: "▽", title: "AI Selection Advisor", desc: "Describe your mission — UAV endurance, wind turbine root section, acrobatic aircraft — and get specific airfoil recommendations backed by aerodynamic reasoning." },
      { icon: "○", title: "Custom Airfoil Upload", desc: "Drag-and-drop Selig or Lednicer .dat files from the UIUC database. Auto-normalized, auto-closed trailing edge. 1,600+ airfoils compatible." },
      { icon: "□", title: "Polar Curve Generation", desc: "Sweep angle of attack and compute full CL-α, drag polar, CM, and L/D curves. Export everything as CSV for further analysis." },
      { icon: "◆", title: "Airfoil Comparison", desc: "Overlay two airfoils simultaneously. Compare geometry, Cp distributions, and aerodynamic coefficients side by side." },
    ];

    return (
      <div style={{ minHeight: "100vh", background: "#060a13", fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", color: "#e2e8f0", overflow: "hidden" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body, #root { margin: 0; padding: 0; width: 100%; overflow-x: hidden; background: #060a13; }
          @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
          @keyframes lineGrow { from { width: 0; } to { width: 60px; } }
          @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          .hero-line { animation: lineGrow 1s ease forwards; animation-delay: 0.8s; width: 0; }
          .fade-up { opacity: 0; animation: fadeUp 0.7s ease forwards; }
          .fade-in { opacity: 0; animation: fadeIn 0.5s ease forwards; }
          .feature-card { background: rgba(15,23,42,0.4); border: 1px solid rgba(51,65,85,0.25); border-radius: 12px; padding: 28px; transition: all 0.3s ease; cursor: default; }
          .feature-card:hover { border-color: rgba(37,99,235,0.35); background: rgba(15,23,42,0.6); transform: translateY(-3px); }
          .cta-btn { background: #2563eb; color: white; border: none; border-radius: 8px; padding: 14px 36px; font-family: 'IBM Plex Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; }
          .cta-btn:hover { background: #3b82f6; transform: translateY(-2px); box-shadow: 0 8px 30px rgba(37,99,235,0.3); }
          .cta-secondary { background: transparent; color: #94a3b8; border: 1px solid rgba(51,65,85,0.5); border-radius: 8px; padding: 13px 32px; font-family: 'IBM Plex Sans', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
          .cta-secondary:hover { border-color: #3b82f6; color: #e2e8f0; }
          .stat-value { font-size: 28px; font-weight: 700; font-family: 'IBM Plex Mono', monospace; background: linear-gradient(135deg, #3b82f6, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .nav-link { color: #64748b; font-size: 13px; text-decoration: none; transition: color 0.15s; cursor: pointer; font-weight: 500; }
          .nav-link:hover { color: #e2e8f0; }
          .glow-orb { position: absolute; border-radius: 50%; filter: blur(80px); pointer-events: none; }
        `}</style>

        {/* Background effects */}
        <div className="glow-orb" style={{ width: 500, height: 500, top: -150, right: -100, background: "rgba(37,99,235,0.06)" }} />
        <div className="glow-orb" style={{ width: 400, height: 400, bottom: 100, left: -100, background: "rgba(6,182,212,0.04)" }} />
        <div className="glow-orb" style={{ width: 300, height: 300, top: "40%", right: "20%", background: "rgba(37,99,235,0.03)" }} />

        {/* NAV */}
        <nav style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 10 }} className="fade-in" >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb", boxShadow: "0 0 12px rgba(37,99,235,0.5)" }} />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>AeroPanel</span>
          </div>
          <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
            <span className="nav-link" onClick={() => setPage("app")}>Analyzer</span>
            <span className="nav-link" onClick={() => setPage("app")}>AI Advisor</span>
            <span className="nav-link" onClick={() => { setPage("app"); setTimeout(() => setActiveTab("theory"), 100); }}>Theory</span>
            <button className="cta-btn" style={{ padding: "8px 20px", fontSize: 12 }} onClick={() => setPage("app")}>Launch App</button>
          </div>
        </nav>

        {/* HERO */}
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 32px 60px", position: "relative", zIndex: 10 }}>
          <div className="fade-up" style={{ animationDelay: "0.1s" }}>
            <div style={{ display: "inline-block", padding: "5px 14px", borderRadius: 20, border: "1px solid rgba(37,99,235,0.25)", background: "rgba(37,99,235,0.08)", fontSize: 11, color: "#60a5fa", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 24, letterSpacing: "0.08em" }}>
              OPEN-SOURCE AIRFOIL ANALYSIS
            </div>
          </div>
          <h1 className="fade-up" style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.1, maxWidth: 700, letterSpacing: "-0.03em", animationDelay: "0.2s" }}>
            Airfoil analysis,<br />
            <span style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4, #3b82f6)", backgroundSize: "200% 200%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "gradientShift 4s ease infinite" }}>
              reimagined for the web.
            </span>
          </h1>
          <div className="hero-line" style={{ height: 2, background: "linear-gradient(to right, #2563eb, transparent)", marginTop: 24, marginBottom: 24 }} />
          <p className="fade-up" style={{ fontSize: 17, color: "#64748b", maxWidth: 540, lineHeight: 1.65, animationDelay: "0.4s" }}>
            A browser-based Hess-Smith panel method solver with real-time Cp visualization, 3D flow simulation, AI-powered airfoil selection, and support for 1,600+ UIUC database airfoils. No install. No account. No limits.
          </p>
          <div className="fade-up" style={{ display: "flex", gap: 14, marginTop: 36, animationDelay: "0.5s" }}>
            <button className="cta-btn" onClick={() => setPage("app")}>Open Analyzer</button>
            <button className="cta-secondary" onClick={() => { setPage("app"); setTimeout(() => setActiveTab("advisor"), 100); }}>Try AI Advisor</button>
          </div>
        </section>

        {/* STATS */}
        <section className="fade-up" style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 60px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, animationDelay: "0.6s", position: "relative", zIndex: 10 }}>
          {[
            { value: "121×121", label: "Matrix solve per analysis" },
            { value: "~15k", label: "Influence coefficients" },
            { value: "1,600+", label: "Compatible airfoils" },
            { value: "<50ms", label: "Solve time" },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: "center", padding: 20 }}>
              <div className="stat-value">{s.value}</div>
              <div style={{ fontSize: 11.5, color: "#475569", marginTop: 6, fontFamily: "'IBM Plex Mono', monospace" }}>{s.label}</div>
            </div>
          ))}
        </section>

        {/* FEATURES */}
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px", position: "relative", zIndex: 10 }}>
          <div className="fade-up" style={{ textAlign: "center", marginBottom: 48, animationDelay: "0.7s" }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 10 }}>Everything you need for airfoil analysis</h2>
            <p style={{ fontSize: 14, color: "#475569", maxWidth: 500, margin: "0 auto" }}>From preliminary design to detailed pressure analysis, all running client-side in your browser.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
            {features.map((f, i) => (
              <div key={i} className="feature-card fade-up" style={{ animationDelay: `${0.8 + i * 0.1}s` }}>
                <div style={{ fontSize: 22, color: "#2563eb", marginBottom: 14, opacity: 0.7 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, letterSpacing: "-0.01em" }}>{f.title}</h3>
                <p style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px", position: "relative", zIndex: 10 }}>
          <div className="fade-up" style={{ textAlign: "center", marginBottom: 40 }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 10 }}>How it works</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {[
              { step: "01", title: "Select or upload", desc: "Choose from 21 NACA presets, enter a custom 4/5-digit code, or drag-and-drop any .dat file from the UIUC airfoil database." },
              { step: "02", title: "Analyze instantly", desc: "The panel method solver computes pressure distribution, force coefficients, and velocity field in under 50ms. Adjust angle of attack in real time." },
              { step: "03", title: "Explore and export", desc: "Visualize in 2D or 3D, generate polar curves, compare airfoils, ask the AI advisor, and export all data as CSV or .dat files." },
            ].map((s, i) => (
              <div key={i} className="fade-up" style={{ animationDelay: `${1.2 + i * 0.15}s` }}>
                <div style={{ fontSize: 36, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: "rgba(37,99,235,0.15)", marginBottom: 12, lineHeight: 1 }}>{s.step}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{s.title}</h3>
                <p style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FINAL CTA */}
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 100px", textAlign: "center", position: "relative", zIndex: 10 }}>
          <div className="fade-up" style={{ padding: "56px 40px", background: "linear-gradient(135deg, rgba(37,99,235,0.08), rgba(6,182,212,0.05))", border: "1px solid rgba(37,99,235,0.15)", borderRadius: 16 }}>
            <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 10, letterSpacing: "-0.02em" }}>Ready to analyze?</h2>
            <p style={{ fontSize: 14, color: "#64748b", marginBottom: 28, maxWidth: 400, margin: "0 auto 28px" }}>No sign-up, no download, no restrictions. Just open the analyzer and start designing.</p>
            <button className="cta-btn" style={{ fontSize: 15, padding: "16px 44px" }} onClick={() => setPage("app")}>Launch AeroPanel</button>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 32px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(51,65,85,0.2)", position: "relative", zIndex: 10 }}>
          <div style={{ fontSize: 11, color: "#334155", fontFamily: "'IBM Plex Mono', monospace" }}>AeroPanel v4.0 — Hess-Smith Panel Method Solver</div>
          <div style={{ fontSize: 11, color: "#334155", fontFamily: "'IBM Plex Mono', monospace" }}>Inviscid • Incompressible • Client-Side</div>
        </footer>
      </div>
    );
  }

  // ============================================================
  // ANALYZER APP (page === "app")
  // ============================================================
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #0a0f1a 0%, #101827 40%, #0a0f1a 100%)", fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", color: "#e2e8f0", padding: 0, margin: 0 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { margin: 0; padding: 0; width: 100%; overflow-x: hidden; background: #0a0f1a; }
        .gp { background: rgba(15,23,42,0.55); backdrop-filter: blur(16px); border: 1px solid rgba(51,65,85,0.35); border-radius: 10px; }
        .mc { background: linear-gradient(135deg, rgba(15,23,42,0.7), rgba(30,41,59,0.35)); border: 1px solid rgba(51,65,85,0.4); border-radius: 8px; padding: 12px 16px; transition: border-color 0.2s; }
        .mc:hover { border-color: rgba(37,99,235,0.35); }
        .polar-card { border-radius: 8px; border: 1px solid rgba(51,65,85,0.4); background: rgba(15,23,42,0.45); padding: 6px; }
        .tb { padding: 7px 14px; border-radius: 6px; font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; transition: all 0.15s; cursor: pointer; border: 1px solid transparent; background: transparent; color: #64748b; font-family: 'IBM Plex Sans', sans-serif; }
        .tb:hover { color: #94a3b8; background: rgba(30,41,59,0.4); }
        .tb.active { background: rgba(37,99,235,0.12); color: #3b82f6; border-color: rgba(37,99,235,0.25); }
        .inf { background: rgba(15,23,42,0.7); border: 1px solid rgba(51,65,85,0.5); border-radius: 6px; padding: 8px 11px; color: #e2e8f0; font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; outline: none; transition: border-color 0.15s; width: 100%; }
        .inf:focus { border-color: #2563eb; }
        .bp { background: #2563eb; color: white; border: none; border-radius: 6px; padding: 9px 18px; font-family: 'IBM Plex Sans', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; }
        .bp:hover { background: #3b82f6; transform: translateY(-1px); }
        .bp:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        .bs { background: rgba(30,41,59,0.5); color: #94a3b8; border: 1px solid rgba(51,65,85,0.4); border-radius: 6px; padding: 7px 14px; font-family: 'IBM Plex Sans', sans-serif; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
        .bs:hover { background: rgba(30,41,59,0.7); color: #e2e8f0; }
        .slider-container input[type="range"] { -webkit-appearance: none; width: 100%; height: 3px; border-radius: 2px; background: #1e293b; outline: none; }
        .slider-container input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #2563eb; cursor: pointer; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'IBM Plex Mono', monospace; }
        .data-table th { padding: 7px 10px; text-align: left; color: #64748b; border-bottom: 1px solid rgba(51,65,85,0.4); font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; font-size: 9.5px; }
        .data-table td { padding: 5px 10px; border-bottom: 1px solid rgba(30,41,59,0.4); color: #cbd5e1; }
        .data-table tr:hover td { background: rgba(30,41,59,0.25); }
        select.inf { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2364748b' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fi { animation: fadeIn 0.35s ease forwards; }
        .dz { border: 1.5px dashed rgba(37,99,235,0.3); border-radius: 8px; padding: 18px; text-align: center; transition: all 0.2s; cursor: pointer; }
        .dz:hover, .dz.active { border-color: #2563eb; background: rgba(37,99,235,0.04); }
        .dz.dragover { border-color: #16a34a; background: rgba(22,163,74,0.06); }
        .ts { color: #94a3b8; font-size: 13.5px; line-height: 1.75; }
        .ts h4 { color: #e2e8f0; font-size: 14px; font-weight: 600; margin: 22px 0 6px; }
        .ts h4:first-child { margin-top: 0; }
        .ts code { background: rgba(30,41,59,0.7); padding: 1px 5px; border-radius: 3px; font-size: 12px; color: #60a5fa; font-family: 'IBM Plex Mono', monospace; }
        .ts .eq { background: rgba(15,23,42,0.7); border: 1px solid rgba(51,65,85,0.35); border-radius: 6px; padding: 10px 14px; margin: 8px 0; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #e2e8f0; }
        .mt { display: flex; border-radius: 6px; overflow: hidden; border: 1px solid rgba(51,65,85,0.4); }
        .mt button { flex: 1; padding: 7px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; border: none; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; font-weight: 500; transition: all 0.15s; }
        .mt button.active { background: rgba(37,99,235,0.15); color: #3b82f6; }
        .mt button:not(.active) { background: rgba(15,23,42,0.5); color: #475569; }
        .ai-input { background: rgba(15,23,42,0.7); border: 1px solid rgba(51,65,85,0.5); border-radius: 8px; padding: 12px 14px; color: #e2e8f0; font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; outline: none; width: 100%; resize: vertical; min-height: 80px; transition: border-color 0.15s; line-height: 1.5; }
        .ai-input:focus { border-color: #2563eb; }
        .ai-input::placeholder { color: #334155; }
        .ai-response { background: rgba(15,23,42,0.5); border: 1px solid rgba(51,65,85,0.3); border-radius: 8px; padding: 16px 18px; color: #94a3b8; font-size: 13px; line-height: 1.65; max-height: 500px; overflow-y: auto; }
        .naca-chip { display: inline-block; padding: 4px 10px; border-radius: 5px; font-size: 11px; font-weight: 600; font-family: 'IBM Plex Mono', monospace; cursor: pointer; transition: all 0.15s; background: rgba(37,99,235,0.12); color: #60a5fa; border: 1px solid rgba(37,99,235,0.25); margin: 3px; }
        .naca-chip:hover { background: rgba(37,99,235,0.25); border-color: #3b82f6; }
        @keyframes pulse { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
        .ld { animation: pulse 1.2s infinite; }
      `}</style>

      <div style={{ padding: "20px 28px 0", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span onClick={() => setPage("landing")} style={{ fontSize: 11, color: "#475569", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>← Home</span>
            <div><h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px", color: "#e2e8f0", letterSpacing: "-0.02em" }}>AeroPanel</h1><p style={{ fontSize: 11, color: "#475569", margin: 0, fontFamily: "'IBM Plex Mono', monospace" }}>Panel Method Solver + AI Advisor</p></div>
          </div>
          <div style={{ fontSize: 10, color: "#1e293b", fontFamily: "'IBM Plex Mono', monospace" }}>v4.0</div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 28px 40px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 18 }}>
        {/* SIDEBAR */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="gp" style={{ padding: 18 }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12, fontFamily: "'IBM Plex Mono'" }}>Source</div>
            <div className="mt" style={{ marginBottom: 14 }}><button className={mode === "naca" ? "active" : ""} onClick={() => setMode("naca")}>NACA</button><button className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>Upload</button></div>
            {mode === "naca" ? (<><label style={ls}>Preset</label><select className="inf" value={selectedPreset} onChange={e => { setSelectedPreset(e.target.value); setNacaCode(PRESETS[e.target.value]); }} style={{ marginBottom: 10 }}>{Object.keys(PRESETS).map(k => <option key={k} value={k} style={{ background: "#0f172a" }}>{k}</option>)}</select><label style={ls}>Code</label><input className="inf" value={nacaCode} onChange={e => setNacaCode(e.target.value)} style={{ marginBottom: 3, borderColor: isValid(nacaCode) ? undefined : "#dc2626" }} />{!isValid(nacaCode) && <p style={{ fontSize: 10, color: "#dc2626", margin: "0 0 6px", fontFamily: "'IBM Plex Mono'" }}>4 or 5 digits</p>}</>) : (<><div className={`dz ${dragOver ? "dragover" : ""} ${customPoints ? "active" : ""}`} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }} onClick={() => fileInputRef.current?.click()}><input ref={fileInputRef} type="file" accept=".dat,.txt,.csv" style={{ display: "none" }} onChange={e => handleFile(e.target.files?.[0])} />{customPoints ? <div><div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600, fontFamily: "'IBM Plex Mono'" }}>✓ {customName}</div><div style={{ fontSize: 10, color: "#475569" }}>{customPoints.length} pts</div></div> : <div><div style={{ fontSize: 11, color: "#64748b" }}>Drop .dat file</div><div style={{ fontSize: 9.5, color: "#334155", marginTop: 3 }}>Selig / Lednicer</div></div>}</div>{uploadError && <div style={{ marginTop: 6, padding: "6px 10px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 6, fontSize: 10.5, color: "#dc2626" }}>{uploadError}</div>}</>)}
            <div style={{ marginTop: 14 }}><label style={{ ...ls, display: "flex", justifyContent: "space-between" }}><span>AoA</span><span style={{ color: "#3b82f6", fontWeight: 600 }}>{alpha}°</span></label><div className="slider-container" style={{ marginTop: 5 }}><input type="range" min="-15" max="20" step="0.5" value={alpha} onChange={e => setAlpha(parseFloat(e.target.value))} /></div></div>
            {mode === "naca" && <div style={{ marginTop: 10 }}><label style={{ ...ls, display: "flex", justifyContent: "space-between" }}><span>Panels</span><span style={{ color: "#94a3b8" }}>{numPanels}</span></label><div className="slider-container" style={{ marginTop: 5 }}><input type="range" min="40" max="200" step="10" value={numPanels} onChange={e => setNumPanels(parseInt(e.target.value))} /></div></div>}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}><label style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}><input type="checkbox" checked={showGrid} onChange={() => setShowGrid(!showGrid)} style={{ accentColor: "#2563eb" }} />Grid</label><label style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}><input type="checkbox" checked={compareMode} onChange={() => setCompareMode(!compareMode)} style={{ accentColor: "#d97706" }} />Compare</label></div>
            {compareMode && <div style={{ marginTop: 8 }}><label style={{ fontSize: 10, color: "#d97706", fontFamily: "'IBM Plex Mono'" }}>vs NACA</label><input className="inf" value={compareCode} onChange={e => setCompareCode(e.target.value)} style={{ marginTop: 3, borderColor: isValid(compareCode) ? "rgba(217,119,6,0.25)" : "#dc2626" }} /></div>}
          </div>
          {results && <div className="gp fi" style={{ padding: 18 }}><div style={{ fontSize: 9.5, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12, fontFamily: "'IBM Plex Mono'" }}>Coefficients</div><div style={{ display: "grid", gap: 6 }}>{[{ l: "CL", v: fmt(results.cl), c: "#2563eb", k: "cl" }, { l: "CD", v: fmt(results.cd, 5), c: "#dc2626", k: "cd" }, { l: "CM", v: fmt(results.cm), c: "#16a34a", k: "cm" }, { l: "L/D", v: fmt(results.cl / Math.max(results.cd, 1e-8), 1), c: "#7c3aed", k: "ld" }].map(m => <div key={m.l} className="mc"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 9.5, color: "#64748b", fontFamily: "'IBM Plex Mono'" }}>{m.l}</span><span style={{ fontSize: 17, fontWeight: 700, color: m.c, fontFamily: "'IBM Plex Mono'" }}>{m.v}</span></div>{compareResults && <div style={{ fontSize: 10, color: "#d97706", marginTop: 2, fontFamily: "'IBM Plex Mono'" }}>vs {fmt(m.k === "ld" ? compareResults.cl / Math.max(compareResults.cd, 1e-8) : compareResults[m.k], m.k === "ld" ? 1 : 4)}</div>}</div>)}</div></div>}
          {results && <div className="gp fi" style={{ padding: 18 }}><div style={{ fontSize: 9.5, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8, fontFamily: "'IBM Plex Mono'" }}>Geometry</div><div style={{ fontSize: 10.5, color: "#94a3b8", display: "grid", gap: 4, fontFamily: "'IBM Plex Mono'" }}>{[["Pts", points.length], ["t/c", `${(results.maxThickness * 100).toFixed(1)}%`], ["Camber", `${(Math.abs(results.maxCamber) * 100).toFixed(2)}%`]].map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>{k}</span><span>{v}</span></div>)}</div></div>}
        </div>

        {/* MAIN */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{tabs.map(t => <button key={t.id} className={`tb ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}</div>

          {activeTab === "geometry" && <div className="gp fi" style={{ padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>{getLabel()} — α = {alpha}°</span><span style={{ fontSize: 9.5, color: "#334155", fontFamily: "'IBM Plex Mono'" }}>{points.length} pts</span></div>{AirfoilSVG}</div>}

          {activeTab === "pressure" && <div className="fi" style={{ display: "flex", flexDirection: "column", gap: 14 }}><div className="gp" style={{ padding: 18 }}><div style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8", marginBottom: 8 }}>Pressure Vectors</div>{AirfoilSVG}</div><div className="gp" style={{ padding: 18 }}>{CpPlot}</div></div>}

          {/* 3D FLOW TAB */}
          {activeTab === "flow3d" && <div className="gp fi" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>3D Flow Visualization — {getLabel()}</span>
              <span style={{ fontSize: 9.5, color: "#334155", fontFamily: "'IBM Plex Mono'" }}>WebGL / Three.js</span>
            </div>
            <FlowVisualization3D points={points} alpha={alpha} results={results} />
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.12)", borderRadius: 6, fontSize: 10.5, color: "#475569", lineHeight: 1.5 }}>
              Extruded airfoil with animated particle streamlines. Colors show velocity magnitude (cyan = slow, white = fast). Cp coloring maps suction (blue) to pressure (red) on the surface. Streamlines deflect based on panel method results and angle of attack.
            </div>
          </div>}

          {activeTab === "polar" && <div className="gp fi" style={{ padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}><span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>Polars — {getLabel()}</span><div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{[["α min", "min"], ["α max", "max"], ["step", "step"]].map(([l, k]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}><label style={{ fontSize: 10, color: "#475569" }}>{l}</label><input className="inf" type="number" value={alphaRange[k]} onChange={e => setAlphaRange({ ...alphaRange, [k]: parseFloat(e.target.value) })} style={{ width: 52, fontFamily: "'IBM Plex Mono'" }} /></div>)}<button className="bp" onClick={computePolar} disabled={computing}>{computing ? "..." : "Compute"}</button></div></div>{polarData ? PolarPlots : <div style={{ textAlign: "center", padding: 50, color: "#334155", fontSize: 12 }}>Set α range and compute</div>}</div>}

          {activeTab === "data" && results && <div className="gp fi" style={{ padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}><span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>{results.xm.length} panels</span><div style={{ display: "flex", gap: 6 }}><button className="bp" onClick={exportCSV}>CSV</button><button className="bs" onClick={exportDat}>.dat</button></div></div><div style={{ maxHeight: 480, overflow: "auto", borderRadius: 6 }}><table className="data-table"><thead><tr><th>#</th><th>x/c</th><th>y/c</th><th>Cp</th><th>Vt</th></tr></thead><tbody>{results.xm.map((x, i) => <tr key={i}><td style={{ color: "#475569" }}>{i + 1}</td><td>{x.toFixed(5)}</td><td>{results.ym[i].toFixed(5)}</td><td style={{ color: results.Cp[i] < 0 ? "#dc2626" : "#16a34a" }}>{results.Cp[i].toFixed(5)}</td><td>{results.Vt[i].toFixed(5)}</td></tr>)}</tbody></table></div></div>}

          {/* AI ADVISOR TAB — with structured form + freeform */}
          {activeTab === "advisor" && <div className="gp fi" style={{ padding: 22 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Airfoil Selection Advisor</div>
              <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>Describe your requirements or fill out the structured form below.</div>
            </div>

            <div className="mt" style={{ marginBottom: 16 }}>
              <button className={reqMode === "form" ? "active" : ""} onClick={() => setReqMode("form")}>Requirements Form</button>
              <button className={reqMode === "freeform" ? "active" : ""} onClick={() => setReqMode("freeform")}>Freeform</button>
            </div>

            {reqMode === "form" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div><label style={formLabel}>Application Type</label><select style={formSelect} value={reqApp} onChange={e => setReqApp(e.target.value)}><option value="" style={{ background: "#0f172a" }}>Select...</option><option style={{ background: "#0f172a" }}>General Aviation Aircraft</option><option style={{ background: "#0f172a" }}>UAV / Drone</option><option style={{ background: "#0f172a" }}>Sailplane / Glider</option><option style={{ background: "#0f172a" }}>Fighter / High Performance</option><option style={{ background: "#0f172a" }}>RC Model Aircraft</option><option style={{ background: "#0f172a" }}>Wind Turbine Blade</option><option style={{ background: "#0f172a" }}>Propeller / Rotor Blade</option><option style={{ background: "#0f172a" }}>Flying Wing / BWB</option><option style={{ background: "#0f172a" }}>Aerobatic Aircraft</option><option style={{ background: "#0f172a" }}>VTOL / eVTOL</option><option style={{ background: "#0f172a" }}>High Altitude / HALE</option><option style={{ background: "#0f172a" }}>Supersonic Vehicle</option></select></div>
                <div><label style={formLabel}>Reynolds Number</label><select style={formSelect} value={reqRe} onChange={e => setReqRe(e.target.value)}><option value="" style={{ background: "#0f172a" }}>Select...</option><option style={{ background: "#0f172a" }}>Below 100,000 (micro UAV, insect scale)</option><option style={{ background: "#0f172a" }}>100k - 500k (small UAV, RC model)</option><option style={{ background: "#0f172a" }}>500k - 2M (large UAV, light GA)</option><option style={{ background: "#0f172a" }}>2M - 6M (GA cruise, small turboprop)</option><option style={{ background: "#0f172a" }}>6M - 20M (transport, business jet)</option><option style={{ background: "#0f172a" }}>Above 20M (large transport, high speed)</option><option style={{ background: "#0f172a" }}>Unknown / varies</option></select></div>
                <div><label style={formLabel}>Speed / Mach Range</label><select style={formSelect} value={reqSpeed} onChange={e => setReqSpeed(e.target.value)}><option value="" style={{ background: "#0f172a" }}>Select...</option><option style={{ background: "#0f172a" }}>Very low (below 30 m/s)</option><option style={{ background: "#0f172a" }}>Low subsonic (30-80 m/s)</option><option style={{ background: "#0f172a" }}>Moderate subsonic (80-150 m/s)</option><option style={{ background: "#0f172a" }}>High subsonic (M 0.5-0.85)</option><option style={{ background: "#0f172a" }}>Transonic (M 0.85-1.2)</option><option style={{ background: "#0f172a" }}>Variable / multiple regimes</option></select></div>
                <div><label style={formLabel}>Primary Design Priority</label><select style={formSelect} value={reqPriority} onChange={e => setReqPriority(e.target.value)}><option value="" style={{ background: "#0f172a" }}>Select...</option><option style={{ background: "#0f172a" }}>Maximum L/D (endurance/range)</option><option style={{ background: "#0f172a" }}>High CL_max (short takeoff/landing)</option><option style={{ background: "#0f172a" }}>Low drag (speed)</option><option style={{ background: "#0f172a" }}>Gentle stall characteristics</option><option style={{ background: "#0f172a" }}>Low pitching moment</option><option style={{ background: "#0f172a" }}>Structural depth (thick section)</option><option style={{ background: "#0f172a" }}>Laminar flow extent</option><option style={{ background: "#0f172a" }}>Symmetric / zero-lift zero-moment</option><option style={{ background: "#0f172a" }}>Multi-point (climb + cruise)</option></select></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={formLabel}>Thickness Constraint</label><select style={formSelect} value={reqThickness} onChange={e => setReqThickness(e.target.value)}><option value="" style={{ background: "#0f172a" }}>No preference</option><option style={{ background: "#0f172a" }}>Thin (6-9% t/c)</option><option style={{ background: "#0f172a" }}>Moderate (10-14% t/c)</option><option style={{ background: "#0f172a" }}>Thick (15-18% t/c)</option><option style={{ background: "#0f172a" }}>Very thick (18%+ t/c, structural root)</option></select></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={formLabel}>Additional Notes</label><input className="inf" value={reqExtra} onChange={e => setReqExtra(e.target.value)} placeholder="e.g., must avoid sharp stall, need internal volume for fuel, operating in dusty environment..." /></div>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                  <button className="bp" style={{ flex: 1 }} onClick={() => askAI(buildFormQuery())} disabled={aiLoading || !reqApp}>
                    {aiLoading ? "Analyzing..." : "Get Recommendations"}
                  </button>
                  <button className="bs" onClick={() => { setReqApp(""); setReqRe(""); setReqSpeed(""); setReqPriority(""); setReqThickness(""); setReqExtra(""); }}>Reset</button>
                </div>
              </div>
            ) : (
              <>
                <textarea className="ai-input" value={aiQuery} onChange={e => setAiQuery(e.target.value)}
                  placeholder={"Describe your application...\n• UAV for long endurance at Re=200k\n• Wind turbine blade root section at Re=3M\n• Compare 4412 vs 23012 for 150kt cruise"}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAI(); } }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <span style={{ fontSize: 10, color: "#334155" }}>Shift+Enter for newline</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {aiHistory.length > 0 && <button className="bs" onClick={() => { setAiHistory([]); setAiResponse(""); }}>Clear</button>}
                    <button className="bp" onClick={() => askAI()} disabled={aiLoading || !aiQuery.trim()}>{aiLoading ? "..." : "Ask"}</button>
                  </div>
                </div>
              </>
            )}

            {aiLoading && <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, color: "#475569", fontSize: 12 }}><span className="ld">●</span><span className="ld" style={{ animationDelay: ".2s" }}>●</span><span className="ld" style={{ animationDelay: ".4s" }}>●</span><span style={{ marginLeft: 4 }}>Analyzing requirements...</span></div>}

            {aiResponse && <div style={{ marginTop: 16 }}>
              {extractCodes(aiResponse).length > 0 && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 9.5, color: "#475569", marginBottom: 5, fontFamily: "'IBM Plex Mono'", letterSpacing: ".08em", textTransform: "uppercase" }}>Quick Load → Analyzer</div>{extractCodes(aiResponse).map(code => <span key={code} className="naca-chip" onClick={() => loadFromAI(code)}>NACA {code}</span>)}</div>}
              <div className="ai-response">{renderAI(aiResponse)}</div>
            </div>}

            {!aiResponse && !aiLoading && <div style={{ marginTop: 16, padding: 16, border: "1px solid rgba(51,65,85,0.2)", borderRadius: 8, color: "#334155", fontSize: 11.5, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: "#475569", marginBottom: 5 }}>The advisor recommends airfoils for:</div>
              <div>→ Specific aircraft types and flight regimes</div>
              <div>→ Reynolds number matching</div>
              <div>→ Lift/drag/moment trade-off analysis</div>
              <div>→ Wind turbine and propeller sections</div>
              <div>→ Comparison of candidate airfoils</div>
            </div>}
          </div>}

          {activeTab === "theory" && <div className="gp fi" style={{ padding: 24 }}><div className="ts"><h4>Hess-Smith Panel Method</h4><p>Inviscid, incompressible potential flow. <code>N</code> panels with source <code>σᵢ</code> and vortex <code>γ</code>.</p><div className="eq">V∞·n̂ᵢ + Σⱼ σⱼ·Iᵢⱼ + γ·Σⱼ Jᵢⱼ = 0</div><h4>Kutta Condition</h4><div className="eq">γ₁ + γₙ = 0</div><h4>Forces</h4><div className="eq">Cpᵢ = 1 − (Vtᵢ/V∞)² &nbsp; CL = −Σ Cpᵢ·Δxᵢ &nbsp; CD = −Σ Cpᵢ·Δyᵢ</div><h4>Limitations</h4><p>No viscous drag, no separation. Valid for moderate α in attached flow.</p></div></div>}

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#1e293b", fontFamily: "'IBM Plex Mono'" }}><span>Hess-Smith • Inviscid</span><span>{getLabel()}</span></div>
        </div>
      </div>
    </div>
  );
}
