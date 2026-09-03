export const FOLDKERNEL = Object.freeze({
  contractVersion: "FoldKernel-Integration-1.0.0",
  protocolVersion: "FoldKernel-1.0.0",
  packageVersion: "1.0.5",
  event: "permutation_commit",
});

export const CANONICAL_SQUARE = Object.freeze([
  13, 3, 2, 16,
  8, 10, 11, 5,
  12, 6, 7, 9,
  1, 15, 14, 4,
]);

export const SYMMETRIES = Object.freeze([
  "identity", "rotate90", "rotate180", "rotate270",
  "reflectHorizontal", "reflectVertical", "reflectMainDiagonal", "reflectAntiDiagonal",
]);

export function stableHash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function sourceIdentity(entry) {
  return entry.sha256 || [entry.source?.repository, entry.source?.path, entry.id].filter(Boolean).join(":");
}

export function transformCell(row, column, symmetry) {
  switch (symmetry) {
    case "rotate90": return [column, 3 - row];
    case "rotate180": return [3 - row, 3 - column];
    case "rotate270": return [3 - column, row];
    case "reflectHorizontal": return [3 - row, column];
    case "reflectVertical": return [row, 3 - column];
    case "reflectMainDiagonal": return [column, row];
    case "reflectAntiDiagonal": return [3 - column, 3 - row];
    default: return [row, column];
  }
}

function canonicalCell(value) {
  const index = CANONICAL_SQUARE.indexOf(value);
  return [Math.floor(index / 4), index % 4];
}

function adjacent(a, b) {
  const [aRow, aColumn] = canonicalCell(a);
  const [bRow, bColumn] = canonicalCell(b);
  return a !== b && Math.abs(aRow - bRow) <= 1 && Math.abs(aColumn - bColumn) <= 1;
}

export function buildKernelField(entries, width, height) {
  const branches = [...new Set(entries.map(({ branch }) => branch))].sort();
  const centerX = width / 2;
  const centerY = height / 2;
  const span = Math.min(width, height);
  const nodes = entries.map((entry) => {
    const identity = sourceIdentity(entry);
    const branchSeed = stableHash(entry.branch);
    const identitySeed = stableHash(identity);
    const layer = stableHash(`${identity}:layer`) % 4;
    const slot = identitySeed % 16;
    const value = CANONICAL_SQUARE[slot];
    const symmetry = SYMMETRIES[branchSeed % SYMMETRIES.length];
    const [baseRow, baseColumn] = canonicalCell(value);
    const [row, column] = transformCell(baseRow, baseColumn, symmetry);
    const scale = .105 + (branchSeed % 5) * .012 + layer * .01;
    const turn = branchSeed / 0xffffffff * Math.PI * 2;
    const localX = (column - 1.5) * span * scale;
    const localY = (row - 1.5) * span * scale;
    const separation = (identitySeed % 9 - 4) * span * .0025;
    const x = centerX + localX * Math.cos(turn) - localY * Math.sin(turn) + Math.cos(turn) * separation;
    const y = centerY + localX * Math.sin(turn) + localY * Math.cos(turn) + Math.sin(turn) * separation;
    return {
      entry, x, y, nx: x / width, ny: y / height, phase: stableHash(sourceIdentity(entry)) % 628 / 100,
      kernel: { event: FOLDKERNEL.event, value, symmetry, layer },
    };
  });
  const edges = [];
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const sameValue = nodes[a].kernel.value === nodes[b].kernel.value;
      if (adjacent(nodes[a].kernel.value, nodes[b].kernel.value) || sameValue) {
        edges.push({ a, b, kind: sameValue ? "cross-branch" : "adjacency" });
      }
    }
  }
  return { branches, nodes, edges, center: { x: centerX, y: centerY } };
}
