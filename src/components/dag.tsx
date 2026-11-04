"use client";

import { useMemo } from "react";
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TaskView } from "@/lib/client";
import { Dot, StatusBadge, cx } from "./ui";

type TaskNodeData = { task: TaskView; selected: boolean };

function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  const t = data.task;
  const active = ["CLAIMED", "RUNNING", "CHECKPOINTED", "VERIFYING"].includes(t.status);
  return (
    <div
      className={cx(
        "w-[230px] rounded-xl border bg-surface px-3 py-2.5 text-left shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)] transition-colors duration-300",
        active ? "border-violet/60" : t.status === "RECOVERING" ? "border-warn/50" : t.status === "COMPLETED" ? "border-ok/30" : t.status === "FAILED" ? "border-bad/50" : "border-line-strong",
        data.selected && "ring-2 ring-violet/40",
        active && "anim-node-active",
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-white/30" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-dim">{t.capability}</span>
        <span key={t.status} className="anim-flash rounded-md">
          <StatusBadge s={t.status} />
        </span>
      </div>
      <div className="mt-1.5 truncate text-[13px] font-medium text-fg">{t.title}</div>
      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
        <Dot s={t.currentWorker ? "RUNNING" : t.status} />
        <span className="truncate">{t.currentWorker ? `${t.currentWorker} · ${t.currentStep ?? ""}` : t.status === "COMPLETED" ? `done · ${t.attempts} attempt${t.attempts === 1 ? "" : "s"}` : "unassigned"}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-white/30" />
    </div>
  );
}

const nodeTypes = { task: TaskNode };

export function Dag({ tasks, selected, onSelect }: { tasks: TaskView[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const depth = new Map<string, number>();
    const byId = new Map(tasks.map((t) => [t.taskId, t]));
    const d = (id: string, seen = new Set<string>()): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const deps = byId.get(id)?.dependencies ?? [];
      const v = deps.length ? Math.max(...deps.map((x) => d(x, seen))) + 1 : 0;
      depth.set(id, v);
      return v;
    };
    tasks.forEach((t) => d(t.taskId));
    const perLevel = new Map<number, number>();
    const nodes: Node<TaskNodeData>[] = tasks.map((t) => {
      const lv = depth.get(t.taskId) ?? 0;
      const idx = perLevel.get(lv) ?? 0;
      perLevel.set(lv, idx + 1);
      return { id: t.taskId, type: "task", position: { x: lv * 280, y: idx * 120 }, data: { task: t, selected: selected === t.taskId } };
    });
    const edges: Edge[] = tasks.flatMap((t) =>
      t.dependencies.map((dep) => {
        const live = ["CLAIMED", "RUNNING", "CHECKPOINTED", "VERIFYING", "RECOVERING"].includes(t.status);
        return {
          id: `${dep}->${t.taskId}`,
          source: dep,
          target: t.taskId,
          animated: live,
          style: { stroke: live ? "#8b5cf6" : byId.get(dep)?.status === "COMPLETED" ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.18)", strokeWidth: 1.5 },
        };
      }),
    );
    return { nodes, edges };
  }, [tasks, selected]);

  return (
    <div className="h-[300px] w-full sm:h-[320px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => onSelect?.(n.id)}
        colorMode="dark"
        style={{ background: "transparent" }}
        minZoom={0.4}
        maxZoom={1.4}
      >
        <Background color="rgba(255,255,255,0.05)" gap={22} />
      </ReactFlow>
    </div>
  );
}
