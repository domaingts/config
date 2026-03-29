export default async function (ctx) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const nextRefreshTime = new Date(now.getFullYear(), now.getMonth(), now.getHours(), now.getMinutes() + 5);
    const C = {
        bg: [{ light: '#FFFFFF', dark: '#1C1C1E' }, { light: '#F5F5F9', dark: '#0C0C0E' }],
        main: { light: '#1C1C1E', dark: '#FFFFFF' },
        sub: { light: '#48484A', dark: '#D1D1D6' },
        muted: { light: '#8E8E93', dark: '#8E8E93' },
        gold: { light: '#B58A28', dark: '#D6A53A' },
        red: { light: '#CA3B32', dark: '#FF453A' },
        teal: { light: '#2E8045', dark: '#32D74B' },
        blue: { light: '#3A5F85', dark: '#5E8EB8' },
        purple: { light: '#6B4C9A', dark: '#8B6AA8' },
        cyan: { light: '#628C7B', dark: '#73A491' },
        pingBg: { light: '#F2F2F7', dark: '#2C2C2E' },
    };
    const mkText = (text, size, weight, color, opts = {}) => ({ type: "text", text: text, font: { size, weight, ...(opts.font ?? {}) }, textColor: color, ...opts });
    const mkSimpleText = (text, color, opts = {}) => ({ type: "text", text: text, textColor: color, ...opts });
    const mkIcon = (src, color, size = 13) => ({ type: "image", src: `sf-symbol:${src}`, color: color, width: size, height: size });
    const httpGet = async (url) => {
        try {
            const start = Date.now();
            const resp = await ctx.http.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 });
            const json = await resp.json();
            return { data: json.data || json, ping: Date.now() - start };
        }
        catch (e) {
            return { data: {}, ping: 0 };
        }
    };
    const getFlagEmoji = (cc) => {
        if (!cc)
            return "";
        const str = String(cc).toUpperCase();
        if (!/^[A-Z]{2}$/.test(str))
            return "";
        return String.fromCodePoint(...[...str].map(c => 127397 + c.charCodeAt(0)));
    };
    const fmtISP = (isp) => {
        if (!isp)
            return "未知";
        const s = String(isp).toLowerCase();
        const raw = String(isp).replace(/\s*[\(\（]中国[\)\）]\s*/, "").replace(/\s+/g, " ").trim();
        if (/(^|[\s-])(cmcc|cmnet|cmi|mobile)\b|移动/.test(s))
            return "中国移动";
        if (/(^|[\s-])(chinanet|telecom|ctcc|ct)\b|电信/.test(s))
            return "中国电信";
        if (/(^|[\s-])(unicom|cncgroup|netcom|link)\b|联通/.test(s))
            return "中国联通";
        if (/(^|[\s-])(cbn|broadcast)\b|广电/.test(s))
            return "中国广电";
        return raw || "未知";
    };
    try {
        const d = ctx.device || {};
        const [internalIP, internalIPv6, gatewayIP, wifiSsid, cellularRadio] = [
            d.ipv4?.address,
            d.ipv6?.address,
            d.ipv4?.gateway,
            d.wifi?.ssid,
            d.cellular?.radio
        ];
        const [localResp, pureResp] = await Promise.all([
            httpGet('https://myip.ipip.net/json'),
            httpGet('https://my.ippure.com/v1/info'),
        ]);
        const { data: local, ping: localPing } = localResp;
        const { data: node, ping: nodePing } = pureResp;
        const locColor = localPing === 0 ? C.muted : (localPing < 60 ? C.teal : (localPing < 150 ? C.gold : C.red));
        const nodColor = nodePing === 0 ? C.muted : (nodePing < 150 ? C.teal : (nodePing < 300 ? C.gold : C.red));
        const rawISP = (Array.isArray(local.location) ? local.location[local.location.length - 1] : "") || node?.asOrganization;
        const currentISP = fmtISP(rawISP);
        const rawRadio = cellularRadio ? String(cellularRadio).toUpperCase().trim() : "";
        const radioType = { "GPRS": "2.5G", "EDGE": "2.75G", "WCDMA": "3G", "LTE": "4G", "NR": "5G", "NRNSA": "5G" }[rawRadio] || rawRadio;
        const localCountryRaw = Array.isArray(local.location) ? (local.location[0] || "") : "";
        const nodeCountryCode = (node.countryCode || "").toUpperCase();
        const localIsCN = localCountryRaw.includes("中国") || localCountryRaw.includes("China");
        const nodeIsCN = nodeCountryCode === "CN";
        const isDnsLeak = localIsCN && nodeIsCN;
        const leakLabel = isDnsLeak ? "⚠️ 泄漏" : "";
        const r1Parts = [internalIP || "未连接", gatewayIP !== internalIP ? gatewayIP : null].filter(Boolean);
        if (internalIPv6)
            r1Parts.push("[v6]");
        const r1Content = r1Parts.join(" / ");
        const locStr = Array.isArray(local.location) ? local.location.slice(0, 3).join('').trim() : '';
        const r2Base = [local.ip || "获取中...", locStr].filter(Boolean).join(" / ");
        const r2Content = r2Base;
        const nodeLoc = [getFlagEmoji(nodeCountryCode), node.city].filter(Boolean).join(" ");
        const asnStr = node.asn ? String(node.asn).split(' ')[0] : "";
        const r3Content = [node.query || node.ip || "获取中...", nodeLoc, asnStr].filter(Boolean).join(" / ");
        const risk = node.fraudScore;
        const riskTxt = risk === undefined ? "未知风险" : (risk >= 80 ? `极高危(${risk})` : risk >= 70 ? `高危(${risk})` : risk >= 40 ? `中危(${risk})` : `低危(${risk})`);
        const r4Content = `${node.isResidential === true ? "原生住宅" : (node.isResidential === false ? "商业机房" : "未知属性")} / ${riskTxt}`;
        const buildRow = (icon, color, label, content, contentColor = C.sub) => ({
            type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                {
                    type: 'stack', direction: 'row', alignItems: 'center', gap: 2, width: 52, children: [
                        mkIcon(icon, color, 13),
                        mkText(label, 12, 'heavy', color),
                    ]
                },
                mkText(content, 12, 'medium', contentColor, { maxLines: 1, minScale: 0.5, flex: 1 }),
            ]
        });
        let widgetConfig = {
            type: 'widget', padding: 12,
            backgroundGradient: { type: 'linear', colors: C.bg, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
            children: [
                {
                    type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
                        mkIcon(wifiSsid ? 'wifi' : (cellularRadio ? 'antenna.radiowaves.left.and.right' : ':wifi.slash'), C.main, 16),
                        mkText(`${currentISP} · ${wifiSsid || radioType || "未连接"}`, 15, 'heavy', C.main, { maxLines: 1, minScale: 0.7 }),
                        { type: 'spacer' },
                        ...(leakLabel ? [{ type: 'text', text: leakLabel, font: { size: 10, weight: 'bold' }, textColor: C.red }] : []),
                        {
                            type: 'stack', direction: 'row', alignItems: 'center', gap: 4, padding: [3, 6], borderRadius: 6, backgroundColor: C.pingBg, children: [
                                {
                                    type: 'stack', direction: 'row', alignItems: 'center', gap: 2, children: [
                                        mkIcon('mappin.circle.fill', locColor, 10),
                                        mkSimpleText(localPing > 0 ? `${localPing}` : "-", locColor, { font: { size: 10, weight: 'bold', family: 'Menlo' } }),
                                    ]
                                },
                                mkText('|', 10, 'light', C.muted),
                                {
                                    type: 'stack', direction: 'row', alignItems: 'center', gap: 2, children: [
                                        mkIcon('globe.fill', nodColor, 10),
                                        mkSimpleText(nodePing > 0 ? `${nodePing}` : "-", nodColor, { font: { size: 10, weight: 'bold', family: 'Menlo' } }),
                                    ]
                                }
                            ]
                        }
                    ]
                },
                { type: 'spacer', length: 8 },
                {
                    type: 'stack', direction: 'column', alignItems: 'start', gap: 8, flex: 1, children: [
                        buildRow('house.fill', C.teal, '内网', r1Content),
                        buildRow('location.circle.fill', C.blue, '本地', r2Content),
                        buildRow('network', C.purple, '节点', r3Content, isDnsLeak ? C.red : C.sub),
                        buildRow('shield.lefthalf.filled', C.cyan, '属性', r4Content)
                    ]
                },
                {
                    type: 'stack', direction: 'row', alignItems: 'center', children: [
                        { type: 'spacer' },
                        mkSimpleText(`update at ${timeStr}`, C.muted, { font: { size: 9, weight: 'bold', family: 'Menlo' } }),
                    ]
                }
            ]
        };
        return widgetConfig;
    }
    catch (err) {
        return {
            type: 'widget', padding: 12,
            refreshAfter: nextRefreshTime.toISOString(),
            backgroundGradient: { type: 'linear', colors: [{ light: '#FFFFFF', dark: '#1C1C1E' }, { light: '#F5F5F9', dark: '#0C0C0E' }], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
            children: [
                mkText('网络面板崩溃 ⚠️', 14, 'heavy', '#FF453A'),
                { type: 'spacer', length: 4 },
                mkText(String(err.message || err), 11, "regular", '#8E8E93', { maxLines: 5 }),
                { type: 'spacer' },
                {
                    type: 'stack', direction: 'row', children: [
                        { type: 'spacer' },
                        mkText(`Will retry at ${timeStr}`, 9, 'bold', '#8E8E93', { font: { family: 'Menlo' } })
                    ]
                }
            ]
        };
    }
}
//# sourceMappingURL=networkinfo.js.map
