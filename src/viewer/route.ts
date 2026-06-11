/**
 * Route finder: the shortest path ALONG the centreline between two stations —
 * the "how far through the cave" distance, as opposed to the measure tool's
 * straight-line readout. Pure logic (no Three.js, no DOM) so it is
 * unit-testable: single-source Dijkstra with predecessor tracking over the
 * non-splay leg graph, early-exiting at the target.
 *
 * Stations at identical coordinates are treated as one graph node: Therion
 * .lox writes an equated station once per survey (different ids and names,
 * same point, no joining shot), so without this the centreline graph
 * fragments at every survey boundary — Migovec splits into ~600 pieces.
 */
import type { CaveModel } from "../parser/index";

export interface Route {
  /** Station ids along the route, start to end inclusive. */
  stations: number[];
  /** Total length (m) along the route's legs (true, unexaggerated metres). */
  lengthM: number;
}

/** Shortest centreline route between two stations, or null if unreachable. */
export function findRoute(model: CaveModel, from: number, to: number): Route | null {
  const n = model.stations.length;
  if (from < 0 || from >= n || to < 0 || to >= n) return null;

  // Canonicalize coordinate-coincident stations to one node (0.1 mm key).
  const canon = new Map<string, number>();
  const node = new Int32Array(n);
  for (const s of model.stations) {
    const key = `${s.x.toFixed(4)},${s.y.toFixed(4)},${s.z.toFixed(4)}`;
    const existing = canon.get(key);
    if (existing === undefined) {
      canon.set(key, s.id);
      node[s.id] = s.id;
    } else {
      node[s.id] = existing;
    }
  }
  const src = node[from];
  const dst = node[to];
  if (src === dst) return { stations: [from], lengthM: 0 };

  // Adjacency over non-splay legs (splays are wall shots, not passage).
  const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: n }, () => []);
  for (const leg of model.legs) {
    if (leg.flags.splay) continue;
    const a = model.stations[leg.from];
    const b = model.stations[leg.to];
    const w = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    adj[node[leg.from]].push({ to: node[leg.to], w });
    adj[node[leg.to]].push({ to: node[leg.from], w });
  }

  const distance = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  distance[src] = 0;
  const heap = new MinHeap();
  heap.push(src, 0);

  while (heap.size > 0) {
    const { id, dist } = heap.pop();
    if (dist > distance[id]) continue; // stale entry
    if (id === dst) break; // target settled — its shortest distance is final
    for (const edge of adj[id]) {
      const nd = dist + edge.w;
      if (nd < distance[edge.to]) {
        distance[edge.to] = nd;
        prev[edge.to] = id;
        heap.push(edge.to, nd);
      }
    }
  }

  if (!Number.isFinite(distance[dst])) return null;
  const stations: number[] = [];
  for (let id = dst; id !== -1; id = prev[id]) stations.push(id);
  stations.reverse();
  return { stations, lengthM: distance[dst] };
}

/**
 * A small binary min-heap keyed by distance. (Deliberately mirrors the private
 * heap in coloring.ts rather than sharing it — keeps both modules self-contained.)
 */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): { id: number; dist: number } {
    const id = this.ids[0];
    const dist = this.keys[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      this.siftDown(0);
    }
    return { id, dist };
  }

  private siftDown(i: number): void {
    const n = this.ids.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let m = i;
      if (l < n && this.keys[l] < this.keys[m]) m = l;
      if (r < n && this.keys[r] < this.keys[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
