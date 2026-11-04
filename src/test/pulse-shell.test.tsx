import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PulseApp, { PulseShell } from "@/features/pulse/App";
import { createSettingResponse } from "@/test/fixtures";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";

const injection = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/inject", () => ({ InjectContext: injection.run }));
vi.mock("@/features/pulse/Home", () => ({
	default: ({
		configurationLoading,
		backendError,
	}: {
		configurationLoading: boolean;
		backendError?: Error;
	}) => (
		<div>
			{configurationLoading
				? "configuration pending"
				: backendError
					? "configuration failed"
					: "home ready"}
		</div>
	),
	PulseState: ({ text }: { text: string }) => <div>{text}</div>,
}));
vi.mock("@/features/pulse/Detail", () => ({
	default: () => <div>single-page detail</div>,
}));
beforeEach(() => {
	injection.run.mockReset().mockResolvedValue(vi.fn());
	window.ForceTheme = undefined;
	window.CustomBackgroundImage = "";
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) =>
			Response.json(
				input.endsWith("setting")
					? createSettingResponse()
					: { success: true, data: { id: 1 } },
			),
		),
	);
});

describe("Pulse settings bootstrap and routes", () => {
	it("waits for custom-code initialization, applies the site title and cleans up", async () => {
		let finish: (cleanup: () => void) => void = () => {};
		const cleanup = vi.fn();
		injection.run.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const v = renderWithProviders(<PulseShell />);
		await waitFor(() => expect(injection.run).toHaveBeenCalled());
		expect(screen.getByText("configuration pending")).toBeVisible();
		finish(cleanup);
		await screen.findByText("home ready");
		expect(document.title).toBe("Nezha · Pulse");
		v.unmount();
		expect(cleanup).toHaveBeenCalled();
	});
	it("renders configuration failures and custom-code failures separately", async () => {
		injection.run.mockRejectedValue(new Error("script failed"));
		renderWithProviders(<PulseShell />);
		await screen.findByText("面板自定义代码加载失败：script failed");
		expect(screen.getByText("home ready")).toBeVisible();
	});
	it("uses existing server paths for deep links and handles unknown routes", async () => {
		const a = renderWithProviders(<PulseShell />, { route: "/server/20" });
		await screen.findByText("single-page detail");
		a.unmount();
		renderWithProviders(<PulseShell />, { route: "/unknown" });
		await screen.findByText("页面不存在");
	});
	it("can mount at the root with the production router and default branding", async () => {
		window.history.replaceState(null, "", "/");
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string) =>
				Response.json(
					input.endsWith("setting")
						? {
								...createSettingResponse(),
								data: {
									...createSettingResponse().data,
									config: {
										...createSettingResponse().data.config,
										site_name: "",
									},
								},
							}
						: { success: true, data: { id: 1 } },
				),
			),
		);
		render(
			<QueryClientProvider client={createTestQueryClient()}>
				<PulseApp />
			</QueryClientProvider>,
		);
		await screen.findByText("home ready");
		expect(document.title).toBe("Pulse");
	});
	it("aborts initialization safely while navigation unmounts the shell", async () => {
		let finish: (cleanup: () => void) => void = () => {};
		let signal: AbortSignal | undefined;
		injection.run.mockImplementation(
			(_code: string, options: { signal: AbortSignal }) => {
				signal = options.signal;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		);
		const v = renderWithProviders(<PulseShell />);
		await waitFor(() => expect(injection.run).toHaveBeenCalled());
		v.unmount();
		expect(signal?.aborted).toBe(true);
		const cleanup = vi.fn();
		finish(cleanup);
		await waitFor(() => expect(cleanup).toHaveBeenCalled());
	});
});
