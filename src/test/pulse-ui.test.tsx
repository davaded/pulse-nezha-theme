import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
	WebSocketContext,
	type WebSocketContextType,
} from "@/context/websocket-context";
import { PulseFooter, PulseHeader } from "@/features/pulse/App";
import {
	NetworkMonitor,
	Plot,
	RangePicker,
	ResourceCharts,
} from "@/features/pulse/Charts";
import PulseDetail, {
	OnlineSummary,
	TrafficSummary,
} from "@/features/pulse/Detail";
import PulseHome from "@/features/pulse/Home";
import { refreshRuntimeConfig } from "@/lib/runtime-config";
import { createServer, createSettingResponse } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";
import type { CycleTransferStats, NezhaMonitor } from "@/types/nezha-api";

const now = Date.parse("2025-01-01T00:00:00Z");
const server = createServer({ state: { cpu: 0, mem_used: 0, disk_used: 0 } });
const cycle: CycleTransferStats = {
	month: {
		name: "月度",
		from: "2025-01-01",
		to: "2025-02-01",
		max: 1024 ** 4,
		min: 0,
		server_name: { "1": "edge-1" },
		transfer: { "1": 0 },
		next_update: { "1": "2025-02-01" },
	},
};
const monitors: NezhaMonitor[] = [
	{
		monitor_id: 1,
		monitor_name: "电信",
		server_id: 1,
		server_name: "edge",
		created_at: [now / 1000 - 60, now / 1000],
		avg_delay: [30, 40],
		packet_loss: [0, 2],
	},
	{
		monitor_id: 2,
		monitor_name: "移动",
		server_id: 1,
		server_name: "edge",
		created_at: [now / 1000 - 60, now / 1000],
		avg_delay: [80, 90],
	},
];
let socket: WebSocketContextType;
let fail: string[];
let emptyMonitor = false;
let guest = false;
let networkRate = 1048576;
let cycleStats = cycle;
const fetchMock = vi.fn();

function view(ui: React.ReactElement, route = "/") {
	return renderWithProviders(
		<WebSocketContext.Provider value={socket}>{ui}</WebSocketContext.Provider>,
		{ route },
	);
}
beforeEach(() => {
	socket = {
		lastData: {
			now,
			servers: [
				server,
				createServer({
					id: 2,
					name: "offline-node",
					country_code: "jp",
					last_active: "2024-12-31T00:00:00Z",
				}),
			],
		},
		messageHistory: [{ now, servers: [server] }],
		connected: true,
		reconnect: vi.fn(),
		needReconnect: false,
		setNeedReconnect: vi.fn(),
	};
	fail = [];
	emptyMonitor = false;
	guest = false;
	networkRate = 1048576;
	cycleStats = cycle;
	window.CustomLogo = undefined;
	window.ForcePeakCutEnabled = false;
	window.PulseMonitorIds = undefined;
	refreshRuntimeConfig();
	fetchMock.mockReset().mockImplementation(async (input: string) => {
		const url = new URL(input, "https://localhost");
		let data: unknown;
		if (fail.some((p) => url.pathname.endsWith(p)))
			return new Response(JSON.stringify({ error: "unavailable" }), {
				status: 503,
			});
		if (url.pathname.endsWith("/profile")) {
			if (guest)
				return new Response(JSON.stringify({ error: "unauthorized" }), {
					status: 401,
				});
			data = { id: 1, username: "tester" };
		} else if (url.pathname.endsWith("/setting"))
			return Response.json({
				...createSettingResponse(),
				data: { ...createSettingResponse().data, tsdb_enabled: true },
			});
		else if (url.pathname.endsWith("/server-group"))
			data = [{ group: { id: 1, name: "日本" }, servers: [2] }];
		else if (url.pathname === "/api/v1/service")
			data = { services: {}, cycle_transfer_stats: cycleStats };
		else if (url.pathname.endsWith("/service"))
			data = emptyMonitor ? [] : monitors;
		else if (url.pathname.endsWith("/metrics"))
			data = {
				server_id: 1,
				metric: url.searchParams.get("metric"),
				data_points: [
					{ ts: now - 60000, value: 0 },
					{
						ts: now,
						value:
							url.searchParams.get("metric") === "cpu"
								? 25
								: url.searchParams.get("metric")?.endsWith("_speed")
									? networkRate
									: 1048576,
					},
				],
			};
		else if (url.pathname.endsWith("/online-history"))
			data = {
				server_id: 1,
				days: Number(url.searchParams.get("days")),
				max_days: guest ? 1 : 7,
				timezone: "Asia/Shanghai",
				window_start: "2024-12-25T00:00:00Z",
				window_end: "2025-01-01T00:00:00Z",
				online_rate: 99.5,
				total_online_seconds: 600000,
				currently_online: true,
				periods: [],
				daily: [{ date: "2024-12-31", online_seconds: 86400 }],
			};
		return Response.json({ success: true, data });
	});
	vi.stubGlobal("fetch", fetchMock);
});

describe("Pulse home and node access", () => {
	it("uses the same configured primary cycle in card totals and detail labels", async () => {
		cycleStats = {
			...cycle,
			quarter: {
				...cycle.month,
				name: "季度",
				max: 2 * 1024 ** 4,
				transfer: { "1": 1024 ** 4 },
			},
		};
		window.PulsePrimaryCycleIds = { "1": "quarter" };
		view(
			<>
				<PulseHome />
				<TrafficSummary id={1} stats={cycleStats} incoming={0} outgoing={0} />
			</>,
		);
		await screen.findByText("1/2 节点 · 额度 2.00 TiB");
		const card = screen.getByRole("article", { name: "edge-1" });
		expect(within(card).getByText(/1\.00 TiB \/ 2\.00 TiB/)).toBeVisible();
		expect(screen.getByText("季度 · 主规则")).toBeVisible();
		expect(screen.getAllByRole("heading", { name: "周期流量" })).toHaveLength(
			2,
		);
	});
	it("treats an open but stalled socket as stale and provides manual recovery", async () => {
		socket.dataStale = true;
		socket.lastUpdated = now;
		view(
			<>
				<ThemeProvider>
					<PulseHeader />
				</ThemeProvider>
				<PulseHome />
			</>,
		);
		await screen.findByText("数据已过期，正在重新连接。");
		expect(screen.getByRole("article", { name: /edge/ })).toHaveTextContent(
			"待更新",
		);
		expect(
			screen.queryByRole("button", { name: "实时连接正常" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "数据已过期，点击重新连接" }),
		);
		expect(socket.reconnect).toHaveBeenCalledOnce();
	});
	it("opens the node from content anywhere inside its card", async () => {
		view(
			<Routes>
				<Route path="/" element={<PulseHome />} />
				<Route path="/server/1" element={<h1>节点详情</h1>} />
			</Routes>,
		);
		const card = await screen.findByRole("article", { name: "edge-1" });
		await userEvent.click(within(card).getByText("CPU"));
		await screen.findByRole("heading", { name: "节点详情" });
	});
	it("renders real zero values, derived totals and group filters", async () => {
		const user = userEvent.setup();
		view(<PulseHome />);
		await waitFor(() =>
			expect(screen.getAllByText("周期流量")).toHaveLength(1),
		);
		expect(screen.getAllByRole("article")).toHaveLength(2);
		const card = screen.getByRole("article", { name: "edge-1" });
		expect(within(card).getAllByText("0.0")).toHaveLength(4);
		expect(within(card).getByText("0 B / 200 B")).toBeVisible();
		expect(screen.getByText("1/2 节点 · 额度 1.00 TiB")).toBeVisible();
		const unmetered = screen.getByRole("article", { name: "offline-node" });
		expect(unmetered).toHaveTextContent("等待节点上报");
		expect(within(unmetered).getByText("累计流量")).toBeVisible();
		expect(within(unmetered).getByText("上传与下载合计")).toBeVisible();
		expect(within(unmetered).queryByText("周期流量")).not.toBeInTheDocument();
		expect(within(unmetered).queryByText(/TiB/)).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "日本1" }));
		expect(screen.getAllByRole("article")).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: "全部节点2" }));
		expect(screen.getAllByRole("article")).toHaveLength(2);
	});
	it("filters search and offline status and switches card/list layout", async () => {
		const user = userEvent.setup();
		const { container } = view(<PulseHome />);
		const search = screen.getByRole("searchbox");
		await user.click(search);
		await user.paste("edge");
		expect(screen.getAllByRole("article")).toHaveLength(1);
		await user.clear(search);
		await user.click(screen.getByRole("button", { name: "列表布局" }));
		expect(container.querySelector(".orb-nodes")).toHaveClass("is-list");
		await user.click(screen.getByRole("button", { name: "卡片布局" }));
		expect(container.querySelector(".orb-nodes")).not.toHaveClass("is-list");
		await user.click(screen.getByRole("button", { name: /离线1/ }));
		expect(screen.getAllByRole("article")).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: /离线1/ }));
		await user.click(search);
		await user.paste("nothing-found");
		expect(screen.getByText("没有符合条件的节点")).toBeVisible();
	});
	it("supports country selection and bounded card pagination", async () => {
		socket.lastData = {
			now,
			servers: Array.from({ length: 25 }, (_, i) =>
				createServer({
					id: i + 1,
					name: `node-${i}`,
					country_code: i ? "jp" : "us",
				}),
			),
		};
		const user = userEvent.setup();
		view(<PulseHome />);
		expect(screen.getAllByRole("article")).toHaveLength(24);
		await user.click(screen.getByRole("button", { name: /加载更多/ }));
		expect(screen.getAllByRole("article")).toHaveLength(25);
		await user.click(screen.getByRole("button", { name: "🇺🇸 美国 1" }));
		expect(screen.getAllByRole("article")).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: "美国 ×" }));
		expect(screen.getAllByRole("article")).toHaveLength(25);
		await user.click(screen.getByRole("button", { name: "🇺🇸 美国 1" }));
		await user.click(screen.getByRole("button", { name: "🇺🇸 美国 1" }));
		expect(screen.getAllByRole("article")).toHaveLength(25);
	});
	it("distinguishes loading, permission/connection failure and an empty visible list", async () => {
		const a = view(<PulseHome configurationLoading />);
		expect(screen.getByText("正在加载面板配置…")).toBeVisible();
		a.unmount();
		const b = view(<PulseHome backendError={new Error("bad")} />);
		expect(screen.getByRole("alert")).toHaveTextContent("暂时无法读取面板配置");
		b.unmount();
		socket.lastData = null;
		socket.connected = false;
		const c = view(<PulseHome />);
		await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
		expect(socket.reconnect).toHaveBeenCalled();
		c.unmount();
		socket.connected = true;
		const d = view(<PulseHome />);
		expect(screen.getByText("正在等待节点数据…")).toBeVisible();
		d.unmount();
		socket.lastData = { now, servers: [] };
		view(<PulseHome />);
		expect(screen.getByText("暂无可见节点")).toBeVisible();
	});
	it("shows independent data errors and recovers, with stale nodes explicitly marked", async () => {
		fail = ["/server-group", "/service"];
		socket.connected = false;
		view(<PulseHome />);
		await screen.findByText("部分分组或流量信息未能加载。");
		expect(
			screen.getByText("连接已中断，正在显示最后收到的数据。"),
		).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "重新连接" }));
		expect(socket.reconnect).toHaveBeenCalled();
		fail = [];
		await userEvent.click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() =>
			expect(
				screen.queryByText("部分分组或流量信息未能加载。"),
			).not.toBeInTheDocument(),
		);
	});
	it("renders missing host/state safely and monitors without fabricated measurements", async () => {
		socket.lastData = {
			now,
			servers: [
				{
					...server,
					host: undefined,
					state: undefined,
					country_code: "",
					public_note: "<img src=x onerror=alert(1)>",
				} as unknown as typeof server,
			],
		};
		emptyMonitor = true;
		view(<PulseHome />);
		await screen.findByText("暂无网络监控");
		expect(screen.getByText("型号未上报")).toBeVisible();
		expect(screen.getByRole("article")).not.toHaveTextContent("NaN");
	});
});

describe("Pulse historical charts", () => {
	it.each([
		[512, "B/s"],
		[2048, "KiB/s"],
		[1048576, "MiB/s"],
	] as const)("keeps small network rates readable with the matching unit (%i bytes/s)", async (rate, unit) => {
		networkRate = rate;
		view(<ResourceCharts server={server} range={6} now={now} tsdb />);
		await screen.findByRole("img", { name: "下行、上行趋势图，最近 6 小时" });
		expect(screen.getByRole("heading", { name: /网络速率/ })).toHaveTextContent(
			unit,
		);
	});
	it("selects 1h, 6h and 24h without inventing API period values", async () => {
		const onChange = vi.fn();
		view(<RangePicker value={6} onChange={onChange} />);
		for (const h of [1, 6, 24])
			await userEvent.click(screen.getByRole("button", { name: `${h}h` }));
		expect(onChange.mock.calls.map((c) => c[0])).toEqual([1, 6, 24]);
	});
	it("handles empty plots and missing series", () => {
		const v = view(
			<Plot
				points={[]}
				series={[{ key: "v0", name: "CPU", color: "red" }]}
				range={1}
				now={now}
				unit="%"
			/>,
		);
		expect(screen.getByText("所选时段暂无采样数据")).toBeVisible();
		v.rerender(<Plot points={[]} series={[]} range={1} now={now} unit="%" />);
		expect(screen.getByText("点击上方图例显示曲线")).toBeVisible();
	});
	it("fetches stored metrics once for the day, converts units and toggles every resource", async () => {
		view(<ResourceCharts server={server} range={6} now={now} tsdb />);
		await screen.findByRole("img", {
			name: "CPU趋势图，最近 6 小时",
		});
		expect(screen.getAllByText("最近采样")).toHaveLength(4);
		for (const sample of document.querySelectorAll(".pulse-sample-time time"))
			expect(sample).toHaveAttribute("datetime", new Date(now).toISOString());
		expect(
			fetchMock.mock.calls.filter((c) => String(c[0]).includes("/metrics")),
		).toHaveLength(5);
		expect(
			fetchMock.mock.calls
				.filter((c) => String(c[0]).includes("/metrics"))
				.every((c) => String(c[0]).includes("period=1d")),
		).toBe(true);
		for (const label of ["CPU", "内存", "磁盘"])
			await userEvent.click(screen.getByRole("button", { name: label }));
		expect(screen.getAllByText("点击上方图例显示曲线")).toHaveLength(3);
		await userEvent.click(screen.getByRole("button", { name: "CPU" }));
		expect(
			screen.getByRole("img", { name: "CPU趋势图，最近 6 小时" }),
		).toBeVisible();
	});
	it("uses only bounded session samples with TSDB off and handles stored-metric errors", async () => {
		const v = view(
			<ResourceCharts server={server} range={1} now={now} tsdb={false} />,
		);
		expect(
			screen.getAllByText("实时采样 · 本次访问记录，历史存储未开启"),
		).toHaveLength(4);
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes("/metrics")),
		).toBe(false);
		v.unmount();
		fail = ["/metrics"];
		view(<ResourceCharts server={server} range={6} now={now} tsdb />);
		await screen.findAllByText("历史数据加载失败");
		fail = [];
		await userEvent.click(screen.getAllByRole("button", { name: "重试" })[0]);
		await screen.findByRole("img", {
			name: "CPU趋势图，最近 6 小时",
		});
	});
	it("shows real network loss, toggles matching curves/areas, cuts peaks and isolates a line", async () => {
		view(<NetworkMonitor id={1} range={6} now={now} onRange={vi.fn()} />);
		await screen.findByRole("img", { name: "电信、移动趋势图，最近 6 小时" });
		expect(document.querySelector(".pulse-sample-time time")).toHaveAttribute(
			"datetime",
			new Date(now).toISOString(),
		);
		expect(screen.getAllByText("1.0%")).toHaveLength(2);
		await userEvent.click(screen.getByRole("button", { name: "电信1.0%" }));
		expect(
			screen.getByRole("img", { name: "移动趋势图，最近 6 小时" }),
		).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "仅看电信" }));
		expect(
			screen.getByRole("img", { name: "电信趋势图，最近 6 小时" }),
		).toBeVisible();
		await userEvent.click(screen.getByRole("checkbox", { name: "Peak cut" }));
		expect(screen.getByText(/已裁去高于/)).toBeVisible();
		await userEvent.click(
			within(screen.getAllByRole("row")[1]).getByRole("button", {
				name: "电信",
			}),
		);
		expect(screen.getByText("点击上方图例显示曲线")).toBeVisible();
	});
	it("recovers a failed network request and keeps an empty monitor distinct", async () => {
		fail = ["/service"];
		const v = view(
			<NetworkMonitor id={1} range={6} now={now} onRange={vi.fn()} />,
		);
		await screen.findByText("网络监控加载失败");
		fail = [];
		await userEvent.click(screen.getByRole("button", { name: "重试" }));
		await screen.findByRole("table");
		v.unmount();
		emptyMonitor = true;
		view(<NetworkMonitor id={99} range={24} now={now} onRange={vi.fn()} />);
		await screen.findByText("暂无网络监控任务");
	});
});

describe("Pulse single-page detail", () => {
	it("renders all metrics, charts and summaries together, with no tabs or node selector", async () => {
		window.scrollTo = vi.fn();
		view(
			<Routes>
				<Route path="/server/:id" element={<PulseDetail />} />
			</Routes>,
			"/server/1",
		);
		await screen.findByText("在线率");
		expect(screen.getByRole("link", { name: "返回总览" })).toHaveAttribute(
			"href",
			"/",
		);
		expect(screen.queryByRole("tab")).not.toBeInTheDocument();
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		expect(screen.getByText("交换空间")).toBeVisible();
		expect(screen.getByText("进程")).toBeVisible();
		expect(screen.getByText("累计流量")).toBeVisible();
		expect(screen.getByText("周期流量")).toBeVisible();
		await userEvent.click(screen.getAllByRole("button", { name: "24h" })[0]);
		await screen.findByRole("img", {
			name: "CPU趋势图，最近 24 小时",
		});
	});
	it("does not reveal a nonexistent or invisible node and displays offline status", async () => {
		const v = view(
			<Routes>
				<Route path="/server/:id" element={<PulseDetail />} />
			</Routes>,
			"/server/999",
		);
		expect(screen.getByText("节点不存在，或当前账号无权查看")).toBeVisible();
		v.unmount();
		view(
			<Routes>
				<Route path="/server/:id" element={<PulseDetail />} />
			</Routes>,
			"/server/2",
		);
		expect(screen.getByText("离线")).toBeVisible();
		expect(screen.getByText(/最后上报/)).toBeVisible();
		expect(screen.queryByText("99.0%")).not.toBeInTheDocument();
	});
	it("treats notes as plain text and missing hardware as unknown, with no fake uptime", async () => {
		socket.lastData = {
			now,
			servers: [
				{
					...server,
					host: undefined,
					state: undefined,
					public_note: "<img src=x onerror=alert(1)>",
				} as unknown as typeof server,
			],
		};
		const { container } = view(
			<Routes>
				<Route path="/server/:id" element={<PulseDetail />} />
			</Routes>,
			"/server/1",
		);
		expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
		expect(container.querySelector(".pulse-public-note img")).toBeNull();
		expect(screen.getByText("启动时间未知")).toBeVisible();
	});
	it("uses one-day online history for guests and seven days for a confirmed member", async () => {
		guest = true;
		const v = view(<OnlineSummary id={1} />);
		await screen.findByText("访客可查看 1 天");
		expect(
			fetchMock.mock.calls.some(
				(c) => c[0] === "/api/v1/server/1/online-history?days=1",
			),
		).toBe(true);
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes("days=7")),
		).toBe(false);
		v.unmount();
		guest = false;
		view(<OnlineSummary id={2} />);
		await screen.findByText("面板在线历史");
		expect(
			fetchMock.mock.calls.some(
				(c) => c[0] === "/api/v1/server/2/online-history?days=7",
			),
		).toBe(true);
	});
	it("retries online failures and supports missing cycle rules", async () => {
		fail = ["/online-history"];
		view(<OnlineSummary id={1} />);
		await screen.findByText("在线记录加载失败");
		fail = [];
		await userEvent.click(screen.getByRole("button", { name: "重试" }));
		await screen.findByText("在线率");
		view(<TrafficSummary id={10} incoming={null} outgoing={null} />);
		expect(
			screen.queryByRole("heading", { name: "周期流量" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "累计流量" })).toBeVisible();
	});
});

describe("Pulse branding and header", () => {
	it("keeps Pulse branding with theme, reconnect and dashboard actions", async () => {
		const { container } = view(
			<ThemeProvider>
				<PulseHeader />
				<PulseFooter />
			</ThemeProvider>,
		);
		await screen.findByRole("link", { name: "控制台" });
		expect(screen.queryByText("哪吒监控")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "切换深浅色" }));
		expect(document.documentElement).toHaveClass("dark");
		await userEvent.click(screen.getByRole("button", { name: "切换深浅色" }));
		expect(document.documentElement).toHaveClass("light");
		await userEvent.click(screen.getByRole("button", { name: "刷新连接" }));
		expect(socket.reconnect).toHaveBeenCalled();
		await act(async () => {
			window.CustomLogo = "/pulse.svg";
			refreshRuntimeConfig();
		});
		expect(container.querySelector("img")).toHaveAttribute("src", "/pulse.svg");
	});
});
