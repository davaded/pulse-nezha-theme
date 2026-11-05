import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PulseDetailAccess } from "@/features/pulse/Access";
import { usePulseMonitor } from "@/features/pulse/data";
import { renderWithProviders } from "./utils";

const fetchMock = vi.fn();
function PrivateDetail() {
	usePulseMonitor(42);
	const location = useLocation();
	return <div>private detail {location.pathname}</div>;
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

describe("Pulse detail login boundary", () => {
	it("blocks a guest deep link before mounting detail or requesting its history", async () => {
		fetchMock.mockResolvedValue(
			Response.json({ success: false }, { status: 401 }),
		);
		renderWithProviders(
			<PulseDetailAccess>
				<PrivateDetail />
			</PulseDetailAccess>,
			{ route: "/server/42" },
		);
		await screen.findByRole("heading", { name: "登录后查看节点详情" });
		expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			"/api/v1/profile",
		]);
		expect(screen.getByRole("link", { name: "登录账号" })).toHaveAttribute(
			"href",
			"/dashboard/",
		);
		expect(screen.getByRole("link", { name: "登录账号" })).toHaveAttribute(
			"target",
			"_blank",
		);
		expect(screen.getByRole("link", { name: "返回总览" })).toHaveAttribute(
			"href",
			"/",
		);
	});

	it("rechecks the actual profile and continues on the requested node after login", async () => {
		let signedIn = false;
		fetchMock.mockImplementation(async (url: string) =>
			url.endsWith("/profile")
				? signedIn
					? Response.json({ success: true, data: { id: 7 } })
					: Response.json({ success: false }, { status: 401 })
				: Response.json({ success: true, data: [] }),
		);
		renderWithProviders(
			<PulseDetailAccess>
				<PrivateDetail />
			</PulseDetailAccess>,
			{ route: "/server/42" },
		);
		await screen.findByRole("heading", { name: "登录后查看节点详情" });
		signedIn = true;
		await userEvent.click(screen.getByRole("button", { name: "检查登录" }));
		await screen.findByText("private detail /server/42");
		expect(
			fetchMock.mock.calls.some(([url]) =>
				String(url).includes("/server/42/service"),
			),
		).toBe(true);
	});

	it("waits for the profile, supports retry, and removes detail when the session expires", async () => {
		let finish: (response: Response) => void = () => {};
		fetchMock.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		);
		const { queryClient } = renderWithProviders(
			<PulseDetailAccess>
				<span>private detail</span>
			</PulseDetailAccess>,
		);
		expect(screen.getByRole("status")).toHaveTextContent("正在确认登录状态");
		await act(async () => {
			finish(new Response("unavailable", { status: 503 }));
		});
		await screen.findByRole("alert");
		fetchMock.mockResolvedValue(
			Response.json({ success: true, data: { id: 1 } }),
		);
		await userEvent.click(screen.getByRole("button", { name: "检查登录" }));
		await screen.findByText("private detail");
		act(() => {
			queryClient.setQueryData(["login-user"], null);
		});
		await screen.findByRole("heading", { name: "登录后查看节点详情" });
		expect(screen.queryByText("private detail")).not.toBeInTheDocument();
	});
});
