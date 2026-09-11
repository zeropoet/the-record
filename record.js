import { buildKernelField, FOLDKERNEL, stableHash } from "./record-kernel.js?v=3";
import { rankedCandidates } from "./compatibility.js?v=1";

const canvas = document.querySelector("#field");
const context = canvas.getContext("2d");
const listenButton = document.querySelector("#listen");
const clearButton = document.querySelector("#clear");
const operatorGrid = document.querySelector("#operator-grid");
const visualToggle = document.querySelector("#visual-toggle");
const baselineToggle = document.querySelector("#baseline-toggle");
const assemblyList = document.querySelector("#assembly-list");
const assemblyEmpty = document.querySelector("#assembly-empty");
const compatibilityList = document.querySelector("#compatibility-list");
const compatibilityState = document.querySelector("#compatibility-state");
const layerCount = document.querySelector("#layer-count");
const fieldLabel = document.querySelector("#field-label");
const kernelLabel = document.querySelector("#kernel-label");
const timecode = document.querySelector("#timecode");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const BASELINE_ID = "foldforge-resonant-holdings";
const state = {
  catalog: null,
  contract: null,
  nodes: [],
  edges: [],
  layout: null,
  selected: new Set(),
  hover: -1,
  pointer: { x: 0, y: 0 },
  started: performance.now(),
  filter: "all",
  visuals: true
};
let audio;
const isPlayable = (entry) => Boolean(entry.sound && (
  entry.sound.rootHz || entry.sound.frequenciesHz?.length || entry.sound.events?.length
));

class RecordAudio {
  constructor() { this.context = null; this.output = null; this.voices = new Map(); this.awake = false; }
  async start() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context ||= new AudioContext();
    await this.context.resume();
    if (!this.output) {
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -1; compressor.knee.value = 0; compressor.ratio.value = 20; compressor.attack.value = .003; compressor.release.value = .2;
      this.output = this.context.createGain(); this.output.gain.value = 1;
      this.output.connect(compressor).connect(this.context.destination);
    }
    this.awake = true;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.exponentialRampToValueAtTime(1, this.context.currentTime + .08);
    this.reconcile();
  }
  stop() {
    if (!this.context || !this.output) return;
    this.output.gain.setTargetAtTime(.0001, this.context.currentTime, .18);
    this.awake = false;
    for (const voice of this.voices.values()) this.stopVoice(voice);
    this.voices.clear();
    setTimeout(() => { if (!this.awake) this.context?.suspend(); }, 900);
  }
  stopVoice(voice) {
    voice.gain.gain.setTargetAtTime(.0001, this.context.currentTime, .12);
    if (voice.timer) clearTimeout(voice.timer);
    voice.oscillators?.forEach((oscillator) => {
      try { oscillator.stop(this.context.currentTime + .5); } catch {}
    });
  }
  connectContract(input, renderer = {}) {
    let tail = input;
    if (renderer.delay) {
      const merger = this.context.createGain();
      const delay = this.context.createDelay(Math.max(.8, Number(renderer.delay.maximumSeconds || .8)));
      const feedback = this.context.createGain();
      delay.delayTime.value = Number(renderer.delay.seconds || .24);
      feedback.gain.value = Number(renderer.delay.feedback || .32);
      tail.connect(merger); tail.connect(delay); delay.connect(feedback).connect(delay); delay.connect(merger);
      tail = merger;
    }
    if (renderer.compressor) {
      const compressor = this.context.createDynamicsCompressor();
      for (const key of ["threshold", "knee", "ratio", "attack", "release"]) {
        if (Number.isFinite(Number(renderer.compressor[key]))) compressor[key].value = Number(renderer.compressor[key]);
      }
      tail.connect(compressor); tail = compressor;
    }
    tail.connect(this.output);
  }
  createEventVoice(entry, playableCount) {
    const renderer = entry.sound.renderer || {};
    const voiceGain = this.context.createGain();
    voiceGain.gain.value = Number(renderer.masterGain || .36) * Number(renderer.outputGain || 2) / Math.sqrt(playableCount);
    this.connectContract(voiceGain, renderer);
    const voice = { gain: voiceGain, baseGain: Number(renderer.masterGain || .36) * Number(renderer.outputGain || 2), oscillators: new Set(), timer: null, cursor: 0 };
    const schedule = () => {
      if (!this.voices.has(entry.id) || !this.awake) return;
      const event = entry.sound.events[voice.cursor % entry.sound.events.length];
      const beat = 60 / Math.max(1, Number(entry.sound.tempo) || 60);
      const beats = Math.max(.125, Number(event.beats) || .5);
      const duration = beat * beats;
      if (!event.rest && Number.isFinite(Number(event.frequency)) && Number(event.frequency) > 0) {
        const oscillator = this.context.createOscillator();
        const envelope = this.context.createGain();
        oscillator.type = event.waveform || (["ground", "antigravity", "foldforge"].includes(event.voice) ? "triangle" : "sine");
        oscillator.frequency.value = Number(event.frequency);
        const minimum = Number(renderer.amplitude?.minimum || .018);
        const maximum = Number(renderer.amplitude?.maximum || 1);
        const peak = Math.max(minimum, Math.min(maximum, Number(event.amplitude) || .05));
        const now = this.context.currentTime;
        envelope.gain.setValueAtTime(.0001, now);
        envelope.gain.exponentialRampToValueAtTime(peak, now + Math.min(Number(renderer.envelope?.attackSeconds || .08), duration * .25));
        envelope.gain.exponentialRampToValueAtTime(.0001, now + Math.max(Number(renderer.envelope?.minimumReleaseSeconds || .2), duration * Number(renderer.envelope?.releaseRatio || .9)));
        oscillator.connect(envelope).connect(voiceGain);
        oscillator.start(now); oscillator.stop(now + duration);
        voice.oscillators.add(oscillator);
        oscillator.addEventListener("ended", () => voice.oscillators.delete(oscillator), { once: true });
      }
      voice.cursor += 1;
      voice.timer = setTimeout(schedule, duration * 1000);
    };
    this.voices.set(entry.id, voice);
    schedule();
  }
  createContinuousVoice(entry, playableCount) {
    const renderer = entry.sound.renderer || {};
    const voiceGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    const seed = stableHash(entry.id);
    const declaredFrequencies = entry.sound.frequenciesHz?.filter((value) => Number.isFinite(value) && value > 0) || [];
    const root = declaredFrequencies[0] || entry.sound.rootHz || 46 + seed % 25;
    filter.type = renderer.fieldFilter?.type || entry.sound.filterType || "lowpass";
    filter.frequency.value = Number(renderer.fieldFilter?.frequency || entry.sound.cutoffHz || 900 + seed % 1400);
    filter.Q.value = Number(renderer.fieldFilter?.Q ?? entry.sound.resonance ?? .7);
    pan.pan.value = 0;
    voiceGain.gain.value = .0001;
    filter.connect(pan).connect(voiceGain);
    this.connectContract(voiceGain, renderer);
    const ratios = declaredFrequencies.length
      ? declaredFrequencies.map((frequency) => frequency / root)
      : [...new Set(entry.sound.ratios || [1])].slice(0, 6);
    const oscillators = [];
    ratios.forEach((ratio, index) => {
      const oscillator = this.context.createOscillator();
      const partial = this.context.createGain();
      const voiceFilter = renderer.voiceFilters?.[index];
      oscillator.type = entry.sound.waves?.[index] || (index ? "triangle" : "sine");
      oscillator.frequency.value = root * ratio;
      oscillator.detune.value = entry.sound.detuneCents?.[index] || 0;
      const partialGain = renderer.partialGains?.[index] ?? (declaredFrequencies.length ? 1 / Math.sqrt(declaredFrequencies.length) : ([1, .22, .08, .03, .035, .02][index] || .02));
      const lfo = renderer.gainLfo;
      partial.gain.value = partialGain * Number(lfo?.base ?? 1);
      let source = oscillator;
      if (voiceFilter) {
        const individualFilter = this.context.createBiquadFilter();
        individualFilter.type = voiceFilter.type || "bandpass";
        individualFilter.frequency.value = Number(voiceFilter.frequency || 900);
        individualFilter.Q.value = Number(voiceFilter.Q || .7);
        oscillator.connect(individualFilter); source = individualFilter;
      }
      source.connect(partial).connect(renderer.bypassFieldFilter ? pan : filter); oscillator.start(); oscillators.push(oscillator);
      if (lfo) {
        const modulation = this.context.createOscillator();
        const depth = this.context.createGain();
        modulation.frequency.value = Number(lfo.angularRate || 1.1) / (Math.PI * 2);
        depth.gain.value = partialGain * Number(lfo.depth || .42);
        modulation.connect(depth).connect(partial.gain); modulation.start(); oscillators.push(modulation);
      }
    });
    voiceGain.gain.exponentialRampToValueAtTime(Number(renderer.masterGain || .24) / Math.sqrt(playableCount), this.context.currentTime + Number(renderer.fadeInSeconds || 2.2));
    this.voices.set(entry.id, { gain: voiceGain, baseGain: Number(renderer.masterGain || .24), oscillators });
  }
  reconcile() {
    if (!this.context || !this.output) return;
    const playable = state.catalog.entries.filter((entry) => state.selected.has(entry.id) && isPlayable(entry));
    for (const [id, voice] of this.voices) if (!playable.some((entry) => entry.id === id)) {
      this.stopVoice(voice);
      this.voices.delete(id);
    }
    playable.forEach((entry) => {
      if (this.voices.has(entry.id)) return;
      const engine = entry.sound.renderer?.engine;
      if (engine === "timed-event-score/v1") this.createTimedVoice(entry, playable.length);
      else if (engine === "sequential-event-score/v1") this.createEventVoice(entry, playable.length);
      else if (engine === "continuous-voice/v1") this.createContinuousVoice(entry, playable.length);
    });
    for (const voice of this.voices.values()) {
      voice.gain.gain.cancelScheduledValues(this.context.currentTime);
      voice.gain.gain.setTargetAtTime(voice.baseGain / Math.sqrt(Math.max(1, playable.length)), this.context.currentTime, .12);
    }
    const level = playable.length ? 1 : .0001;
    this.output.gain.setTargetAtTime(level, this.context.currentTime, .4);
  }

  createTimedVoice(entry, voiceCount) {
    const renderer = entry.sound.renderer || {};
    const gain = this.context.createGain();
    gain.gain.value = Number(renderer.masterGain || .24) / Math.sqrt(Math.max(1, voiceCount));
    this.connectContract(gain, renderer);
    const voice = { gain, baseGain: Number(renderer.masterGain || .24), oscillators: new Set(), timer: 0 };
    this.voices.set(entry.id, voice);
    const scheduleCycle = () => {
      if (this.voices.get(entry.id) !== voice) return;
      const start = this.context.currentTime + .08;
      entry.sound.events.forEach((event, index) => {
        const at = start + Number(event.at || 0);
        const duration = Number(event.duration || .4);
        const oscillator = this.context.createOscillator();
        const filter = this.context.createBiquadFilter();
        const envelope = this.context.createGain();
        const waveformCycle = renderer.waveformCycle || ["sine", "triangle", "sine"];
        oscillator.type = waveformCycle[index % waveformCycle.length];
        oscillator.frequency.value = (entry.sound.rootHz || 55) * Number(event.ratio || 1) * Number(renderer.pitchMultiplier || 2);
        filter.type = renderer.filter?.type || "lowpass";
        filter.frequency.value = Number(renderer.filter?.startHz || 720) + index * Number(renderer.filter?.stepHz || 110);
        envelope.gain.setValueAtTime(.0001, at);
        envelope.gain.exponentialRampToValueAtTime(Number(event.amplitude || .035), at + Math.min(Number(renderer.attackMaxSeconds || .18), duration * Number(renderer.attackDurationRatio || .22)));
        envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
        oscillator.connect(filter).connect(envelope).connect(gain);
        oscillator.start(at);
        oscillator.stop(at + duration + Number(renderer.tailSeconds || .03));
        voice.oscillators.add(oscillator);
        oscillator.addEventListener("ended", () => voice.oscillators.delete(oscillator), { once: true });
      });
      if (renderer.loop !== false) {
        const cycleSeconds = Number(entry.sound.duration_seconds || 0) + Number(renderer.loopGapSeconds ?? .4);
        voice.timer = window.setTimeout(scheduleCycle, Math.max(.1, cycleSeconds) * 1000);
      }
    };
    scheduleCycle();
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
  const fieldDriftX = reducedMotion ? 0 : Math.sin(now * .000055) * Math.min(18, width * .018);
  const fieldDriftY = reducedMotion ? 0 : Math.cos(now * .000047) * Math.min(12, height * .014);
  state.nodes.forEach((node) => {
    const oscillationX = reducedMotion ? 0 : Math.sin(now * .00028 + node.phase) * 7;
    const oscillationY = reducedMotion ? 0 : Math.cos(now * .00021 + node.phase * 1.31) * 5.5;
    node.drawX = node.x + fieldDriftX + oscillationX;
    node.drawY = node.y + fieldDriftY + oscillationY;
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
    const breath = reducedMotion ? 0 : Math.sin(now * .0011 + node.phase) * .45;
    context.beginPath(); context.arc(node.drawX, node.drawY, Math.max(1.6, (hovered ? 8 : selected ? 5 : 2.2) + breath), 0, Math.PI * 2);
    context.fillStyle = selected || hovered ? "#f5f5f2" : node.entry.sound ? "rgba(245,245,242,.52)" : "rgba(245,245,242,.2)"; context.fill();
  });
  context.beginPath(); context.arc(center.x, center.y, 3.5, 0, Math.PI * 2); context.fillStyle = "#f5f5f2"; context.fill();
  const elapsed = Math.floor((now - state.started) / 1000);
  timecode.textContent = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  requestAnimationFrame(draw);
}

function renderOperators() {
  if (!state.catalog || !state.contract) return;
  const workBySound = new Map();
  state.contract.works.filter((work) => work.sound_id).forEach((work) => {
    if (!workBySound.has(work.sound_id)) workBySound.set(work.sound_id, work);
  });
  const playable = state.catalog.entries.filter(isPlayable);
  const entries = playable.filter((entry) => {
    if (entry.id === BASELINE_ID) return false;
    if (state.filter === "works") return entry.collection_id === "root-logos-works";
    if (state.filter === "system") return entry.collection_id !== "root-logos-works";
    return true;
  });
  document.querySelector("#record-count").textContent = String(playable.length).padStart(2, "0");
  document.querySelector("#contract-count").textContent = String(state.contract.counts.works).padStart(2, "0");
  document.querySelector("#paired-count").textContent = String(state.contract.counts.paired).padStart(2, "0");
  document.querySelector("#contract-link").href = state.contract.contract.url;
  document.body.classList.toggle("images-hidden", !state.visuals);
  visualToggle.textContent = state.visuals ? "Images on" : "Images off";
  visualToggle.setAttribute("aria-pressed", String(state.visuals));
  document.querySelectorAll("[data-filter]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter))
  );
  const baselineHeld = state.selected.has(BASELINE_ID);
  baselineToggle.setAttribute("aria-pressed", String(baselineHeld));
  baselineToggle.textContent = baselineHeld ? "Release baseline" : "Hold baseline";

  const activeCards = entries.map((entry, index) => {
    const work = workBySound.get(entry.id);
    const category = entry.collection_id === "root-logos-works" ? "Work voice" : "System voice";
    const media = work
      ? `<figure><img src="${work.image}" alt="" loading="lazy"><figcaption>FLDFRG ${String(work.token_id).padStart(3, "0")}</figcaption></figure>`
      : `<div class="operator-signal" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`;
    return `<li class="operator ${work ? "has-image" : "system-operator"}">
      <button class="operator-select" type="button" data-select="${entry.id}" aria-pressed="${state.selected.has(entry.id)}">
        ${media}
        <span class="operator-meta">
          <small>${String(index + 1).padStart(2, "0")} / ${category}</small>
          <strong>${entry.title}</strong>
          <span>${entry.kind}</span>
          <b>${state.selected.has(entry.id) ? "Held" : "Add"}</b>
        </span>
      </button>
      <a href="${entry.source.url}" target="_blank" rel="noopener" aria-label="Open source for ${entry.title}">↗</a>
    </li>`;
  });
  const pairedExtras = state.filter === "system" ? [] : state.contract.works
    .filter((work) => work.sound_id && workBySound.get(work.sound_id) !== work)
    .map((work, index) => {
      const entry = state.catalog.entries.find((item) => item.id === work.sound_id);
      return `<li class="operator has-image">
        <button class="operator-select" type="button" data-select="${work.sound_id}" aria-pressed="${state.selected.has(work.sound_id)}">
          <figure><img src="${work.image}" alt="" loading="lazy"><figcaption>FLDFRG ${String(work.token_id).padStart(3, "0")}</figcaption></figure>
          <span class="operator-meta">
            <small>${String(activeCards.length + index + 1).padStart(2, "0")} / Shared work voice</small>
            <strong>${work.title}</strong>
            <span>Distinct token body / shared library voice</span>
            <b>${state.selected.has(work.sound_id) ? "Held" : "Add"}</b>
          </span>
        </button>
        <a href="${entry?.source.url || state.contract.contract.url}" target="_blank" rel="noopener" aria-label="Open source for ${work.title}">↗</a>
      </li>`;
    });
  const awaitingCards = state.filter === "system" ? [] : state.contract.works
    .filter((work) => !work.sound_id)
    .map((work, index) => `<li class="operator has-image awaiting-operator" data-kind="Work awaiting voice">
      <div class="operator-select" aria-disabled="true">
        <figure><img src="${work.image}" alt="" loading="lazy"><figcaption>FLDFRG ${String(work.token_id).padStart(3, "0")}</figcaption></figure>
        <span class="operator-meta">
          <small>${String(activeCards.length + pairedExtras.length + index + 1).padStart(2, "0")} / Contract work</small>
          <strong>${work.title}</strong>
          <span>Local image / voice not yet present</span>
          <b>Awaiting sound</b>
        </span>
      </div>
      <a href="${state.contract.contract.url}" target="_blank" rel="noopener" aria-label="Inspect FLDFRG contract">↗</a>
    </li>`);
  operatorGrid.innerHTML = [...activeCards, ...pairedExtras, ...awaitingCards].join("");
  operatorGrid.querySelectorAll("[data-select]").forEach((button) =>
    button.addEventListener("click", () => toggle(button.dataset.select))
  );
}

function toggle(id) {
  const entry = state.catalog.entries.find((item) => item.id === id);
  if (!entry || !isPlayable(entry)) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderOperators(); renderAssembly(); audio?.reconcile();
}

function renderAssembly() {
  const entries = state.catalog.entries.filter(({ id }) => state.selected.has(id));
  assemblyEmpty.hidden = entries.length > 0;
  assemblyList.innerHTML = entries.map((entry, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><span>${entry.title}</span><button type="button" data-remove="${entry.id}">Remove</button></li>`).join("");
  assemblyList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.remove)));
  renderCompatibility(entries);
}

function renderCompatibility(entries) {
  const selectedWorks = entries.filter(({ collection_id }) => collection_id === "root-logos-works");
  layerCount.textContent = `${entries.length} layers / open assembly`;
  if (!selectedWorks.length) {
    compatibilityState.textContent = "Choose one Root Logos work to reveal compatible next layers.";
    compatibilityList.innerHTML = "";
    return;
  }
  const ranked = rankedCandidates(state.catalog.entries, selectedWorks, 5);
  compatibilityState.textContent = "Measured from harmonic fit, tempo relation, breathing room, and register separation. Listening remains decisive.";
  compatibilityList.innerHTML = ranked.map(({ entry, fit }, index) => `<li>
    <span>${String(index + 1).padStart(2, "0")}</span>
    <div><strong>${entry.title}</strong><small>${fit.reason}</small></div>
    <b data-grade="${fit.grade}">${fit.score}</b>
    <button type="button" data-compatible="${entry.id}">Layer</button>
  </li>`).join("");
  compatibilityList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.compatible)));
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
  else { if (!state.selected.size) state.selected.add(BASELINE_ID); await audio.start(); renderOperators(); renderAssembly(); listenButton.textContent = "Silence"; listenButton.setAttribute("aria-pressed", "true"); }
});
clearButton.addEventListener("click", () => { state.selected.clear(); renderOperators(); renderAssembly(); audio?.reconcile(); });
baselineToggle.addEventListener("click", () => toggle(BASELINE_ID));
visualToggle.addEventListener("click", () => { state.visuals = !state.visuals; renderOperators(); });
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  renderOperators();
}));
document.addEventListener("visibilitychange", () => { if (document.hidden && audio?.awake) audio.context?.suspend(); else if (audio?.awake) audio.context?.resume(); });

fetch("archive/sound-archive.json?v=8", { cache: "no-store" })
  .then((response) => { if (!response.ok) throw new Error(`Archive ${response.status}`); return response.json(); })
  .then(async (catalog) => {
    const response = await fetch("archive/fldfrg-works.json?v=1", { cache: "no-store" });
    if (!response.ok) throw new Error("FLDFRG " + response.status);
    return [catalog, await response.json()];
  })
  .then(([catalog, contract]) => {
    state.catalog = catalog;
    state.contract = contract;
    state.layout = null;
    renderOperators();
    renderAssembly();
    requestAnimationFrame(draw);
  })
  .catch((error) => { fieldLabel.textContent = "The archive could not be resolved"; console.error(error); });
