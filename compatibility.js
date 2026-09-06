export const MAX_LAYERS = 3;

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const soundingEvents = (entry) => (entry.sound?.events || []).filter((event) => !event.rest && Number(event.frequency) > 0);
const density = (entry) => {
  const events = entry.sound?.events || [];
  return events.length ? soundingEvents(entry).length / events.length : 1;
};
const median = (values) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
};

function tempoFit(left, right) {
  const ratio = Number(left.sound?.tempo || 60) / Number(right.sound?.tempo || 60);
  const relations = [1, 2, .5, 1.5, 2 / 3, 4 / 3, .75];
  const distance = Math.min(...relations.map((relation) => Math.abs(Math.log2(ratio / relation)) * 12));
  return clamp(1 - distance / 3);
}

function harmonicFit(left, right) {
  const a = soundingEvents(left); const b = soundingEvents(right);
  if (!a.length || !b.length) return 0;
  const consonances = [0, 300, 400, 500, 700, 800, 900, 1200];
  const steps = Math.min(48, Math.max(a.length, b.length));
  let total = 0;
  for (let index = 0; index < steps; index += 1) {
    const leftFrequency = Number(a[Math.floor(index * a.length / steps)].frequency);
    const rightFrequency = Number(b[Math.floor(index * b.length / steps)].frequency);
    const cents = Math.abs(1200 * Math.log2(leftFrequency / rightFrequency)) % 1200;
    const distance = Math.min(...consonances.map((interval) => Math.abs(cents - interval)));
    total += clamp(1 - distance / 170);
  }
  return total / steps;
}

function rhythmicSpace(left, right) {
  const leftDensity = density(left); const rightDensity = density(right);
  const overlap = leftDensity * rightDensity;
  return clamp(1 - Math.max(0, overlap - .62) / .38);
}

function registerSpace(left, right) {
  const leftMedian = median(soundingEvents(left).map(({ frequency }) => Number(frequency)));
  const rightMedian = median(soundingEvents(right).map(({ frequency }) => Number(frequency)));
  if (!leftMedian || !rightMedian) return 0;
  const separation = Math.abs(Math.log2(leftMedian / rightMedian)) * 12;
  return clamp(.45 + separation / 12, .45, 1);
}

export function compatibility(left, right) {
  const measures = {
    harmony: harmonicFit(left, right),
    tempo: tempoFit(left, right),
    breathingRoom: rhythmicSpace(left, right),
    register: registerSpace(left, right),
  };
  const score = Math.round(100 * (
    measures.harmony * .48 + measures.tempo * .24 + measures.breathingRoom * .18 + measures.register * .10
  ));
  const strongest = Object.entries(measures).sort((a, b) => b[1] - a[1])[0][0];
  const weakest = Object.entries(measures).sort((a, b) => a[1] - b[1])[0][0];
  return {
    score,
    grade: score >= 78 ? "strong" : score >= 62 ? "open" : "tension",
    reason: `${strongest.replace(/([A-Z])/g, " $1").toLowerCase()} supports the pairing; ${weakest.replace(/([A-Z])/g, " $1").toLowerCase()} carries its pressure`,
    measures,
  };
}

export function compatibilityWithSelection(candidate, selected) {
  const pairs = selected.filter(({ id }) => id !== candidate.id).map((entry) => compatibility(candidate, entry));
  if (!pairs.length) return { score: 100, grade: "anchor", reason: "Available as the first compositional anchor", measures: {} };
  const score = Math.round(pairs.reduce((sum, pair) => sum + pair.score, 0) / pairs.length);
  const weakest = [...pairs].sort((a, b) => a.score - b.score)[0];
  return { score, grade: score >= 78 ? "strong" : score >= 62 ? "open" : "tension", reason: weakest.reason, measures: weakest.measures };
}

export function rankedCandidates(entries, selected, limit = 5) {
  const selectedIds = new Set(selected.map(({ id }) => id));
  return entries
    .filter((entry) => entry.collection_id === "root-logos-works" && !selectedIds.has(entry.id))
    .map((entry) => ({ entry, fit: compatibilityWithSelection(entry, selected) }))
    .sort((a, b) => b.fit.score - a.fit.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit);
}
