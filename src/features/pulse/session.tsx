import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { WebSocketProvider } from "@/context/websocket-provider";
import { useLoginUser } from "@/hooks/use-login-user";

export function clearPulseNotes() {
	try {
		for (const key of Object.keys(sessionStorage)) {
			if (/^server_\d+_public_note$/.test(key) || key === "public_note_cache")
				sessionStorage.removeItem(key);
		}
	} catch {
		/* Storage is optional in private browsing. */
	}
}

/** Never mount a socket or expose cached node data under a different identity. */
export function PulseSession({ children }: { children: ReactNode }) {
	const login = useLoginUser();
	const client = useQueryClient();
	const next =
		login.authStatus === "unknown"
			? null
			: login.data?.data?.id
				? `user:${login.data.data.id}`
				: "guest";
	const [scope, setScope] = useState<string | null>(null);
	useEffect(() => {
		if (next === null || next === scope) return;
		const privateQueries = {
			predicate: (q: { queryKey: readonly unknown[] }) =>
				!["setting", "login-user"].includes(String(q.queryKey[0])),
		};
		void client.cancelQueries(privateQueries);
		client.removeQueries(privateQueries);
		clearPulseNotes();
		setScope(next);
	}, [next, scope, client]);
	if (next === null || scope !== next)
		return (
			<div className="pulse-session" role="status">
				正在确认访问权限…
				{login.isError && (
					<button type="button" onClick={() => void login.refetch()}>
						重试
					</button>
				)}
			</div>
		);
	return (
		<WebSocketProvider key={scope} url="/api/v1/ws/server">
			{children}
		</WebSocketProvider>
	);
}
