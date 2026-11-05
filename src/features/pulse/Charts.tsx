import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
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
	{ key: "v0", name: "CPU", color: "var(--orb-green)" },
	{ key: "v1", name: "内存", color: "var(--orb-blue)" },
	{ key: "v2", name: "磁盘", color: "var(--orb-violet)" },
];
const NETWORK: Series[] = [
	{ key: "v3", name: "下行", color: "var(--orb-green)" },
	{ key: "v4", name: "上行", color: "var(--orb-blue)" },
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
function SampleTime({
	points,
	series,
}: {
	points: PlotPoint[];
	series: Series[];
}) {
	let latest: PlotPoint | undefined;
	for (let i = points.length - 1; i >= 0; i--) {
		if (
			series.some(
				(item) =>
					points[i][item.key] != null || points[i][`${item.key}loss`] != null,
			)
		) {
			latest = points[i];
			break;
		}
	}
	if (!latest) return null;
	return (
		<span className="pulse-sample-time">
			最近采样{" "}
			<time dateTime={new Date(latest.ts).toISOString()}>
				{new Date(latest.ts).toLocaleTimeString("zh-CN", { hour12: false })}
			</time>
		</span>
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
	shade = false,
}: {
	points: PlotPoint[];
	series: Series[];
	range: Range;
	now: number;
	unit: string;
	loss?: boolean;
	peak?: boolean;
	session?: boolean;
	shade?: boolean;
}) {
	const gradientId = useId().replace(/:/g, "");
	const hasValues = points.some((p) =>
		series.some((s) => p[s.key] != null || (loss && p[`${s.key}loss`] != null)),
	);
	if (!series.length || !hasValues)
		return (
			<div className="lot-chartempty">
				{series.length ? "所选时段暂无采样数据" : "点击上方图例显示曲线"}
			</div>
		);
	const from = session
		? Math.max(
				now - range * 3600000,
				Math.min(points[0]?.ts ?? now, now - 60000),
			)
		: now - range * 3600000;
	const tickCount = unit === "%" ? 3 : 5;
	const ticks = Array.from(
		{ length: tickCount },
		(_, index) => from + ((now - from) * index) / (tickCount - 1),
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
					margin={{ top: 14, right: loss ? 8 : 6, bottom: 0, left: 0 }}
					accessibilityLayer
				>
					{shade && (
						<defs>
							{series.map((s) => (
								<linearGradient
									key={s.key}
									id={`${gradientId}-${s.key}`}
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop offset="0%" stopColor={s.color} stopOpacity={0.11} />
									<stop offset="95%" stopColor={s.color} stopOpacity={0} />
								</linearGradient>
							))}
						</defs>
					)}
					<CartesianGrid
						stroke="var(--pulse-chart-grid)"
						strokeDasharray="3 5"
						vertical={false}
					/>
					<XAxis
						dataKey="ts"
						type="number"
						domain={[from, now]}
						ticks={ticks}
						interval="preserveStartEnd"
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
						padding={{ left: 2, right: 10 }}
						tickMargin={10}
						tick={{ fontSize: 10, fill: "var(--lot-faint)" }}
					/>
					<YAxis
						yAxisId="value"
						width={unit === "%" ? 36 : 48}
						tickLine={false}
						axisLine={false}
						tick={{ fontSize: 10, fill: "var(--lot-faint)" }}
						tickMargin={8}
						tickCount={5}
						domain={[
							unit === "ms"
								? (min: number) => Math.max(0, Math.floor(min / 20) * 20 - 10)
								: 0,
							peak
								? peakLimit(
										points,
										series.map((s) => s.key),
									)
								: unit === "%"
									? 100
									: unit === "ms"
										? (max: number) => Math.ceil(max / 10) * 10 + 10
										: "auto",
						]}
						allowDataOverflow={peak}
						tickFormatter={(n) =>
							`${Number(n.toFixed(1))}${unit === "ms" ? "ms" : ""}`
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
							tick={{ fontSize: 10, fill: "var(--lot-faint)" }}
							tickFormatter={(n) => `${n}%`}
						/>
					)}
					<Tooltip
						isAnimationActive={false}
						cursor={{
							stroke: "var(--orb-faint)",
							strokeWidth: 1,
							strokeDasharray: "3 4",
						}}
						content={({ active, payload, label }) => {
							if (!active || !payload?.length) return null;
							const values = series.flatMap((s) => {
								const value = number(
									payload.find((item) => item.dataKey === s.key)?.value,
								);
								const packetLoss = loss
									? number(
											payload.find((item) => item.dataKey === `${s.key}loss`)
												?.value,
										)
									: null;
								return value === null && packetLoss === null
									? []
									: [{ ...s, value, packetLoss }];
							});
							return (
								<div className="pulse-chart-tooltip">
									<time>
										{new Date(Number(label)).toLocaleString("zh-CN", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
											hour12: false,
										})}
									</time>
									{values.map((item) => (
										<div key={item.key}>
											<span>
												<i style={{ background: item.color }} />
												{item.name}
											</span>
											<b>
												{fixed(item.value, unit === " B/s" ? 0 : 1)}
												<small>{unit}</small>
											</b>
											{item.packetLoss !== null && (
												<em className={item.packetLoss > 0 ? "has-loss" : ""}>
													{fixed(item.packetLoss)}% 丢包
												</em>
											)}
										</div>
									))}
								</div>
							);
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
								fillOpacity={0.07}
								activeDot={false}
								type="linear"
								isAnimationActive={false}
								connectNulls={false}
							/>
						))}
					{shade &&
						series.map((s) => (
							<Area
								key={`shade-${s.key}`}
								yAxisId="value"
								dataKey={s.key}
								stroke="none"
								fill={`url(#${gradientId}-${s.key})`}
								type={unit === "ms" ? "linear" : "monotoneX"}
								tooltipType="none"
								activeDot={false}
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
							strokeWidth={unit === "ms" ? 1.55 : 1.7}
							strokeLinecap="round"
							strokeLinejoin="round"
							type={unit === "ms" ? "linear" : "monotoneX"}
							dot={points.length === 1 ? { r: 2.5 } : false}
							activeDot={{ r: 4, stroke: "var(--lot-surface)", strokeWidth: 2 }}
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
	const networkPeak = points.reduce(
		(max, point) => Math.max(max, point.v3 ?? 0, point.v4 ?? 0),
		0,
	);
	const networkScale =
		networkPeak >= 1 ? 1 : networkPeak >= 1 / 1024 ? 1024 : 1048576;
	const networkUnit =
		networkScale === 1 ? " MiB/s" : networkScale === 1024 ? " KiB/s" : " B/s";
	const networkPoints = useMemo(
		() =>
			networkScale === 1
				? points
				: points.map((point) => ({
						...point,
						v3: point.v3 == null ? null : point.v3 * networkScale,
						v4: point.v4 == null ? null : point.v4 * networkScale,
					})),
		[points, networkScale],
	);
	return (
		<div className="lot-realtime">
			{[
				...RESOURCE.map((s) => ({
					title: `${s.name}使用率`,
					series: [s],
					unit: "%",
				})),
				{ title: "网络速率", series: NETWORK, unit: networkUnit },
			].map((chart) => (
				<section
					className={`lot-card ${chart.unit === "%" ? "lot-resource-card" : "lot-bandwidth"}`}
					key={chart.title}
				>
					<div className="lot-cardhead">
						<h3>
							{chart.title}
							{chart.unit !== "%" && <small>{chart.unit.trim()}</small>}
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
								points={chart.unit === "%" ? points : networkPoints}
								series={chart.series.filter((s) => !hidden.includes(s.key))}
								range={range}
								now={now}
								unit={chart.unit}
								session={!tsdb}
								shade
							/>
						)}
					</div>
					<div className="pulse-chart-note">
						{tsdb
							? chart.unit === "%"
								? `所选时段平均 ${fixed(probeStats(points, chart.series[0].key).average)}% · 峰值 ${fixed(points.length ? Math.max(...points.map((point) => point[chart.series[0].key]).filter((value): value is number => value != null)) : null)}%`
								: "上传与下载速率"
							: "实时采样 · 本次访问记录，历史存储未开启"}
						<SampleTime points={points} series={chart.series} />
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
	const { probes: rawProbes, points: all } = monitorSeries(
		query.data ?? [],
		config.pulseMonitorIds,
	);
	const probes = [...rawProbes].sort((a, b) => {
		const rank = (probeId: number) => {
			const index = config.pulseMonitorIds.indexOf(probeId);
			return index < 0 ? config.pulseMonitorIds.length : index;
		};
		return rank(a.id) - rank(b.id);
	});
	const points = inRange(all, range, now);
	const active = probes.filter((p) => !hidden.includes(p.key));
	const hasLoss = points.some((point) =>
		active.some((p) => point[`${p.key}loss`] != null),
	);
	const reportedLoss = points.some((point) =>
		probes.some((p) => point[`${p.key}loss`] != null),
	);
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
						loss={hasLoss}
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
										<td data-label="最新">{fixed(s.current)} ms</td>
										<td data-label="平均">{fixed(s.average)} ms</td>
										<td data-label="波动">{fixed(s.jitter)} ms</td>
										<td data-label="丢包">
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
				{reportedLoss
					? "延迟为折线，丢包为面积"
					: "延迟趋势 · 当前数据未提供丢包率"}{" "}
				· 点击线路可显示或隐藏
				{peak ? " · 已裁去高于 P95 × 1.25 的显示范围" : ""}
				<SampleTime points={points} series={active} />
			</div>
		</section>
	);
}
