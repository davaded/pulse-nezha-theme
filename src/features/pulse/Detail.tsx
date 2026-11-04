import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Cpu, HardDrive, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLoginUser } from "@/hooks/use-login-user";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { fetchServerOnlineHistory } from "@/lib/nezha-api";
import type { CycleTransferStats } from "@/types/nezha-api";
import { NetworkMonitor, RangePicker, ResourceCharts } from "./Charts";
import { usePulseData, usePulseSetting } from "./data";
import { PulseState } from "./Home";
import {
	bytes,
	countryCode,
	cyclesFor,
	duration,
	fixed,
	flag,
	isOnline,
	number,
	percent,
	type Range,
	timestamp,
} from "./model";
import { readNote } from "./notes";

function date(value: string | undefined) {
	return value && Number.isFinite(Date.parse(value))
		? new Date(value).toLocaleDateString("zh-CN")
		: "—";
}
export function TrafficSummary({
	id,
	stats,
	incoming,
	outgoing,
}: {
	id: number;
	stats?: CycleTransferStats;
	incoming: unknown;
	outgoing: unknown;
}) {
	const cycles = cyclesFor(stats, id);
	const a = number(incoming),
		b = number(outgoing);
	return (
		<>
			{cycles.length ? (
				cycles.map((c) => (
					<section className="lot-card lot-summary" key={c.key}>
						<div className="lot-summaryhead">
							<h3>周期流量</h3>
							<span>{c.name}</span>
						</div>
						<div className="lot-summaryvalue">
							<b>{bytes(c.used)}</b>
							<span>/ {bytes(c.max)}</span>
						</div>
						<div className="lot-usagebar">
							<span
								style={{
									width: `${Math.min(100, percent(c.used, c.max) ?? 0)}%`,
								}}
							/>
						</div>
						<dl className="lot-summarypairs">
							<div>
								<dt>统计起始</dt>
								<dd>{date(c.from)}</dd>
							</div>
							<div>
								<dt>本期结束</dt>
								<dd>{date(c.to)}</dd>
							</div>
						</dl>
						<div className="lot-summaryfoot">
							下次重置 <span>{date(c.reset)}</span>
						</div>
					</section>
				))
			) : (
				<section className="lot-card lot-summary">
					<div className="lot-summaryhead">
						<h3>周期流量</h3>
					</div>
					<div className="lot-summaryvalue">
						<b>—</b>
					</div>
					<p className="pulse-chart-note">暂无周期流量规则</p>
				</section>
			)}
			<section className="lot-card lot-summary">
				<div className="lot-summaryhead">
					<h3>累计流量</h3>
					<span>节点累计</span>
				</div>
				<div className="lot-summaryvalue">
					<b>{bytes(a !== null && b !== null ? a + b : null)}</b>
				</div>
				<dl className="lot-summarypairs">
					<div>
						<dt>累计下载</dt>
						<dd>{bytes(a)}</dd>
					</div>
					<div>
						<dt>累计上传</dt>
						<dd>{bytes(b)}</dd>
					</div>
				</dl>
				<div className="lot-summaryfoot">节点上报的累计值</div>
			</section>
		</>
	);
}

export function OnlineSummary({ id }: { id: number }) {
	const login = useLoginUser();
	const days = login.isAuthenticated ? 7 : 1;
	const query = useQuery({
		queryKey: ["pulse-online", id, days],
		queryFn: ({ signal }) => fetchServerOnlineHistory(id, days, { signal }),
		retry: false,
		refetchInterval: 60000,
	});
	const online = query.data?.data;
	return (
		<section className="lot-card lot-summary lot-summary-online">
			<div className="lot-summaryhead">
				<h3>在线记录</h3>
				<span>最近 {online?.days ?? days} 天</span>
			</div>
			{query.isError ? (
				<div className="pulse-chart-note" role="alert">
					在线记录加载失败{" "}
					<button type="button" onClick={() => void query.refetch()}>
						重试
					</button>
				</div>
			) : query.isPending ? (
				<div className="pulse-chart-note">正在读取在线记录…</div>
			) : (
				online && (
					<>
						<div className="lot-summaryvalue">
							<b>{fixed(online.online_rate, 2)}%</b>
							<span>在线率</span>
						</div>
						<div
							className="lot-days"
							style={{
								gridTemplateColumns: `repeat(${Math.max(1, online.daily.length)},minmax(0,1fr))`,
							}}
						>
							{online.daily.map((d) => (
								<div
									className="lot-day"
									key={d.date}
									title={`${d.date} 在线 ${duration(d.online_seconds)}`}
								>
									<span className="lot-daybar">
										<i
											style={{
												width: `${Math.min(100, d.online_seconds / 864)}%`,
											}}
										/>
									</span>
									{d.date.slice(5)}
								</div>
							))}
						</div>
						<dl className="lot-summarypairs">
							<div>
								<dt>窗口累计在线</dt>
								<dd>{duration(online.total_online_seconds)}</dd>
							</div>
							<div>
								<dt>记录时区</dt>
								<dd>{online.timezone || "面板时区"}</dd>
							</div>
						</dl>
						<div className="lot-summaryfoot">
							<span>
								{date(online.window_start)} – {date(online.window_end)}
							</span>
							<span>
								{login.isAuthenticated ? "面板在线历史" : "访客可查看 1 天"}
							</span>
						</div>
					</>
				)
			)}
		</section>
	);
}

export default function PulseDetail() {
	const { id } = useParams();
	const { lastData, connected, reconnect } = useWebSocketContext();
	const { service } = usePulseData();
	const setting = usePulseSetting();
	const [range, setRange] = useState<Range>(6);
	useEffect(() => {
		window.scrollTo({ top: 0, left: 0, behavior: "instant" });
	}, []);
	const server = lastData?.servers.find((s) => String(s.id) === id);
	if (!lastData)
		return <PulseState text="正在读取节点信息…" retry={reconnect} />;
	if (!server)
		return (
			<div className="lot-detail">
				<Link to="/" className="lot-back">
					<ArrowLeft size={14} />
					返回总览
				</Link>
				<PulseState error text="节点不存在，或当前账号无权查看" />
			</div>
		);
	const v = server.state,
		h = server.host;
	const online = isOnline(server, lastData.now),
		live = online && connected;
	const note = readNote(server.public_note, lastData.now);
	const usage = (value: unknown) => (live ? value : null);
	const tiles = [
		{
			label: "CPU",
			value: `${fixed(usage(v?.cpu))}${live && number(v?.cpu) !== null ? "%" : ""}`,
			note: h?.cpu?.length ? `${h.cpu.length} 项处理器信息` : "型号未上报",
		},
		{
			label: "内存",
			value: `${fixed(live ? percent(v?.mem_used, h?.mem_total) : null)}${live && percent(v?.mem_used, h?.mem_total) !== null ? "%" : ""}`,
			note: `${bytes(usage(v?.mem_used))} / ${bytes(h?.mem_total)}`,
		},
		{
			label: "交换空间",
			value:
				h?.swap_total === 0
					? "未配置"
					: `${fixed(live ? percent(v?.swap_used, h?.swap_total) : null)}${live && percent(v?.swap_used, h?.swap_total) !== null ? "%" : ""}`,
			note: `${bytes(usage(v?.swap_used))} / ${bytes(h?.swap_total)}`,
		},
		{
			label: "磁盘",
			value: `${fixed(live ? percent(v?.disk_used, h?.disk_total) : null)}${live && percent(v?.disk_used, h?.disk_total) !== null ? "%" : ""}`,
			note: `${bytes(usage(v?.disk_used))} / ${bytes(h?.disk_total)}`,
		},
		{
			label: "系统负载",
			value: fixed(usage(v?.load_1), 2),
			note: `${fixed(usage(v?.load_5), 2)} / ${fixed(usage(v?.load_15), 2)}`,
		},
		{
			label: "TCP / UDP",
			value: `${fixed(usage(v?.tcp_conn_count), 0)} / ${fixed(usage(v?.udp_conn_count), 0)}`,
			note: "当前连接数",
		},
		{
			label: "进程",
			value: fixed(usage(v?.process_count), 0),
			note: "当前进程数",
		},
		{
			label: "连续在线",
			value: duration(usage(v?.uptime)),
			note: h?.boot_time
				? `启动于 ${date(new Date(h.boot_time * 1000).toISOString())}`
				: "启动时间未知",
		},
	];
	return (
		<div className="lot-detail">
			<header className="lot-header">
				<Link to="/" className="lot-back">
					<ArrowLeft />
					返回总览
				</Link>
				<div className="lot-title">
					<span className="lot-flag" aria-hidden="true">
						{flag(countryCode(server))}
					</span>
					<h1>{server.name}</h1>
					<span className={`lot-status ${live ? "" : "is-offline"}`}>
						<i />
						{!connected ? "连接中断" : online ? "在线" : "离线"}
					</span>
					{!online && (
						<span className="lot-last">
							最后上报{" "}
							{Number.isFinite(timestamp(server.last_active))
								? new Date(server.last_active).toLocaleString("zh-CN")
								: "—"}
						</span>
					)}
					{note.expires && (
						<span
							className={`lot-billing ${note.daysLeft !== undefined && note.daysLeft <= 14 ? "is-warning" : ""}`}
						>
							{note.expires}
						</span>
					)}
				</div>
				<div className="lot-chips">
					{[
						{
							icon: Terminal,
							text: [h?.platform, h?.platform_version]
								.filter(Boolean)
								.join(" "),
						},
						{ icon: HardDrive, text: h?.arch },
						{ icon: Cpu, text: h?.cpu?.join(" · ") },
					]
						.filter((c) => c.text)
						.map((c, i) => (
							<span
								className={`lot-chip ${i === 2 ? "is-cpu" : ""}`}
								key={c.text}
							>
								<c.icon />
								<span title={c.text}>{c.text}</span>
							</span>
						))}
					{note.chips.map((chip, i) => (
						<span className="lot-chip" key={`${chip}-${i}`}>
							{chip}
						</span>
					))}
				</div>
				{note.text && <p className="pulse-public-note">{note.text}</p>}
			</header>
			<dl className={`lot-stats ${live ? "" : "is-offline"}`}>
				{tiles.map((t) => (
					<div className="lot-tile" key={t.label}>
						<dt>{t.label}</dt>
						<dd>{t.value}</dd>
						<small>{t.note}</small>
					</div>
				))}
			</dl>
			<div className="pulse-section-head">
				<span>节点趋势</span>
				<RangePicker value={range} onChange={setRange} />
			</div>
			<ResourceCharts
				key={server.id}
				server={server}
				now={lastData.now}
				range={range}
				tsdb={setting.data?.data?.tsdb_enabled === true}
			/>
			<NetworkMonitor
				key={`monitor-${server.id}`}
				id={server.id}
				now={lastData.now}
				range={range}
				onRange={setRange}
			/>
			{service.isError && (
				<div className="pulse-notice" role="alert">
					周期流量暂时无法加载
					<button type="button" onClick={() => void service.refetch()}>
						重试
					</button>
				</div>
			)}
			<div className="lot-summaries">
				<TrafficSummary
					id={server.id}
					stats={service.data?.data?.cycle_transfer_stats}
					incoming={v?.net_in_transfer}
					outgoing={v?.net_out_transfer}
				/>
				<OnlineSummary id={server.id} />
			</div>
		</div>
	);
}
