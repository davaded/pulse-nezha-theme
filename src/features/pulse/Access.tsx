import { ArrowLeft, ArrowUpRight, LockKeyhole, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLoginUser } from "@/hooks/use-login-user";

/** Keep the requested node open while the dashboard handles authentication. */
export function PulseDetailAccess({ children }: { children: ReactNode }) {
	const login = useLoginUser();
	if (login.isAuthenticated) return children;
	if (login.authStatus === "unknown" && !login.isError)
		return (
			<div className="pulse-access-loading" role="status">
				正在确认登录状态…
			</div>
		);
	return (
		<div className="pulse-access-page">
			<Link to="/" className="lot-back">
				<ArrowLeft size={15} />
				返回总览
			</Link>
			<section className="pulse-access" aria-labelledby="pulse-access-title">
				<div className="pulse-access-mark">
					<LockKeyhole size={23} strokeWidth={1.6} />
				</div>
				<span className="pulse-eyebrow">MEMBER ACCESS</span>
				<h1 id="pulse-access-title">登录后查看节点详情</h1>
				<p>资源趋势、网络质量与在线记录，在登录后完整呈现。</p>
				<a
					href="/dashboard/"
					target="_blank"
					rel="noopener noreferrer"
					className="pulse-primary-button"
				>
					登录账号 <ArrowUpRight size={16} />
				</a>
				<div className="pulse-access-foot">
					<span>登录完成后，回到此页即可继续</span>
					<button
						type="button"
						onClick={() => void login.refetch()}
						disabled={login.isFetching}
					>
						<RefreshCw size={12} />
						{login.isFetching ? "确认中" : "检查登录"}
					</button>
				</div>
				{login.isError && (
					<p className="pulse-access-error" role="alert">
						暂时无法确认登录状态，请重试。
					</p>
				)}
			</section>
		</div>
	);
}
