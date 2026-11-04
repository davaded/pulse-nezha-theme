import { Activity, ArrowUpRight, Moon, RefreshCw, Sun } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
	BrowserRouter,
	Link,
	Route,
	Routes,
	useLocation,
} from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import LocalErrorBoundary from "@/components/LocalErrorBoundary";
import { useLoginUser } from "@/hooks/use-login-user";
import { useTheme } from "@/hooks/use-theme";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
import { InjectContext } from "@/lib/inject";
import { refreshRuntimeConfig, useRuntimeConfig } from "@/lib/runtime-config";
import { usePulseSetting } from "./data";
import PulseHome, { PulseState } from "./Home";
import "./pulse.css";

const Detail = lazy(() => import("./Detail"));

export function PulseHeader() {
	const { theme, setTheme } = useTheme();
	const { connected, reconnect } = useWebSocketContext();
	const login = useLoginUser();
	const config = useRuntimeConfig();
	const dark =
		theme === "dark" ||
		(theme === "system" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);
	return (
		<header className="orb-top">
			<Link to="/" aria-label="Pulse 首页" className="pulse-brand">
				<span className="orb-brandmark">
					{config.customLogo ? (
						<img src={config.customLogo} alt="" />
					) : (
						<Activity />
					)}
				</span>
				<span className="orb-word">pulse</span>
			</Link>
			<div className="orb-topright">
				<button
					type="button"
					className={`pulse-connection ${connected ? "" : "is-offline"}`}
					onClick={connected ? undefined : reconnect}
					aria-label={connected ? "实时连接正常" : "重新连接"}
				>
					<i />
					{connected ? "实时连接" : "重新连接"}
				</button>
				<a href="/dashboard/" className="pulse-dashboard">
					{login.isAuthenticated ? "控制台" : "登录"}
					<ArrowUpRight size={13} />
				</a>
				<button
					type="button"
					className="orb-iconbutton"
					onClick={() => setTheme(dark ? "light" : "dark")}
					aria-label="切换深浅色"
				>
					{dark ? <Sun /> : <Moon />}
				</button>
				<button
					type="button"
					className="orb-iconbutton"
					onClick={reconnect}
					aria-label="刷新连接"
				>
					<RefreshCw />
				</button>
			</div>
		</header>
	);
}
export function PulseFooter() {
	return (
		<footer className="orb-footer">
			<span>PULSE</span>
			<span>
				Powered by{" "}
				<a
					href="https://github.com/nezhahq/nezha"
					target="_blank"
					rel="noreferrer"
				>
					Nezha
				</a>
			</span>
		</footer>
	);
}

export function PulseShell() {
	const location = useLocation();
	const setting = usePulseSetting();
	const config = useRuntimeConfig();
	const { setTheme } = useTheme();
	const customCode = setting.data?.data?.config?.custom_code ?? "";
	const [initialization, setInitialization] = useState<{
		code: string;
		ready: boolean;
		error?: string;
	}>({ code: "", ready: false });
	useEffect(() => {
		if (setting.isPending) return;
		const controller = new AbortController();
		let cleanup: (() => void) | undefined;
		setInitialization({ code: customCode, ready: false });
		void InjectContext(customCode, { signal: controller.signal })
			.then((dispose) => {
				cleanup = dispose;
				if (controller.signal.aborted) {
					cleanup?.();
					return;
				}
				refreshRuntimeConfig();
				setInitialization({ code: customCode, ready: true });
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					setInitialization({
						code: customCode,
						ready: true,
						error: error instanceof Error ? error.message : String(error),
					});
			});
		return () => {
			controller.abort();
			cleanup?.();
		};
	}, [customCode, setting.isPending]);
	useEffect(() => {
		if (config.forceTheme) setTheme(config.forceTheme);
	}, [config.forceTheme, setTheme]);
	useEffect(() => {
		document.title = setting.data?.data?.config?.site_name
			? `${setting.data.data.config.site_name} · Pulse`
			: "Pulse";
	}, [setting.data]);
	const loading =
		setting.isPending ||
		initialization.code !== customCode ||
		!initialization.ready;
	const background = config.backgroundImage;
	return (
		<ErrorBoundary>
			<div id="pulse-theme">
				<div
					className={`orb-app ${location.pathname.startsWith("/server/") ? "is-detail" : ""}`}
					style={
						background
							? {
									backgroundImage: `linear-gradient(var(--orb-overlay), var(--orb-overlay)), url(${JSON.stringify(background)})`,
									backgroundSize: "cover",
									backgroundAttachment: "fixed",
								}
							: undefined
					}
				>
					<PulseHeader />
					<main className="orb-main">
						{initialization.error && (
							<div className="pulse-notice" role="alert">
								面板自定义代码加载失败：{initialization.error}
							</div>
						)}
						<LocalErrorBoundary resetKey={location.pathname} allowReload>
							<Suspense fallback={<PulseState text="正在加载节点详情…" />}>
								<Routes>
									<Route
										path="/"
										element={
											<PulseHome
												configurationLoading={loading}
												backendError={setting.error}
											/>
										}
									/>
									<Route
										path="/server/:id"
										element={
											loading ? (
												<PulseState text="正在加载面板配置…" />
											) : (
												<Detail />
											)
										}
									/>
									<Route
										path="*"
										element={<PulseState error text="页面不存在" />}
									/>
								</Routes>
							</Suspense>
						</LocalErrorBoundary>
						<PulseFooter />
					</main>
				</div>
			</div>
		</ErrorBoundary>
	);
}

export default function PulseApp() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<PulseShell />
		</BrowserRouter>
	);
}
