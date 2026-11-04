import { geoEqualEarth } from "d3-geo";
import { useEffect, useRef, useState } from "react";
import { countryCoordinates } from "@/lib/geo-limit";
import type { NezhaWebsocketResponse } from "@/types/nezha-api";
import points from "./map-points.json";
import { countryCode, countryName, flag, isOnline } from "./model";

const projection = geoEqualEarth().fitExtent(
	[
		[15, 18],
		[985, 445],
	],
	{ type: "MultiPoint", coordinates: points },
);
const dots = points.map((p) => projection(p as [number, number]));

export function PulseMap({
	data,
	selected,
	onSelect,
}: {
	data: NezhaWebsocketResponse;
	selected: string;
	onSelect: (code: string) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 1000, height: 480 });
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () =>
			setSize({ width: element.clientWidth, height: element.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const scale = Math.min(size.width / 1000, size.height / 480);
	const countries = [...new Set(data.servers.map(countryCode))].filter(
		(c) => countryCoordinates[c],
	);
	return (
		<div className="orb-world" ref={ref}>
			<svg
				viewBox="0 0 1000 480"
				role="img"
				aria-label="平面世界地图，标记为国家或地区的大致位置"
				className="pulse-map"
			>
				<g fill="var(--orb-map)" opacity=".68">
					{dots.map(
						(p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="1.35" />,
					)}
				</g>
			</svg>
			<div className="orb-maplabels">
				{countries.map((code, index) => {
					const coord = countryCoordinates[code],
						p = projection([coord.lng, coord.lat]) as [number, number];
					const nodes = data.servers.filter((s) => countryCode(s) === code),
						online = nodes.some((s) => isOnline(s, data.now));
					return (
						<button
							type="button"
							key={code}
							className={`orb-mapnode ${online ? "" : "bad"} ${index < 3 || selected === code ? "is-labelled" : ""}`}
							style={{
								left: (size.width - 1000 * scale) / 2 + p[0] * scale,
								top: (size.height - 480 * scale) / 2 + p[1] * scale,
							}}
							aria-label={`${flag(code)} ${countryName(code)} ${nodes.length}`}
							aria-pressed={selected === code}
							onClick={() => onSelect(selected === code ? "" : code)}
						>
							<span className="pulse-map-label">
								{flag(code)} {countryName(code)} <b>{nodes.length}</b>
							</span>
						</button>
					);
				})}
			</div>
			<div className="orb-mapcaption">
				<span>
					<i />
					在线
				</span>
				<span>
					<i className="orb-off" />
					离线
				</span>
				<span>国家 / 地区分布</span>
			</div>
		</div>
	);
}
