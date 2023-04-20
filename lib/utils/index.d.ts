import type { ColorHSL, ColorRGB } from 'src/types';
export declare function hexToRGB(h: string): {
    r: number;
    g: number;
    b: number;
};
export declare function rgbToHSL(c: ColorRGB): {
    h: number;
    s: number;
    l: number;
};
export declare function hslToRGB(c: ColorHSL): {
    r: number;
    g: number;
    b: number;
};
export declare function rgbToCSS(c: ColorRGB): string;
export declare function makeCallsBaseAndBadgeRGB(sidebarTextHoverBg: string): {
    baseColorRGB: ColorRGB;
    badgeBgRGB: ColorRGB;
};
