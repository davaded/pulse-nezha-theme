import { useQuery } from "@tanstack/react-query";
import {
	fetchMonitor,
	fetchServerGroup,
	fetchService,
	fetchSetting,
} from "@/lib/nezha-api";

export function usePulseData() {
	const groups = useQuery({
		queryKey: ["server-group"],
		queryFn: ({ signal }) => fetchServerGroup({ signal }),
		retry: false,
	});
	const service = useQuery({
		queryKey: ["service"],
		queryFn: ({ signal }) => fetchService({ signal }),
		refetchInterval: 15000,
		retry: false,
	});
	return { groups, service };
}
export function usePulseSetting() {
	return useQuery({
		queryKey: ["setting"],
		queryFn: ({ signal }) => fetchSetting({ signal }),
		retry: false,
	});
}
export function usePulseMonitor(id: number) {
	return useQuery({
		queryKey: ["pulse-monitor", id, "1d"],
		queryFn: async ({ signal }) => {
			const result = await fetchMonitor(id, "1d", { signal });
			if (
				!Array.isArray(result.data) ||
				result.data.some(
					(m) =>
						!m ||
						typeof m.monitor_id !== "number" ||
						typeof m.monitor_name !== "string" ||
						!Array.isArray(m.created_at) ||
						!Array.isArray(m.avg_delay),
				)
			)
				throw new Error("网络监控返回格式不正确");
			return result.data;
		},
		staleTime: 30000,
		refetchInterval: 60000,
		retry: false,
	});
}
