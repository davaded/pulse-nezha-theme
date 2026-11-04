import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMetricHistory } from "@/hooks/use-metric-history";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { useRuntimeConfig } from "@/lib/runtime-config";
import type {
	MetricType,
	NezhaServer,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";
import { usePulseMonitor } from "./data";
import {
	fixed,
	inRange,
	isOnline,
	joinMetrics,
	monitorSeries,
	number,
	type PlotPoint,
	peakLimit,
	percent,
	probeStats,
	type Range,
} from "./model";

type Series = { key: string; name: string; color: string };
const METRICS: MetricType[] = [
	"cpu",
	"memory",
	"disk",
	"net_in_speed",
	"net_out_speed",
];
const RESOURCE: Series[] = [
	{ key: "v0", name: "CPU", color: "#42a9dc" },
	{ key: "v1", name: "内存", color: "#d879ae" },
	{ key: "v2", name: "磁盘", color: "#a29ad9" },
];
const NETWORK: Series[] = [
	{ key: "v3", name: "下行", color: "#43b9b7" },
	{ key: "v4", name: "上行", color: "#df8194" },
];

export function RangePicker({
	value,
	onChange,
}: {
	value: Range;
	onChange: (range: Range) => void;
}) {
	return (
		<fieldset className="lot-ranges" aria-label="图表时间范围">
			{([1, 6, 24] as Range[]).map((r) => (
				<button
					type="button"
					key={r}
					aria-pressed={value === r}
					onClick={() => onChange(r)}
				>
					{r}h
				</button>
			))}
		</fieldset>
	);
}
export function Plot({
	points,
	series,
	range,
	now,
	unit,
	loss = false,
	peak = false,
	session = false,
}: {
	points: PlotPoint[];
	series: Series[];
	range: Range;
	now: number;
	unit: string;
	loss?: boolean;
	peak?: boolean;
	session?: boolean;
}) {
	const hasValues = points.some((p) =>
		series.some((s) => p[s.key] != null || (loss && p[`${s.key}loss`] != null)),
	);
	if (!series.length || !hasValues)
		return (
			<div className="lot-chartempty">
				{series.length ? "所选时段暂无采样数据" : "点击上方图例显示曲线"}
			</div>
		);
	return (
		<div
			className="pulse-plot"
			role="img"
			aria-label={`${series.map((s) => s.name).join("、")}趋势图，${session ? "本次访问实时采样" : `最近 ${range} 小时`}`}
		>
			<ResponsiveContainer
				width="100%"
				height="100%"
				minWidth={0}
				initialDimension={{ width: 800, height: 240 }}
			>
				<ComposedChart
					data={points}
					margin={{ top: 12, right: loss ? 8 : 12, bottom: 2, left: 0 }}
					accessibilityLayer
				>
					<CartesianGrid
						stroke="var(--lot-line)"
						strokeDasharray="3 4"
						vertical={false}
					/>
					<XAxis
						dataKey="ts"
						type="number"
						domain={[
							session
								? Math.max(
										now - range * 3600000,
										Math.min(points[0]?.ts ?? now, now - 60000),
									)
								: now - range * 3600000,
							now,
						]}
						tickFormatter={(t) =>
							new Date(t).toLocaleTimeString("zh-CN", {
								hour: "2-digit",
								minute: "2-digit",
								second: session ? "2-digit" : undefined,
								hour12: false,
							})
						}
						tickLine={false}
						axisLine={false}
						minTickGap={42}
						tick={{ fontSize: 11, fill: "var(--lot-faint)" }}
					/>
					<YAxis
						yAxisId="value"
						width={52}
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 11, fill: "var(--lot-faint)" }}
						domain={[
							0,
							peak
								? peakLimit(
										points,
										series.map((s) => s.key),
									)
								: "auto",
						]}
						allowDataOverflow={peak}
						tickFormatter={(n) =>
							`${Number(n.toFixed(1))}${unit === " MiB/s" ? "" : unit}`
						}
					/>
					{loss && (
						<YAxis
							yAxisId="loss"
							orientation="right"
							width={38}
							tickLine={false}
							axisLine={false}
							domain={[0, 100]}
							tick={{ fontSize: 11, fill: "var(--lot-faint)" }}
							tickFormatter={(n) => `${n}%`}
						/>
					)}
					<Tooltip
						isAnimationActive={false}
						labelFormatter={(v) =>
							new Date(Number(v)).toLocaleString("zh-CN", { hour12: false })
						}
						formatter={(value, name) => [
							`${fixed(Number(value), 1)}${String(name).endsWith("丢包") ? "%" : unit}`,
							name,
						]}
						contentStyle={{
							border: "1px solid var(--lot-line)",
							borderRadius: 9,
							background: "var(--lot-surface)",
							fontSize: 12,
							color: "var(--lot-fg)",
						}}
					/>
					{loss &&
						series.map((s) => (
							<Area
								key={`${s.key}loss`}
								yAxisId="loss"
								dataKey={`${s.key}loss`}
								name={`${s.name}丢包`}
								stroke="none"
								fill={s.color}
								fillOpacity={0.13}
								type="linear"
								isAnimationActive={false}
								connectNulls={false}
							/>
						))}
					{series.map((s) => (
						<Line
							key={s.key}
							yAxisId="value"
							dataKey={s.key}
							name={s.name}
							stroke={s.color}
							strokeWidth={1.5}
							type="linear"
							dot={points.length === 1 ? { r: 2 } : false}
							activeDot={{ r: 3, strokeWidth: 0 }}
							isAnimationActive={false}
							connectNulls={false}
						/>
					))}
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}

export function realtimePoints(
	history: NezhaWebsocketResponse[],
	server: NezhaServer,
) {
	return joinMetrics(
		METRICS.map((_, i) =>
			history.flatMap((snapshot) => {
				const s = snapshot.servers.find((s) => s.id === server.id);
				if (!s || !isOnline(s, snapshot.now)) return [];
				const values = [
					s.state?.cpu,
					s.state?.mem_used,
					s.state?.disk_used,
					s.state?.net_in_speed,
					s.state?.net_out_speed,
				];
				const value = number(values[i]);
				return value === null ? [] : [{ ts: snapshot.now, value }];
			}),
		),
		[
			(v) => v,
			(v) => percent(v, server.host?.mem_total),
			(v) => percent(v, server.host?.disk_total),
			(v) => v / 1048576,
			(v) => v / 1048576,
		],
	);
}

export function ResourceCharts({
	server,
	range,
	now,
	tsdb,
}: {
	server: NezhaServer;
	range: Range;
	now: number;
	tsdb: boolean;
}) {
	const { messageHistory } = useWebSocketContext();
	const history = useMetricHistory(
		server.id,
		METRICS,
		tsdb ? "1d" : "realtime",
	);
	const client = useQueryClient();
	const [hidden, setHidden] = useState<string[]>([]);
	const points = useMemo(
		() =>
			inRange(
				tsdb
					? joinMetrics(history.data, [
							(v) => v,
							(v) => percent(v, server.host?.mem_total),
							(v) => percent(v, server.host?.disk_total),
							(v) => v / 1048576,
							(v) => v / 1048576,
						])
					: realtimePoints(messageHistory, server),
				range,
				now,
			),
		[history.data, messageHistory, server, range, now, tsdb],
	);
	return (
		<div className="lot-realtime">
			{[
				{ title: "资源使用量", series: RESOURCE, unit: "%" },
				{ title: "网络速率", series: NETWORK, unit: " MiB/s" },
			].map((chart) => (
				<section className="lot-card" key={chart.title}>
					<div className="lot-cardhead">
						<h3>
							{chart.title}
							{chart.unit === " MiB/s" && <small>MiB/s</small>}
						</h3>
						<div className="lot-legend">
							{chart.series.map((s) => (
								<button
									type="button"
									key={s.key}
									aria-pressed={!hidden.includes(s.key)}
									onClick={() =>
										setHidden(
											hidden.includes(s.key)
												? hidden.filter((k) => k !== s.key)
												: [...hidden, s.key],
										)
									}
								>
									<i style={{ background: s.color }} />
									{s.name}
								</button>
							))}
						</div>
					</div>
					<div className="lot-chart">
						{history.status === "error" ? (
							<div className="lot-chartempty">
								历史数据加载失败
								<button
									type="button"
									onClick={() =>
										void client.invalidateQueries({
											queryKey: ["server-metrics", server.id],
										})
									}
								>
									重试
								</button>
							</div>
						) : history.isLoading ? (
							<div className="lot-chartempty">正在读取历史数据…</div>
						) : (
							<Plot
								points={points}
								series={chart.series.filter((s) => !hidden.includes(s.key))}
								range={range}
								now={now}
								unit={chart.unit}
								session={!tsdb}
							/>
						)}
					</div>
					<div className="pulse-chart-note">
						{tsdb
							? chart.title === "资源使用量"
								? "内存与磁盘按当前容量换算"
								: "上传与下载速率"
							: "实时采样 · 本次访问记录，历史存储未开启"}
					</div>
				</section>
			))}
		</div>
	);
}

export function NetworkMonitor({
	id,
	range,
	onRange,
	now,
}: {
	id: number;
	range: Range;
	onRange: (range: Range) => void;
	now: number;
}) {
	const query = usePulseMonitor(id);
	const config = useRuntimeConfig();
	const [hidden, setHidden] = useState<string[]>([]),
		[peak, setPeak] = useState(config.forcePeakCutEnabled);
	const { probes, points: all } = monitorSeries(query.data ?? []);
	const points = inRange(all, range, now);
	const active = probes.filter((p) => !hidden.includes(p.key));
	const toggle = (key: string) =>
		setHidden(
			hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key],
		);
	return (
		<section className="lot-card lot-network">
			<div className="lot-networkhead">
				<div className="lot-networktools">
					<h3>网络监控</h3>
					<RangePicker value={range} onChange={onRange} />
					<label className="lot-peak">
						<input
							type="checkbox"
							checked={peak}
							onChange={(e) => setPeak(e.target.checked)}
						/>
						Peak cut
					</label>
				</div>
				<div className="lot-probes">
					{probes.map((p) => {
						const stats = probeStats(points, p.key);
						return (
							<button
								type="button"
								key={p.id}
								className="lot-probe"
								aria-pressed={!hidden.includes(p.key)}
								onClick={() => toggle(p.key)}
							>
								<i style={{ background: p.color }} />
								{p.name}
								{stats.loss !== null && (
									<small className={stats.loss > 0 ? "is-loss" : ""}>
										{fixed(stats.loss)}%
									</small>
								)}
							</button>
						);
					})}
				</div>
			</div>
			<div className="lot-chart">
				{query.isError ? (
					<div className="lot-chartempty">
						网络监控加载失败
						<button type="button" onClick={() => void query.refetch()}>
							重试
						</button>
					</div>
				) : query.isPending ? (
					<div className="lot-chartempty">正在读取网络监控…</div>
				) : probes.length ? (
					<Plot
						points={points}
						series={active}
						range={range}
						now={now}
						unit="ms"
						loss
						peak={peak}
					/>
				) : (
					<div className="lot-chartempty">暂无网络监控任务</div>
				)}
			</div>
			{probes.length > 0 && (
				<div className="pulse-table-wrap">
					<table className="pulse-probe-table">
						<thead>
							<tr>
								<th>探测线路</th>
								<th>最新</th>
								<th>平均</th>
								<th>波动</th>
								<th>丢包</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{probes.map((p) => {
								const s = probeStats(points, p.key);
								return (
									<tr
										key={p.id}
										className={hidden.includes(p.key) ? "is-muted" : ""}
									>
										<td>
											<button
												type="button"
												aria-pressed={!hidden.includes(p.key)}
												onClick={() => toggle(p.key)}
											>
												<i style={{ background: p.color }} />
												{p.name}
											</button>
										</td>
										<td>{fixed(s.current)} ms</td>
										<td>{fixed(s.average)} ms</td>
										<td>{fixed(s.jitter)} ms</td>
										<td>
											{fixed(s.loss)}
											{s.loss !== null ? "%" : ""}
										</td>
										<td>
											<button
												type="button"
												onClick={() =>
													setHidden(
														probes
															.filter((x) => x.key !== p.key)
															.map((x) => x.key),
													)
												}
												aria-label={`仅看${p.name}`}
											>
												仅看
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
			<div className="pulse-chart-note">
				延迟为折线，丢包为面积 · 点击线路可显示或隐藏
				{peak ? " · 已裁去高于 P95 × 1.25 的显示范围" : ""}
			</div>
		</section>
	);
}
