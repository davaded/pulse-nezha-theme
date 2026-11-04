import { describe, expect, it } from "vitest";
import { realtimePoints } from "@/features/pulse/Charts";
import {
	bytes,
	countryCode,
	countryName,
	cyclesFor,
	duration,
	fixed,
	flag,
	inRange,
	isOnline,
	joinMetrics,
	monitorSeries,
	number,
	peakLimit,
	percent,
	probeStats,
	timestamp,
	totals,
} from "@/features/pulse/model";
import { createServer } from "@/test/fixtures";
import type { CycleTransferStats, NezhaMonitor } from "@/types/nezha-api";

const now = Date.parse("2025-01-01T00:00:00Z");
const server = createServer();
const cycles: CycleTransferStats = {
	month: {
		name: "月度",
		from: "2025-01-01",
		to: "2025-02-01",
		max: 100,
		min: 0,
		server_name: { "1": "edge-1" },
		transfer: { "1": 0 },
		next_update: { "1": "2025-02-01" },
	},
	custom: {
		name: "自定义",
		from: { "1": "2025-01-02" },
		to: { "1": "2025-02-02" },
		max: { "1": 200 },
		min: 0,
		server_name: { "1": "edge-1" },
		transfer: { "1": 50 },
		next_update: { "1": "2025-02-02" },
	},
};

describe("Pulse actual-data projections", () => {
	it("preserves zero and rejects missing, negative and nonfinite measurements", () => {
		for (const value of [undefined, null, "0", NaN, Infinity, -1]) {
			expect(number(value)).toBeNull();
			expect(bytes(value)).toBe("—");
		}
		expect(number(0)).toBe(0);
		expect(bytes(0)).toBe("0 B");
		expect(bytes(0.5)).toBe("1 B");
		expect(bytes(1048576, true)).toBe("1.00 MiB/s");
		expect(bytes(1024 ** 6)).toBe("1024.00 PiB");
		expect(percent(0, 100)).toBe(0);
		expect(percent(1, 0)).toBeNull();
		expect(percent(undefined, 100)).toBeNull();
		expect(fixed(0)).toBe("0.0");
		expect(fixed(null)).toBe("—");
		expect(duration(null)).toBe("—");
		expect(duration(0)).toBe("0 时 0 分");
		expect(duration(90000)).toBe("1 天 1 时");
	});
	it("uses server time for liveness and never treats an invalid date as online", () => {
		expect(isOnline(server, now)).toBe(true);
		expect(isOnline(server, now + 30001)).toBe(false);
		expect(isOnline(server, now - 30001)).toBe(false);
		expect(
			isOnline(createServer({ last_active: "0001-01-01T00:00:00Z" }), now),
		).toBe(false);
		expect(timestamp(undefined)).toBeNaN();
		expect(timestamp("bad")).toBeNaN();
		expect(countryCode(server)).toBe("US");
		expect(countryCode(createServer({ country_code: "<script>" }))).toBe("");
		expect(flag("US")).toBe("🇺🇸");
		expect(flag("")).toBe("◌");
		expect(countryName("US")).toBe("美国");
		expect(countryName("")).toBeTruthy();
	});
	it("supports scalar and per-server cycle rules without inventing missing transfer", () => {
		expect(cyclesFor(cycles, 1)).toEqual([
			{
				key: "month",
				name: "月度",
				from: "2025-01-01",
				to: "2025-02-01",
				max: 100,
				used: 0,
				reset: "2025-02-01",
			},
			{
				key: "custom",
				name: "自定义",
				from: "2025-01-02",
				to: "2025-02-02",
				max: 200,
				used: 50,
				reset: "2025-02-02",
			},
		]);
		expect(cyclesFor(cycles, 2)).toEqual([]);
		expect(cyclesFor(undefined, 1)).toEqual([]);
		const missing = {
			bad: { ...cycles.month, transfer: undefined, server_name: undefined },
		} as unknown as CycleTransferStats;
		expect(cyclesFor(missing, 1)).toEqual([]);
		expect(
			cyclesFor({ bad: { ...cycles.month, transfer: {} } }, 1)[0].used,
		).toBeNull();
	});
	it("aggregates visible nodes only, excludes offline capacity, and retains unknown totals", () => {
		const offline = createServer({
			id: 2,
			last_active: "2024-12-31T00:00:00Z",
			state: { cpu: 99, net_in_speed: 99999 },
		});
		const t = totals({ now, servers: [server, offline] }, cycles);
		expect(t.online).toBe(1);
		expect(t.cpu).toBe(12);
		expect(t.memoryTotal).toBe(200);
		expect(t.down).toBe(1048576);
		expect(t.transfer).toBe(6 * 1024 ** 3);
		expect(t.cycleUsed).toBe(50);
		expect(t.cycleMax).toBe(300);
		expect(totals({ now, servers: [] }).cpu).toBeNull();
		expect(
			totals({
				now,
				servers: [createServer({ state: { mem_used: undefined } })],
			}).memory,
		).toBeNull();
	});
	it("joins exact timestamps, keeps gaps and zero, and bounds ranges at both ends", () => {
		const joined = joinMetrics(
			[
				[
					{ ts: now, value: 0 },
					{ ts: now - 1, value: 10 },
					{ ts: now, value: 5 },
					{ ts: NaN, value: 4 },
				],
				[
					{ ts: now - 1, value: 0 },
					{ ts: now - 2, value: NaN },
				],
			],
			[(v) => v, (v) => v * 2],
		);
		expect(joined).toEqual([
			{ ts: now - 2, v1: null },
			{ ts: now - 1, v0: 10, v1: 0 },
			{ ts: now, v0: 5 },
		]);
		expect(
			inRange(
				[
					{ ts: now - 3600000, v0: 0 },
					{ ts: now - 3600001, v0: 1 },
					{ ts: now + 1, v0: 1 },
				],
				1,
				now,
			),
		).toEqual([{ ts: now - 3600000, v0: 0 }]);
	});
	it("uses real loss arrays, preserves timeouts and never estimates loss from delay", () => {
		const monitors: NezhaMonitor[] = [
			{
				monitor_id: 1,
				monitor_name: "电信",
				server_id: 1,
				server_name: "edge",
				created_at: [now / 1000 - 1, now / 1000],
				avg_delay: [0, null],
				packet_loss: [0, 100],
			},
			{
				monitor_id: 2,
				monitor_name: "移动",
				server_id: 1,
				server_name: "edge",
				created_at: [now, NaN],
				avg_delay: [40, 99],
			},
		];
		const result = monitorSeries(monitors);
		expect(result.points).toEqual([
			{ ts: now - 1000, v0: 0, v0loss: 0 },
			{ ts: now, v0: null, v0loss: 100, v1: 40, v1loss: null },
		]);
		expect(probeStats(result.points, "v0")).toEqual({
			current: null,
			average: 0,
			jitter: 0,
			loss: 50,
		});
		expect(probeStats(result.points, "v1")).toEqual({
			current: 40,
			average: 40,
			jitter: 0,
			loss: null,
		});
		expect(probeStats([], "v0")).toEqual({
			current: null,
			average: null,
			jitter: null,
			loss: null,
		});
		expect(peakLimit([], [])).toBe(1);
		expect(peakLimit(result.points, ["v1"])).toBe(50);
	});
	it("converts realtime bytes exactly once and drops missing/offline snapshots", () => {
		const p = realtimePoints(
			[
				{
					now,
					servers: [
						createServer({
							state: { cpu: 0, mem_used: 0, net_in_speed: 1048576 },
						}),
					],
				},
				{ now: now - 1000, servers: [] },
				{ now: now + 60000, servers: [server] },
			],
			server,
		);
		expect(p).toEqual([{ ts: now, v0: 0, v1: 0, v2: 25, v3: 1, v4: 2 }]);
		const unknown = createServer({
			state: {
				cpu: undefined,
				mem_used: undefined,
				disk_used: undefined,
				net_in_speed: undefined,
				net_out_speed: undefined,
			},
		});
		expect(realtimePoints([{ now, servers: [unknown] }], server)).toEqual([]);
	});
});
