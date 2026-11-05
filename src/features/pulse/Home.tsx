import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	ChevronRight,
	Clock3,
	Cpu,
	HardDrive,
	LayoutGrid,
	LockKeyhole,
	type LucideIcon,
	MemoryStick,
	Network,
	Rows3,
	Search,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLoginUser } from "@/hooks/use-login-user";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { useRuntimeConfig } from "@/lib/runtime-config";
import type { CycleTransferStats, NezhaServer } from "@/types/nezha-api";
import { usePulseData, usePulseMonitor } from "./data";
import { PulseMap } from "./Map";
import {
	bytes,
	cardProbes,
	countryCode,
	countryName,
	cyclesFor,
	duration,
	fixed,
	flag,
	isOnline,
	monitorSeries,
	number,
	percent,
	primaryCycleFor,
	probeStats,
	totals,
} from "./model";
import { readNote } from "./notes";

export function PulseState({
	text,
	error = false,
	retry,
}: {
	text: string;
	error?: boolean;
	retry?: () => void;
}) {
	const login = useLoginUser();
	return (
		<div className="orb-empty pulse-state" role={error ? "alert" : "status"}>
			<span>{text}</span>
			{retry && (
				<button type="button" className="lot-back" onClick={retry}>
					重新加载
				</button>
			)}
			{error && login.authStatus === "anonymous" && (
				<a href="/dashboard/" target="_blank" rel="noopener noreferrer">
					登录控制台 <ArrowRight size={13} />
				</a>
			)}
		</div>
	);
}

export function Resource({
	name,
	value,
	note,
	color,
	icon: Icon,
}: {
	name: string;
	value: number | null;
	note: string;
	color: string;
	icon: LucideIcon;
}) {
	return (
		<div className="orb-resource">
			<div className="orb-resource-label">
				<span>
					<Icon />
					{name}
				</span>
				<b className={value !== null && value > 85 ? "warning" : ""}>
					{fixed(value)}
					<small>{value !== null ? "%" : ""}</small>
				</b>
			</div>
			<div className="orb-meter">
				<span
					className={color}
					style={{ width: `${Math.min(100, value ?? 0)}%` }}
				/>
			</div>
			<div className="orb-resource-amount" title={note}>
				{note}
			</div>
		</div>
	);
}

function NodeCard({
	server: s,
	now,
	cycleStats,
	connected,
}: {
	server: NezhaServer;
	now: number;
	cycleStats?: CycleTransferStats;
	connected: boolean;
}) {
	const monitor = usePulseMonitor(s.id);
	const config = useRuntimeConfig();
	const login = useLoginUser();
	const online = isOnline(s, now);
	const live = online && connected;
	const cycles = cyclesFor(cycleStats, s.id);
	const cycle = primaryCycleFor(
		cycleStats,
		s.id,
		config.pulsePrimaryCycleIds[s.id],
	);
	const cyclePercent = cycle ? percent(cycle.used, cycle.max) : null;
	const code = countryCode(s);
	const note = readNote(s.public_note, now);
	const { probes: allProbes, points } = monitorSeries(
		monitor.data ?? [],
		config.pulseMonitorIds,
	);
	const probes = cardProbes(allProbes, config.pulseMonitorIds);
	const v = s.state,
		h = s.host;
	const transfer =
		v?.net_in_transfer == null || v?.net_out_transfer == null
			? null
			: v.net_in_transfer + v.net_out_transfer;
	return (
		<Link to={`/server/${s.id}`} className="orb-node-link" aria-label={s.name}>
			<article
				className={`orb-node ${online ? "" : "is-offline"}`}
				aria-label={s.name}
			>
				<div className="orb-nodehead">
					<span className="orb-flag" aria-hidden="true">
						{flag(code)}
					</span>
					<div className="orb-nametext">
						<span className="orb-nodename">{s.name}</span>
						<div className="orb-nodeinfo">
							{countryName(code)} · {h?.platform || "系统未知"} ·{" "}
							{h?.arch || "—"}
						</div>
					</div>
					<div className="orb-nodeflags">
						<span className={`orb-state ${!live ? "bad" : ""}`}>
							<i />
							{!connected ? "待更新" : online ? "在线" : "离线"}
						</span>
						{note.daysLeft !== undefined && note.daysLeft <= 14 && (
							<span className="orb-expiry" title={note.expires}>
								{note.daysLeft < 0 ? "已到期" : `${note.daysLeft} 天后到期`}
							</span>
						)}
					</div>
				</div>
				<div className="orb-resources">
					<Resource
						name="CPU"
						icon={Cpu}
						value={live ? number(v?.cpu) : null}
						color="cpu"
						note={
							h?.cpu?.length
								? h.cpu[0].replace(/\s*\d+\s*Physical.*$/i, "")
								: "型号未上报"
						}
					/>
					<Resource
						name="内存"
						icon={MemoryStick}
						value={live ? percent(v?.mem_used, h?.mem_total) : null}
						color="memory"
						note={`${live ? bytes(v?.mem_used) : "—"} / ${bytes(h?.mem_total)}`}
					/>
					<Resource
						name="磁盘"
						icon={HardDrive}
						value={live ? percent(v?.disk_used, h?.disk_total) : null}
						color="disk"
						note={`${live ? bytes(v?.disk_used) : "—"} / ${bytes(h?.disk_total)}`}
					/>
					<div className={`orb-cycle${cycle ? "" : " is-cumulative"}`}>
						<div className="orb-resource-label">
							<span>
								<Network />
								{cycle ? "周期流量" : "累计流量"}
							</span>
							{cycle && (
								<b>
									{fixed(cyclePercent)}
									{cyclePercent !== null && <small>%</small>}
								</b>
							)}
						</div>
						{cycle ? (
							<div className="orb-meter">
								<span
									className="traffic"
									style={{ width: `${Math.min(100, cyclePercent ?? 0)}%` }}
								/>
							</div>
						) : (
							<div className="orb-transfer-value">{bytes(transfer)}</div>
						)}
						<div
							className="orb-resource-amount"
							title={
								cycle
									? `主规则 ${cycle.name}: ${bytes(cycle.used)} / ${bytes(cycle.max)}`
									: undefined
							}
						>
							{cycle
								? `${bytes(cycle.used)} / ${bytes(cycle.max)}`
								: "上传与下载合计"}
							{cycles.length > 1 && ` · ${cycles.length} 个规则`}
						</div>
					</div>
				</div>
				<div className="orb-speed">
					<span>
						<ArrowDown />
						<small>下载</small>
						<b>{live ? bytes(v?.net_in_speed, true) : "—"}</b>
					</span>
					<span className="up">
						<ArrowUp />
						<small>上传</small>
						<b>{live ? bytes(v?.net_out_speed, true) : "—"}</b>
					</span>
				</div>
				<div className="orb-pings">
					{probes.length ? (
						probes.map((p) => {
							const stats = probeStats(points, p.key);
							const samples = points.slice(-40).map((x) => x[p.key]);
							const max = Math.max(
								1,
								...samples.filter((x): x is number => x != null),
							);
							return (
								<div key={p.id}>
									<div className="orb-pingtitle">
										<span title={p.name}>{p.name}</span>
									</div>
									<div className="orb-pingvalue" style={{ color: p.color }}>
										{fixed(live ? stats.current : null, 0)}
										<small>ms</small>
									</div>
									<svg
										className="orb-mini"
										viewBox="0 0 100 18"
										preserveAspectRatio="none"
										aria-label={`${p.name}延迟趋势`}
									>
										<path
											d={samples
												.map((x, i) =>
													x === null || x === undefined
														? ""
														: `${i === 0 || samples[i - 1] == null ? "M" : "L"}${(i / Math.max(1, samples.length - 1)) * 100},${17 - (x / max) * 15}`,
												)
												.join(" ")}
											fill="none"
											stroke={p.color}
											strokeWidth="1.2"
										/>
									</svg>
									<small
										className={`orb-loss ${stats.loss !== null && stats.loss > 0 ? "has-loss" : ""}`}
										title={
											stats.loss === null ? "该线路未上报丢包率" : undefined
										}
									>
										24h 丢包 {fixed(stats.loss)}
										{stats.loss !== null ? "%" : ""}
									</small>
								</div>
							);
						})
					) : (
						<span className="pulse-monitor-empty">
							{monitor.isError
								? "网络监控暂不可用"
								: monitor.isPending
									? "正在读取网络监控…"
									: config.pulseMonitorIds.length
										? "所选线路暂无监控数据"
										: "暂无网络监控"}
						</span>
					)}
				</div>
				<div className="orb-nodefooter">
					<span className="orb-clock">
						<Clock3 />
						{live ? `连续在线 ${duration(v?.uptime)}` : "等待节点上报"}
					</span>
					<span className="orb-detailbtn" aria-hidden="true">
						{!login.isAuthenticated && <LockKeyhole />}
						详情
						<ChevronRight />
					</span>
				</div>
			</article>
		</Link>
	);
}

export default function PulseHome({
	configurationLoading = false,
	backendError,
}: {
	configurationLoading?: boolean;
	backendError?: Error | null;
}) {
	const {
		lastData,
		connected: transportConnected,
		dataStale,
		reconnect,
	} = useWebSocketContext();
	const connected = transportConnected && !dataStale;
	const { groups, service } = usePulseData();
	const config = useRuntimeConfig();
	const [group, setGroup] = useState(0),
		[country, setCountry] = useState("");
	const [query, setQuery] = useState(""),
		[offline, setOffline] = useState(false),
		[list, setList] = useState(false),
		[limit, setLimit] = useState(24);
	if (configurationLoading) return <PulseState text="正在加载面板配置…" />;
	if (backendError)
		return (
			<PulseState
				error
				text="暂时无法读取面板配置"
				retry={() => window.location.reload()}
			/>
		);
	if (!lastData)
		return (
			<PulseState
				error={!connected}
				text={connected ? "正在等待节点数据…" : "正在连接面板，可登录后重试"}
				retry={reconnect}
			/>
		);
	const stats = service.data?.data?.cycle_transfer_stats;
	const t = totals(lastData, stats, config.pulsePrimaryCycleIds);
	const groupIds = groups.data?.data?.find(
		(g) => g.group.id === group,
	)?.servers;
	const filtered = lastData.servers.filter(
		(s) =>
			(!groupIds || groupIds.includes(s.id)) &&
			(!country || countryCode(s) === country) &&
			(!offline || !isOnline(s, lastData.now)) &&
			`${s.name} ${countryCode(s)} ${s.host?.platform ?? ""}`
				.toLowerCase()
				.includes(query.toLowerCase()),
	);
	const hero = [
		{
			icon: ArrowDown,
			label: "实时下行",
			value: connected ? bytes(t.down, true) : "—",
			note: `实时上行 ${connected ? bytes(t.up, true) : "—"}`,
		},
		{
			icon: Network,
			label: "周期用量合计",
			value: bytes(t.cycleUsed),
			note:
				t.cycleMax === null
					? "暂无周期流量规则"
					: `${t.cycleCount}/${lastData.servers.length} 节点 · 额度 ${bytes(t.cycleMax)}`,
			help: "每个节点只统计主规则；各节点的计费周期可能不同。",
		},
		{
			icon: ArrowUp,
			label: "累计总流量",
			value: bytes(t.transfer),
			note: "节点累计上传与下载",
		},
		{
			icon: Cpu,
			label: "平均 CPU",
			value: connected ? `${fixed(t.cpu)}${t.cpu === null ? "" : "%"}` : "—",
			note: "当前在线节点",
		},
		{
			icon: MemoryStick,
			label: "内存使用",
			value: connected ? bytes(t.memory) : "—",
			note: `在线容量 ${bytes(t.memoryTotal)}`,
		},
		{
			icon: HardDrive,
			label: "磁盘使用",
			value: connected ? bytes(t.disk) : "—",
			note: `在线容量 ${bytes(t.diskTotal)}`,
		},
	];
	return (
		<div className="orb-overview">
			<section className="orb-hero">
				<div className="orb-intro">
					<div className="pulse-overview-heading">
						<div>
							<h1>运行概况</h1>
							<p className="orb-subtitle">
								{lastData.servers.length} 个节点 ·{" "}
								{
									new Set(lastData.servers.map(countryCode).filter(Boolean))
										.size
								}{" "}
								个地区
							</p>
						</div>
						<div className="orb-statusline">
							<span className="orb-onlinestatus">
								<i className="orb-online" />
								在线<strong>{t.online}</strong>
							</span>
							<span className="orb-statusdivider" />
							<button
								type="button"
								className="orb-offlinebtn"
								aria-pressed={offline}
								onClick={() => setOffline(!offline)}
							>
								离线<strong>{lastData.servers.length - t.online}</strong>
								<ChevronRight />
							</button>
						</div>
					</div>
					<div className="orb-hero-stats">
						{hero.map((item) => (
							<div key={item.label} className="orb-hero-stat" title={item.help}>
								<div className="orb-stat-label">
									<item.icon />
									{item.label}
								</div>
								<div className="orb-stat-value">{item.value}</div>
								<div className="orb-stat-note">{item.note}</div>
							</div>
						))}
					</div>
				</div>
				<div className="pulse-map-panel">
					<div className="pulse-map-heading">
						<span>节点分布</span>
						<span>点击地区筛选</span>
					</div>
					<PulseMap data={lastData} selected={country} onSelect={setCountry} />
				</div>
			</section>
			{!connected && (
				<div className="pulse-notice" role="status">
					{dataStale
						? "数据已过期，正在重新连接。"
						: "连接已中断，正在显示最后收到的数据。"}
					<button type="button" onClick={reconnect}>
						重新连接
					</button>
				</div>
			)}
			{(groups.isError || service.isError) && (
				<div className="pulse-notice" role="alert">
					部分分组或流量信息未能加载。
					<button
						type="button"
						onClick={() => {
							void groups.refetch();
							void service.refetch();
						}}
					>
						重试
					</button>
				</div>
			)}
			<div className="orb-tools">
				<fieldset className="orb-tabs" aria-label="节点分组">
					<button
						type="button"
						className="orb-tab"
						aria-pressed={group === 0}
						onClick={() => {
							setGroup(0);
							setCountry("");
						}}
					>
						全部节点<span>{lastData.servers.length}</span>
					</button>
					{groups.data?.data?.map((g) => (
						<button
							type="button"
							key={g.group.id}
							className="orb-tab"
							aria-pressed={group === g.group.id}
							onClick={() => setGroup(g.group.id)}
						>
							{g.group.name}
							<span>
								{
									g.servers.filter((id) =>
										lastData.servers.some((s) => s.id === id),
									).length
								}
							</span>
						</button>
					))}
					{country && (
						<button
							type="button"
							className="orb-tab"
							aria-pressed="true"
							onClick={() => setCountry("")}
						>
							{countryName(country)} ×
						</button>
					)}
				</fieldset>
				<div className="orb-toolright">
					<label className="orb-search">
						<Search />
						<input
							type="search"
							aria-label="搜索节点"
							placeholder="搜索节点"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</label>
					<div className="orb-viewbuttons">
						<button
							type="button"
							aria-label="卡片布局"
							aria-pressed={!list}
							onClick={() => setList(false)}
						>
							<LayoutGrid />
						</button>
						<button
							type="button"
							aria-label="列表布局"
							aria-pressed={list}
							onClick={() => setList(true)}
						>
							<Rows3 />
						</button>
					</div>
				</div>
			</div>
			<div className={`orb-nodes ${list ? "is-list" : ""}`}>
				{filtered.length ? (
					filtered
						.slice(0, limit)
						.map((s) => (
							<NodeCard
								key={s.id}
								server={s}
								now={lastData.now}
								cycleStats={stats}
								connected={connected}
							/>
						))
				) : (
					<div className="orb-empty">
						{lastData.servers.length ? "没有符合条件的节点" : "暂无可见节点"}
					</div>
				)}
			</div>
			{filtered.length > limit && (
				<button
					type="button"
					className="pulse-more lot-back"
					onClick={() => setLimit(limit + 24)}
				>
					加载更多 · 剩余 {filtered.length - limit} 个
				</button>
			)}
		</div>
	);
}
