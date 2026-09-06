import { buildKernelField, FOLDKERNEL, stableHash } from "./record-kernel.js?v=3";
import { compatibilityWithSelection, MAX_LAYERS, rankedCandidates } from "./compatibility.js?v=1";

const canvas = document.querySelector("#field");
const context = canvas.getContext("2d");
const listenButton = document.querySelector("#listen");
const clearButton = document.querySelector("#clear");
const archiveList = document.querySelector("#archive-list");
const assemblyList = document.querySelector("#assembly-list");
const assemblyEmpty = document.querySelector("#assembly-empty");
const compatibilityList = document.querySelector("#compatibility-list");
const compatibilityState = document.querySelector("#compatibility-state");
const layerCount = document.querySelector("#layer-count");
const fieldLabel = document.querySelector("#field-label");
const kernelLabel = document.querySelector("#kernel-label");
const timecode = document.querySelector("#timecode");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = { catalog: null, nodes: [], edges: [], layout: null, selected: new Set(), hover: -1, pointer: { x: 0, y: 0 }, started: performance.now() };
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
  if (!entry || !isPlayable(entry)) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else if (state.selected.size >= MAX_LAYERS) {
    compatibilityState.textContent = `The assembly is held at ${MAX_LAYERS} layers. Remove one voice before adding another.`;
    return;
  } else state.selected.add(id);
  renderArchive(); renderAssembly(); audio?.reconcile();
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
  layerCount.textContent = `${entries.length} / ${MAX_LAYERS} layers`;
  if (!selectedWorks.length) {
    compatibilityState.textContent = "Choose one Root Logos work to reveal compatible next layers.";
    compatibilityList.innerHTML = "";
    return;
  }
  const ranked = rankedCandidates(state.catalog.entries, selectedWorks, 5);
  compatibilityState.textContent = entries.length >= MAX_LAYERS
    ? "Layer ceiling reached. The relations below remain visible as alternate decisions."
    : "Measured from harmonic fit, tempo relation, breathing room, and register separation. Listening remains decisive.";
  compatibilityList.innerHTML = ranked.map(({ entry, fit }, index) => `<li>
    <span>${String(index + 1).padStart(2, "0")}</span>
    <div><strong>${entry.title}</strong><small>${fit.reason}</small></div>
    <b data-grade="${fit.grade}">${fit.score}</b>
    <button type="button" data-compatible="${entry.id}" ${entries.length >= MAX_LAYERS ? "disabled" : ""}>Layer</button>
  </li>`).join("");
  compatibilityList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.compatible)));
}

function renderArchive() {
  document.querySelector("#record-count").textContent = String(state.catalog.entries.length).padStart(2, "0");
  document.querySelector("#collection-count").textContent = String(state.catalog.collections?.length || 1).padStart(2, "0");
  const collections = state.catalog.collections?.length ? state.catalog.collections : [{ id: "archive", title: "Sound Archive", type: "sound-structures" }];
  let recordIndex = 0;
  archiveList.innerHTML = collections.map((collection) => {
    const entries = state.catalog.entries.filter((entry) => (entry.collection_id || "archive") === collection.id);
    if (!entries.length) return "";
    const selectedWorks = state.catalog.entries.filter((item) => state.selected.has(item.id) && item.collection_id === "root-logos-works");
    return `<section class="record-collection" data-collection="${collection.id}">
      <header><div><p class="eyebrow">${collection.type.replaceAll("-", " ")}</p><h3>${collection.title}</h3></div><p>${String(entries.length).padStart(2, "0")} sounds</p></header>
      <div>${entries.map((entry) => { const index = recordIndex++; return `<article class="record">
    <p class="record-index">${String(index + 1).padStart(2, "0")}</p>
    <div class="record-title"><h4>${entry.title}</h4>${entry.question?.text ? `<p class="record-question">${entry.question.text}</p>` : ""}</div>
    <p class="record-kind">${entry.kind}</p>
    <p class="record-state">${entry.availability}${entry.collection_id === "root-logos-works" && selectedWorks.length && !state.selected.has(entry.id) ? `<span class="compatibility-mark" data-grade="${compatibilityWithSelection(entry, selectedWorks).grade}">${compatibilityWithSelection(entry, selectedWorks).score} fit</span>` : ""}</p>
    <div class="record-actions">
      ${isPlayable(entry) ? `<button type="button" data-select="${entry.id}" aria-pressed="${state.selected.has(entry.id)}">${state.selected.has(entry.id) ? "Held" : "Add"}</button>` : ""}
      <a href="${entry.source.url}" target="_blank" rel="noopener">Source</a>
    </div>
  </article>`; }).join("")}</div></section>`;
  }).join("");
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
  else { if (!state.selected.size) state.catalog.entries.filter(isPlayable).slice(0, 2).forEach(({ id }) => state.selected.add(id)); await audio.start(); renderArchive(); renderAssembly(); listenButton.textContent = "Silence"; listenButton.setAttribute("aria-pressed", "true"); }
});
clearButton.addEventListener("click", () => { state.selected.clear(); renderArchive(); renderAssembly(); audio?.reconcile(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && audio?.awake) audio.context?.suspend(); else if (audio?.awake) audio.context?.resume(); });

fetch("archive/sound-archive.json?v=7", { cache: "no-store" })
  .then((response) => { if (!response.ok) throw new Error(`Archive ${response.status}`); return response.json(); })
  .then((catalog) => { state.catalog = catalog; state.layout = null; renderArchive(); renderAssembly(); requestAnimationFrame(draw); })
  .catch((error) => { fieldLabel.textContent = "The archive could not be resolved"; console.error(error); });
