/** Optional metadata used by Nezha themes. No HTML or unchecked object values. */
export function readNote(note: string | undefined, now: number) {
	const result: {
		text: string;
		chips: string[];
		expires?: string;
		daysLeft?: number;
	} = { text: note ?? "", chips: [] };
	if (!note) return result;
	try {
		const data: unknown = JSON.parse(note);
		if (!data || typeof data !== "object" || Array.isArray(data)) return result;
		const root = data as Record<string, unknown>;
		const record = (value: unknown): Record<string, unknown> =>
			value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: {};
		const text = (value: unknown) =>
			typeof value === "string" ? value.trim() : "";
		const plan = record(root.planDataMod),
			billing = record(root.billingDataMod);
		if (Object.keys(plan).length === 0 && Object.keys(billing).length === 0)
			return result;
		result.chips = [
			text(plan.bandwidth),
			text(plan.trafficVol),
			text(plan.IPv4) ? `IPv4 ${text(plan.IPv4)}` : "",
			text(plan.IPv6) ? `IPv6 ${text(plan.IPv6)}` : "",
			text(plan.networkRoute),
		].filter(Boolean);
		result.text = text(plan.extra);
		const end = text(billing.endDate);
		if (end.startsWith("0000-00-00")) result.expires = "长期有效";
		else if (Number.isFinite(Date.parse(end))) {
			result.expires = `到期 ${new Date(end).toLocaleDateString("zh-CN")}`;
			result.daysLeft = Math.ceil((Date.parse(end) - now) / 86400000);
		}
	} catch {
		/* A normal public note is plain text. */
	}
	return result;
}
