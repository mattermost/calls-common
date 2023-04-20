export function hexToRGB(h) {
    if (h.length !== 7 || h[0] !== '#') {
        throw new Error(`invalid hex color string '${h}'`);
    }
    return {
        r: parseInt(h[1] + h[2], 16),
        g: parseInt(h[3] + h[4], 16),
        b: parseInt(h[5] + h[6], 16),
    };
}
export function rgbToHSL(c) {
    // normalize components into [0,1]
    const R = c.r / 255;
    const G = c.g / 255;
    const B = c.b / 255;
    // value
    const V = Math.max(R, G, B);
    // chroma
    const C = V - Math.min(R, G, B);
    // lightness
    const L = V - (C / 2);
    // saturation
    let S = 0;
    if (L > 0 && L < 1) {
        S = C / (1 - Math.abs((2 * V) - C - 1));
    }
    // hue
    let h = 0;
    if (C !== 0) {
        switch (V) {
            case R:
                h = 60 * (((G - B) / C) % 6);
                break;
            case G:
                h = 60 * (((B - R) / C) + 2);
                break;
            case B:
                h = 60 * (((R - G) / C) + 4);
                break;
        }
    }
    return {
        h: Math.round(h >= 0 ? h : h + 360),
        s: Math.round(S * 100),
        l: Math.round(L * 100),
    };
}
export function hslToRGB(c) {
    const H = c.h;
    const S = c.s / 100;
    const L = c.l / 100;
    const f = (n) => {
        const k = (n + (H / 30)) % 12;
        const a = S * Math.min(L, 1 - L);
        return L - (a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return {
        r: Math.round(f(0) * 255),
        g: Math.round(f(8) * 255),
        b: Math.round(f(4) * 255),
    };
}
export function rgbToCSS(c) {
    return `rgb(${c.r},${c.g},${c.b})`;
}
export function makeCallsBaseAndBadgeRGB(sidebarTextHoverBg) {
    // Base color is Sidebar Text Hover Background.
    const baseColorHSL = rgbToHSL(hexToRGB(sidebarTextHoverBg));
    // Setting lightness to 16 to improve contrast.
    baseColorHSL.l = 16;
    const baseColorRGB = hslToRGB(baseColorHSL);
    // badgeBG is baseColor with a 0.16 opacity white overlay on top.
    const badgeBgRGB = {
        r: Math.round(baseColorRGB.r + (255 * 0.16)),
        g: Math.round(baseColorRGB.g + (255 * 0.16)),
        b: Math.round(baseColorRGB.b + (255 * 0.16)),
    };
    return { baseColorRGB, badgeBgRGB };
}
