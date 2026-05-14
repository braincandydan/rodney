import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { MemoryGraphNode } from "../api";
import { getMemoryGraphData } from "../api";

type SimNode = MemoryGraphNode & d3.SimulationNodeDatum;

const CAT: Record<string, { color: string; label: string; cx: number; cy: number }> = {
  core:         { color: "#a78bfa", label: "Core",         cx: 0.50, cy: 0.50 },
  episodic:     { color: "#60a5fa", label: "Episodic",     cx: 0.22, cy: 0.28 },
  semantic:     { color: "#34d399", label: "Semantic",     cx: 0.78, cy: 0.28 },
  procedural:   { color: "#f97316", label: "Procedural",   cx: 0.75, cy: 0.75 },
  relationship: { color: "#f472b6", label: "Relationship", cx: 0.25, cy: 0.75 },
  project:      { color: "#fbbf24", label: "Project",      cx: 0.50, cy: 0.12 },
};

const nodeR = (d: MemoryGraphNode) => 4 + d.importance * 2;

export function NeuralMindMap() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg: SVGSVGElement = svgRef.current;

    let dead = false;
    let fullTimer: number;
    let pollTimer: number;
    let sim: d3.Simulation<SimNode, undefined> | null = null;
    let currentNodes: SimNode[] = [];

    function getSize(): [number, number] {
      const r = svg.getBoundingClientRect();
      return [r.width || 700, r.height || 420];
    }

    function updateActive(ids: number[]) {
      if (dead) return;
      const active = new Set(ids);
      d3.select(svg)
        .selectAll<SVGGElement, SimNode>(".rn")
        .classed("rn-active", d => active.has(d.id))
        .select<SVGCircleElement>(".pulse")
        .attr("stroke", d => CAT[d.category]?.color ?? "#fff");
    }

    function build(nodes: SimNode[], w: number, h: number) {
      if (dead) return;
      sim?.stop();

      const root = d3.select(svg);
      root.selectAll("*").remove();

      // glow filter for pinned nodes
      const defs = root.append("defs");
      const filt = defs.append("filter")
        .attr("id", "nglow")
        .attr("x", "-50%").attr("y", "-50%")
        .attr("width", "200%").attr("height", "200%");
      filt.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
      const fm = filt.append("feMerge");
      fm.append("feMergeNode").attr("in", "blur");
      fm.append("feMergeNode").attr("in", "SourceGraphic");

      // faint region halos per category
      const rg = root.append("g").attr("class", "regions");
      for (const cat of Object.values(CAT)) {
        rg.append("circle")
          .attr("cx", cat.cx * w).attr("cy", cat.cy * h).attr("r", 58)
          .attr("fill", cat.color).attr("opacity", 0.05)
          .attr("stroke", cat.color).attr("stroke-width", 1).attr("stroke-opacity", 0.13);
      }

      // node groups
      const nodeLayer = root.append("g").attr("class", "nodes-layer");
      const groups = nodeLayer
        .selectAll<SVGGElement, SimNode>(".rn")
        .data(nodes, d => String(d.id))
        .join("g")
        .attr("class", "rn");

      // pulse ring (animated when active)
      groups.append("circle")
        .attr("class", "pulse")
        .attr("r", d => nodeR(d))
        .attr("fill", "none")
        .attr("stroke-width", 2);

      // main node body
      groups.append("circle")
        .attr("class", "body")
        .attr("r", d => nodeR(d))
        .attr("fill", d => CAT[d.category]?.color ?? "#888")
        .attr("opacity", d => 0.45 + d.confidence * 0.55)
        .attr("stroke", d => d.pinned ? "#fbbf24" : "none")
        .attr("stroke-width", d => d.pinned ? 2.5 : 0)
        .attr("filter", d => d.pinned ? "url(#nglow)" : null);

      // tooltip
      groups.append("title").text(d => {
        const imp = "●".repeat(Math.max(0, d.importance)) + "○".repeat(Math.max(0, 5 - d.importance));
        return `${d.snippet}\n${d.category} · ${imp} · ×${d.accessCount}`;
      });

      // legend bottom-left
      const legH = Object.keys(CAT).length * 17 + 6;
      const leg = root.append("g").attr("transform", `translate(10,${h - legH})`);
      Object.values(CAT).forEach((cat, i) => {
        const row = leg.append("g").attr("transform", `translate(0,${i * 17})`);
        row.append("circle").attr("cx", 6).attr("cy", 6).attr("r", 5)
          .attr("fill", cat.color).attr("opacity", 0.8);
        row.append("text").attr("x", 16).attr("y", 10)
          .attr("fill", "#6b7280").attr("font-size", "11px")
          .text(cat.label);
      });

      // cluster force — pulls nodes toward their category centroid
      const clusterForce: d3.Force<SimNode, undefined> = (alpha: number) => {
        for (const n of nodes) {
          const c = CAT[n.category];
          if (!c) continue;
          n.vx = (n.vx ?? 0) - (n.x! - c.cx * w) * 0.04 * alpha;
          n.vy = (n.vy ?? 0) - (n.y! - c.cy * h) * 0.04 * alpha;
        }
      };

      sim = d3.forceSimulation<SimNode>(nodes)
        .force("charge", d3.forceManyBody<SimNode>().strength(-22))
        .force("center", d3.forceCenter<SimNode>(w / 2, h / 2).strength(0.02))
        .force("collide", d3.forceCollide<SimNode>(d => nodeR(d) + 2.5))
        .force("cluster", clusterForce)
        .alphaDecay(0.018)
        .velocityDecay(0.35)
        .on("tick", () => {
          groups.attr("transform", d =>
            `translate(${Math.max(14, Math.min(w - 14, d.x ?? w / 2))},${Math.max(14, Math.min(h - 14, d.y ?? h / 2))})`
          );
        });

      currentNodes = nodes;
    }

    async function loadAll() {
      if (dead) return;
      try {
        const data = await getMemoryGraphData();
        if (dead) return;
        const [w, h] = getSize();
        const prev = new Map(currentNodes.map(n => [n.id, n]));
        const nodes: SimNode[] = data.nodes.map(n => {
          const p = prev.get(n.id);
          return { ...n, x: p?.x, y: p?.y, vx: 0, vy: 0 };
        });
        build(nodes, w, h);
        updateActive(data.recentIds);
      } catch {
        // db not available yet — silent
      }
    }

    async function pollActive() {
      if (dead) return;
      try {
        const data = await getMemoryGraphData();
        if (!dead) updateActive(data.recentIds);
      } catch {
        // silent
      }
    }

    loadAll();
    fullTimer = window.setInterval(loadAll, 30_000);
    pollTimer = window.setInterval(pollActive, 3_000);

    return () => {
      dead = true;
      window.clearInterval(fullTimer);
      window.clearInterval(pollTimer);
      sim?.stop();
    };
  }, []);

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, color: "var(--text)", fontSize: "0.95rem", fontWeight: 600 }}>Mind Map</h3>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>neurons pulse when recalled · updates every 3s</span>
      </div>
      <div style={{
        background: "#06090f",
        borderRadius: "10px",
        border: "1px solid var(--border)",
        overflow: "hidden",
        height: "420px",
      }}>
        <svg ref={svgRef} width="100%" height="100%" />
      </div>
    </div>
  );
}
