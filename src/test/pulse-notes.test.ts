import { describe, expect, it } from "vitest";
import { readNote } from "@/features/pulse/notes";

describe("Pulse public-note compatibility", () => {
	it("keeps ordinary text and malformed metadata as text", () => {
		for (const value of [
			"<script>alert(1)</script>",
			"not json",
			"null",
			"[]",
			"{}",
			'{"planDataMod":"invalid"}',
			'{"billingDataMod":[]}',
			'{"other":"value"}',
		])
			expect(readNote(value, 0)).toEqual({ text: value, chips: [] });
		expect(readNote(undefined, 0)).toEqual({ text: "", chips: [] });
	});
	it("uses only validated plan strings and the actual supplied expiry date", () => {
		const note = JSON.stringify({
			planDataMod: {
				bandwidth: "1 Gbps",
				trafficVol: "1 TiB",
				IPv4: "1",
				IPv6: "1",
				networkRoute: "CN2",
				extra: "ordinary note",
			},
			billingDataMod: { endDate: "2025-01-15" },
		});
		const result = readNote(note, Date.parse("2025-01-01"));
		expect(result.chips).toEqual([
			"1 Gbps",
			"1 TiB",
			"IPv4 1",
			"IPv6 1",
			"CN2",
		]);
		expect(result.text).toBe("ordinary note");
		expect(result.daysLeft).toBe(14);
		expect(result.expires).toContain("2025");
		expect(
			readNote('{"billingDataMod":{"endDate":"0000-00-00"}}', 0).expires,
		).toBe("长期有效");
		expect(
			readNote(
				'{"planDataMod":{"bandwidth":{},"IPv4":0,"IPv6":false},"billingDataMod":{"endDate":"bad"}}',
				0,
			),
		).toEqual({ text: "", chips: [] });
	});
});
