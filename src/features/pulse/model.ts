import type {
	CycleTransferStats,
	MetricDataPoint,
	NezhaMonitor,
	NezhaServer,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";

export const COLORS = [
	"var(--orb-blue)",
	"var(--orb-violet)",
	"var(--orb-green)",
	"var(--orb-amber)",
	"var(--orb-red)",
];
export type Probe = { key: string; id: number; name: string; color: string };
export type Range = 1 | 6 | 24;
export type PlotPoint = { ts: number; [key: string]: number | null };

export function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}
export function percent(used: unknown, total: unknown) {
	const u = number(used),
		t = number(total);
	return u !== null && t !== null && t > 0 ? (u / t) * 100 : null;
}
export function bytes(value: unknown, speed = false) {
	const v = number(value);
	if (v === null) return "—";
	const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
	const index =
		v === 0
			? 0
			: Math.max(0, Math.min(5, Math.floor(Math.log(v) / Math.log(1024))));
	return `${(v / 1024 ** index).toFixed(index > 0 ? 2 : 0)} ${units[index]}${speed ? "/s" : ""}`;
}
export function fixed(value: unknown, digits = 1) {
	const v = number(value);
	return v === null ? "—" : v.toFixed(digits);
}
export function duration(value: unknown) {
	const v = number(value);
	if (v === null) return "—";
	return v >= 86400
		? `${Math.floor(v / 86400)} 天 ${Math.floor((v % 86400) / 3600)} 时`
		: `${Math.floor(v / 3600)} 时 ${Math.floor((v % 3600) / 60)} 分`;
}
export function timestamp(value: unknown) {
	return typeof value === "string" && !value.startsWith("000")
		? Date.parse(value)
		: Number.NaN;
}
export function isOnline(server: NezhaServer, now: number) {
	const age = now - timestamp(server.last_active);
	return Number.isFinite(age) && age >= -30_000 && age <= 30_000;
}
export function countryCode(server: NezhaServer) {
	return /^[a-z]{2}$/i.test(server.country_code ?? "")
		? server.country_code.toUpperCase()
		: "";
}
export function countryName(code: string) {
	return (
		new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code || "ZZ") ??
		code
	);
}
export function flag(code: string) {
	return /^[A-Z]{2}$/.test(code)
		? String.fromCodePoint(...[...code].map((c) => c.charCodeAt(0) + 127397))
		: "◌";
}
export function cyclesFor(stats: CycleTransferStats | undefined, id: number) {
	const key = String(id);
	return Object.entries(stats ?? {}).flatMap(([cycleId, c]) => {
		if (!(key in (c.server_name ?? {}))) return [];
		const max = number(
			typeof c.max === "object" && c.max !== null ? c.max[key] : c.max,
		);
		const used = number(c.transfer?.[key]);
		const from =
			typeof c.from === "object" && c.from !== null ? c.from[key] : c.from;
		const to = typeof c.to === "object" && c.to !== null ? c.to[key] : c.to;
		return [
			{
				key: cycleId,
				name: c.name,
				max,
				used,
				from,
				to,
				reset: c.next_update?.[key],
			},
		];
	});
}
function sum(values: (number | null)[]) {
	return values.length && values.every((v) => v !== null)
		? values.reduce<number>((a, b) => a + (b ?? 0), 0)
		: null;
}
export function primaryCycleFor(
	stats: CycleTransferStats | undefined,
	id: number,
	preferredId?: string,
) {
	const cycles = cyclesFor(stats, id);
	return cycles.find((cycle) => cycle.key === preferredId) ?? cycles[0];
}
export function totals(
	data: NezhaWebsocketResponse,
	stats?: CycleTransferStats,
	primaryIds: Readonly<Record<string, string>> = {},
) {
	const online = data.servers.filter((s) => isOnline(s, data.now));
	const cpu = online.map((s) => number(s.state?.cpu));
	const cycle = data.servers.flatMap((s) => {
		const primary = primaryCycleFor(stats, s.id, primaryIds[s.id]);
		return primary ? [primary] : [];
	});
	return {
		online: online.length,
		down: sum(online.map((s) => number(s.state?.net_in_speed))),
		up: sum(online.map((s) => number(s.state?.net_out_speed))),
		transfer: sum(
			data.servers.map((s) =>
				sum([
					number(s.state?.net_in_transfer),
					number(s.state?.net_out_transfer),
				]),
			),
		),
		cpu:
			cpu.length && cpu.every((v) => v !== null)
				? (sum(cpu) as number) / cpu.length
				: null,
		memory: sum(online.map((s) => number(s.state?.mem_used))),
		memoryTotal: sum(online.map((s) => number(s.host?.mem_total))),
		disk: sum(online.map((s) => number(s.state?.disk_used))),
		diskTotal: sum(online.map((s) => number(s.host?.disk_total))),
		cycleUsed: sum(cycle.map((c) => c.used)),
		cycleMax: sum(cycle.map((c) => c.max)),
		cycleCount: cycle.length,
	};
}

/** Join by exact server timestamps; retain gaps and zero, latest duplicate wins. */
export function joinMetrics(
	series: MetricDataPoint[][],
	transforms: ((n: number) => number | null)[],
) {
	const rows = new Map<number, PlotPoint>();
	series.forEach((samples, i) => {
		for (const sample of samples) {
			if (!Number.isFinite(sample.ts)) continue;
			const row = rows.get(sample.ts) ?? { ts: sample.ts };
			const value = number(sample.value);
			row[`v${i}`] = value === null ? null : transforms[i](value);
			rows.set(sample.ts, row);
		}
	});
	return [...rows.values()].sort((a, b) => a.ts - b.ts);
}
export function inRange(points: PlotPoint[], range: Range, now: number) {
	return points.filter((p) => p.ts >= now - range * 3600000 && p.ts <= now);
}
export function monitorSeries(
	monitors: NezhaMonitor[],
	preferredIds: readonly number[] = [],
) {
	const rows = new Map<number, PlotPoint>();
	const probes = monitors.map((m, index) => {
		const key = `v${index}`;
		m.created_at.forEach((ts, i) => {
			const time = ts < 1e12 ? ts * 1000 : ts;
			if (!Number.isFinite(time)) return;
			const row = rows.get(time) ?? { ts: time };
			row[key] = m.packet_loss?.[i] === 100 ? null : number(m.avg_delay[i]);
			row[`${key}loss`] = number(m.packet_loss?.[i]);
			rows.set(time, row);
		});
		const preferred = preferredIds.indexOf(m.monitor_id);
		const carrier = ["电信", "联通", "移动"].findIndex((name) =>
			m.monitor_name.includes(name),
		);
		return {
			key,
			id: m.monitor_id,
			name: m.monitor_name,
			color:
				COLORS[
					(preferred >= 0 ? preferred : carrier >= 0 ? carrier : index) %
						COLORS.length
				],
		};
	});
	return { probes, points: [...rows.values()].sort((a, b) => a.ts - b.ts) };
}

/** Explicit IDs win. Recognize exact Zhejiang task names without relabeling others. */
export function cardProbes(probes: Probe[], preferredIds: readonly number[]) {
	if (preferredIds.length)
		return preferredIds.flatMap((id) =>
			probes.filter((probe) => probe.id === id),
		);
	const zhejiang = ["浙江电信", "浙江联通", "浙江移动"].flatMap((name) =>
		probes.filter((probe) => probe.name === name),
	);
	return zhejiang.length ? zhejiang : probes.slice(0, 3);
}
export function probeStats(points: PlotPoint[], key: string) {
	const delays = points
		.map((p) => p[key])
		.filter((v): v is number => v != null);
	const losses = points
		.map((p) => p[`${key}loss`])
		.filter((v): v is number => v != null);
	return {
		current: number(points.filter((p) => key in p).slice(-1)[0]?.[key]),
		average: delays.length
			? delays.reduce((a, b) => a + b, 0) / delays.length
			: null,
		jitter: delays.length ? Math.max(...delays) - Math.min(...delays) : null,
		loss: losses.length
			? losses.reduce((a, b) => a + b, 0) / losses.length
			: null,
	};
}
export function peakLimit(points: PlotPoint[], keys: string[]) {
	const values = points
		.flatMap((p) => keys.map((k) => p[k]).filter((v): v is number => v != null))
		.sort((a, b) => a - b);
	return values.length
		? Math.max(1, values[Math.floor((values.length - 1) * 0.95)] * 1.25)
		: 1;
}
