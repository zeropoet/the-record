import { buildKernelField, FOLDKERNEL, stableHash } from "./record-kernel.js";

const canvas = document.querySelector("#field");
const context = canvas.getContext("2d");
const listenButton = document.querySelector("#listen");
const clearButton = document.querySelector("#clear");
const archiveList = document.querySelector("#archive-list");
const assemblyList = document.querySelector("#assembly-list");
const assemblyEmpty = document.querySelector("#assembly-empty");
const fieldLabel = document.querySelector("#field-label");
const kernelLabel = document.querySelector("#kernel-label");
const timecode = document.querySelector("#timecode");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = { catalog: null, nodes: [], edges: [], layout: null, selected: new Set(), hover: -1, pointer: { x: 0, y: 0 }, started: performance.now() };
let audio;

class RecordAudio {
  constructor() { this.context = null; this.output = null; this.voices = new Map(); this.awake = false; }
  async start() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context ||= new AudioContext();
    await this.context.resume();
    if (!this.output) {
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -24; compressor.ratio.value = 3; compressor.attack.value = .08; compressor.release.value = .7;
      this.output = this.context.createGain(); this.output.gain.value = .0001;
      this.output.connect(compressor).connect(this.context.destination);
    }
    this.awake = true;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.exponentialRampToValueAtTime(.2, this.context.currentTime + 1.4);
    this.reconcile();
  }
  stop() {
    if (!this.context || !this.output) return;
    this.output.gain.setTargetAtTime(.0001, this.context.currentTime, .18);
    this.awake = false;
    setTimeout(() => { if (!this.awake) this.context?.suspend(); }, 900);
  }
  reconcile() {
    if (!this.context || !this.output) return;
    const playable = state.catalog.entries.filter((entry) => state.selected.has(entry.id) && entry.sound);
    for (const [id, voice] of this.voices) if (!playable.some((entry) => entry.id === id)) {
      voice.gain.gain.setTargetAtTime(.0001, this.context.currentTime, .22);
      voice.oscillators.forEach((oscillator) => oscillator.stop(this.context.currentTime + 1));
      this.voices.delete(id);
    }
    playable.forEach((entry, order) => {
      if (this.voices.has(entry.id)) return;
      const voiceGain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const pan = this.context.createStereoPanner();
      const seed = stableHash(entry.id);
      const root = entry.sound.rootHz || 46 + seed % 25;
      const kernelValue = state.nodes.find(({ entry: nodeEntry }) => nodeEntry.id === entry.id)?.kernel.value || 1;
      filter.type = "lowpass"; filter.frequency.value = entry.sound.cutoffHz || 900 + seed % 1400; filter.Q.value = .7;
      pan.pan.value = playable.length < 2 ? 0 : -.34 + order / Math.max(1, playable.length - 1) * .68;
      voiceGain.gain.value = .0001;
      filter.connect(pan).connect(voiceGain).connect(this.output);
      const ratios = [...new Set([...(entry.sound.ratios || [1, 1.5, 2.01]), .5, 1 + kernelValue / 16])].slice(0, 6);
      const oscillators = ratios.map((ratio, index) => {
        const oscillator = this.context.createOscillator();
        const partial = this.context.createGain();
        oscillator.type = entry.sound.waves?.[index] || (index ? "triangle" : "sine");
        oscillator.frequency.value = root * ratio;
        oscillator.detune.value = ((seed >>> (index * 3)) % 9 - 4) * .35;
        partial.gain.value = [1, .22, .08, .03, .035, .02][index] || .02;
        oscillator.connect(partial).connect(filter); oscillator.start();
        return oscillator;
      });
      voiceGain.gain.exponentialRampToValueAtTime(.13 / Math.sqrt(playable.length), this.context.currentTime + 2.2);
      this.voices.set(entry.id, { gain: voiceGain, oscillators });
    });
    const level = playable.length ? .2 : .0001;
    this.output.gain.setTargetAtTime(level, this.context.currentTime, .4);
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
}

function positionNodes(width, height) {
  if (state.layout?.width === width && state.layout?.height === height) return;
  const field = buildKernelField(state.catalog.entries, width, height);
  state.nodes = field.nodes;
  state.edges = field.edges;
  state.layout = { width, height, center: field.center };
  kernelLabel.textContent = `FoldKernel ${FOLDKERNEL.packageVersion} / ${state.edges.length} stable relations`;
}

function draw(now) {
  if (!state.catalog) return requestAnimationFrame(draw);
  const { width, height } = resize();
  positionNodes(width, height);
  context.clearRect(0, 0, width, height);
  const center = state.layout.center;
  context.lineWidth = 1;
  state.nodes.forEach((node) => {
    const drift = reducedMotion ? 0 : Math.sin(now * .00022 + node.phase) * 5;
    node.drawX = node.x + drift;
    node.drawY = node.y + Math.cos(now * .00017 + node.phase) * 4;
  });
  state.edges.forEach((edge) => {
    const a = state.nodes[edge.a], b = state.nodes[edge.b];
    const selected = state.selected.has(a.entry.id) && state.selected.has(b.entry.id);
    context.beginPath();
    context.moveTo(a.drawX, a.drawY);
    const pull = edge.kind === "cross-branch" ? .18 : .08;
    context.quadraticCurveTo((a.drawX + b.drawX) / 2 + (center.x - (a.drawX + b.drawX) / 2) * pull, (a.drawY + b.drawY) / 2 + (center.y - (a.drawY + b.drawY) / 2) * pull, b.drawX, b.drawY);
    context.strokeStyle = selected ? "rgba(245,245,242,.72)" : edge.kind === "cross-branch" ? "rgba(245,245,242,.18)" : "rgba(245,245,242,.09)";
    context.stroke();
  });
  state.nodes.forEach((node, index) => {
    const selected = state.selected.has(node.entry.id), hovered = index === state.hover;
    context.beginPath(); context.arc(node.drawX, node.drawY, hovered ? 8 : selected ? 5 : 2.2, 0, Math.PI * 2);
    context.fillStyle = selected || hovered ? "#f5f5f2" : node.entry.sound ? "rgba(245,245,242,.52)" : "rgba(245,245,242,.2)"; context.fill();
  });
  context.beginPath(); context.arc(center.x, center.y, 3.5, 0, Math.PI * 2); context.fillStyle = "#f5f5f2"; context.fill();
  const elapsed = Math.floor((now - state.started) / 1000);
  timecode.textContent = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  requestAnimationFrame(draw);
}

function toggle(id) {
  const entry = state.catalog.entries.find((item) => item.id === id);
  if (!entry?.sound) return;
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  renderArchive(); renderAssembly(); audio?.reconcile();
}

function renderAssembly() {
  const entries = state.catalog.entries.filter(({ id }) => state.selected.has(id));
  assemblyEmpty.hidden = entries.length > 0;
  assemblyList.innerHTML = entries.map((entry, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><span>${entry.title}</span><button type="button" data-remove="${entry.id}">Remove</button></li>`).join("");
  assemblyList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.remove)));
}

function renderArchive() {
  document.querySelector("#record-count").textContent = String(state.catalog.entries.length).padStart(2, "0");
  document.querySelector("#branch-count").textContent = String(new Set(state.catalog.entries.map(({ branch }) => branch)).size).padStart(2, "0");
  archiveList.innerHTML = state.catalog.entries.map((entry, index) => `<article class="record">
    <p class="record-index">${String(index + 1).padStart(2, "0")}</p>
    <h3>${entry.title}</h3>
    <p class="record-kind">${entry.kind}</p>
    <p class="record-state">${entry.availability}</p>
    <div class="record-actions">
      ${entry.sound ? `<button type="button" data-select="${entry.id}" aria-pressed="${state.selected.has(entry.id)}">${state.selected.has(entry.id) ? "Held" : "Add"}</button>` : ""}
      <a href="${entry.source.url}" target="_blank" rel="noopener">Source</a>
    </div>
  </article>`).join("");
  archiveList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.select)));
}

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect(); state.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  state.hover = state.nodes.findIndex((node) => Math.hypot(node.drawX - state.pointer.x, node.drawY - state.pointer.y) < 18);
  fieldLabel.textContent = state.hover >= 0 ? `${state.nodes[state.hover].entry.title} / ${state.nodes[state.hover].entry.branch}` : "Move through the field";
});
canvas.addEventListener("pointerleave", () => { state.hover = -1; fieldLabel.textContent = "Move through the field"; });
canvas.addEventListener("click", () => { if (state.hover >= 0) toggle(state.nodes[state.hover].entry.id); });
canvas.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (state.hover >= 0) toggle(state.nodes[state.hover].entry.id); }
});
listenButton.addEventListener("click", async () => {
  audio ||= new RecordAudio();
  if (audio.awake) { audio.stop(); listenButton.textContent = "Listen"; listenButton.setAttribute("aria-pressed", "false"); }
  else { if (!state.selected.size) state.catalog.entries.filter(({ sound }) => sound).slice(0, 2).forEach(({ id }) => state.selected.add(id)); await audio.start(); renderArchive(); renderAssembly(); listenButton.textContent = "Silence"; listenButton.setAttribute("aria-pressed", "true"); }
});
clearButton.addEventListener("click", () => { state.selected.clear(); renderArchive(); renderAssembly(); audio?.reconcile(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && audio?.awake) audio.context?.suspend(); else if (audio?.awake) audio.context?.resume(); });

fetch("archive/sound-archive.json", { cache: "no-store" })
  .then((response) => { if (!response.ok) throw new Error(`Archive ${response.status}`); return response.json(); })
  .then((catalog) => { state.catalog = catalog; state.layout = null; renderArchive(); renderAssembly(); requestAnimationFrame(draw); })
  .catch((error) => { fieldLabel.textContent = "The archive could not be resolved"; console.error(error); });
