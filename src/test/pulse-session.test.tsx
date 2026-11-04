import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPulseNotes, PulseSession } from "@/features/pulse/session";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { createServer } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/utils";

class TestSocket {
	static OPEN = 1;
	static CONNECTING = 0;
	static instances: TestSocket[] = [];
	readyState = 1;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	close = vi.fn(() => {
		this.readyState = 3;
	});
	constructor(public url: string) {
		TestSocket.instances.push(this);
	}
}
function Consumer() {
	const { lastData, messageHistory } = useWebSocketContext();
	return (
		<>
			<div data-testid="visible-nodes">
				{lastData?.servers.map((s) => s.name).join(",") || "waiting"}
			</div>
			<div data-testid="history-count">{messageHistory.length}</div>
		</>
	);
}

beforeEach(() => {
	TestSocket.instances = [];
	vi.stubGlobal("WebSocket", TestSocket);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ success: true, data: { id: 1, username: "admin" } }),
		),
	);
});

describe("Pulse identity isolation", () => {
	it("clears identity-scoped caches and closes the old socket before rendering guest data", async () => {
		const client = createTestQueryClient();
		client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
		client.setQueryData(["setting"], { success: true });
		client.setQueryData(["service"], { private: "old" });
		sessionStorage.setItem("server_1_public_note", "private note");
		sessionStorage.setItem("public_note_cache", "private cache");
		sessionStorage.setItem("theme-choice", "keep");
		render(
			<QueryClientProvider client={client}>
				<PulseSession>
					<Consumer />
				</PulseSession>
			</QueryClientProvider>,
		);
		await waitFor(() => expect(TestSocket.instances).toHaveLength(1));
		expect(client.getQueryData(["service"])).toBeUndefined();
		expect(client.getQueryData(["setting"])).toEqual({ success: true });
		expect(sessionStorage.getItem("server_1_public_note")).toBeNull();
		expect(sessionStorage.getItem("theme-choice")).toBe("keep");
		const old = TestSocket.instances[0];
		await act(async () => {
			old.onopen?.();
			old.onmessage?.({
				data: JSON.stringify({
					now: Date.parse("2025-01-01"),
					servers: [
						createServer({
							name: "private-admin-node",
							public_note: "private",
						}),
					],
				}),
			});
		});
		expect(screen.getByTestId("visible-nodes")).toHaveTextContent(
			"private-admin-node",
		);
		client.setQueryData(["pulse-monitor", 1, "1d"], { private: true });
		client.setQueryData(["server-metrics", 1, "cpu", "1d"], { private: true });
		await act(async () => {
			client.setQueryData(["login-user"], null);
		});
		await waitFor(() => expect(TestSocket.instances).toHaveLength(2));
		expect(old.close).toHaveBeenCalled();
		expect(old.onmessage).toBeNull();
		expect(screen.getByTestId("visible-nodes")).toHaveTextContent("waiting");
		expect(screen.getByTestId("history-count")).toHaveTextContent("0");
		expect(client.getQueryData(["pulse-monitor", 1, "1d"])).toBeUndefined();
		expect(
			client.getQueryData(["server-metrics", 1, "cpu", "1d"]),
		).toBeUndefined();
		expect(sessionStorage.getItem("server_1_public_note")).toBeNull();
		await act(async () => {
			TestSocket.instances[1].onmessage?.({
				data: JSON.stringify({ now: Date.parse("2025-01-01"), servers: [] }),
			});
		});
		expect(screen.queryByText("private-admin-node")).not.toBeInTheDocument();
		await act(async () => {
			client.setQueryData(["login-user"], {
				success: true,
				data: { id: 2, username: "member" },
			});
		});
		await waitFor(() => expect(TestSocket.instances).toHaveLength(3));
	});
	it("keeps unknown authentication distinct from a confirmed guest and allows retry", async () => {
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new Error("network unavailable"))
			.mockResolvedValue(
				Response.json({ success: true, data: { id: 3, username: "member" } }),
			);
		vi.stubGlobal("fetch", fetcher);
		render(
			<QueryClientProvider client={createTestQueryClient()}>
				<PulseSession>
					<Consumer />
				</PulseSession>
			</QueryClientProvider>,
		);
		await screen.findByRole("button", { name: "重试" });
		expect(TestSocket.instances).toHaveLength(0);
		await act(async () => {
			screen.getByRole("button", { name: "重试" }).click();
		});
		await screen.findByTestId("visible-nodes");
		expect(TestSocket.instances).toHaveLength(1);
	});
	it("tolerates disabled session storage", () => {
		const getter = vi
			.spyOn(window, "sessionStorage", "get")
			.mockImplementation(() => {
				throw new Error("blocked");
			});
		expect(() => clearPulseNotes()).not.toThrow();
		getter.mockRestore();
	});
});
