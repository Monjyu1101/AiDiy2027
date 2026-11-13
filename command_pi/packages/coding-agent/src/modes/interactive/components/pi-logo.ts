import { backgroundAnsi, foregroundAnsi, isAppleTerminalSession, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

/**
 * The pi logo: 4 cells wide and 2 lines tall. Each cell shows two square pixels with half blocks:
 *
 *   coral coral coral .
 *   blue  .     coral .
 *   blue  blue  .     yellow
 *   blue  .     .     yellow
 *
 * The brand colors stay fixed across themes; they follow the terminal's color mode.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
	// The fourth cell of the top line is empty, so it is padded to the same width as the bottom line.
	const top = `${fg(CORAL)}${backgroundAnsi(BLUE, mode)}▀${RESET}${fg(CORAL)}▀█${RESET} `;
	const bottom = `${fg(BLUE)}█▀${RESET} ${fg(YELLOW)}█${RESET}`;
	return [top, bottom];
}

/**
 * Whether the terminal renders the half-block logo correctly. Apple Terminal draws gaps between rows and
 * misaligns the half blocks, so it gets the text wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: "Pi" with the logo's coral and yellow. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(CORAL, mode)}P${RESET}${foregroundAnsi(YELLOW, mode)}i${RESET}`;
}

// ---------------------------------------------------------------------------
// AiDiy-Pi logo (AiDiy customization)
//
// "AiDiy-" drawn in the same 4-pixel-tall half-block style and palette as the pi logo, followed by the
// pi logo itself, which reads as "Pi":
//
//   .b. y bb. y b.b .. ccc.
//   b.b . b.b . b.b .. b.c.
//   bbb y b.b y .b. gg bb.y
//   b.b y bb. y .b. .. b..y
//
// b = blue, y = yellow, c = coral, g = gray, . = empty.
// ---------------------------------------------------------------------------
const GRAY = rgbColor(140, 140, 140);
const AIDIY_PI_COLORS: Record<string, typeof CORAL> = { b: BLUE, y: YELLOW, c: CORAL, g: GRAY };
const AIDIY_PREFIX_GLYPHS = [
	[".b.", "b.b", "bbb", "b.b"], // A
	["y", ".", "y", "y"], // i
	["bb.", "b.b", "b.b", "bb."], // D
	["y", ".", "y", "y"], // i
	["b.b", "b.b", ".b.", ".b."], // y
	["..", "..", "gg", ".."], // -
];
const PI_GLYPH = ["ccc.", "b.c.", "bb.y", "b..y"];

/** Pixel rows of the AiDiy-Pi logo, glyphs separated by one empty column. */
const AIDIY_PI_PIXELS: string[] = [0, 1, 2, 3].map((row) =>
	[...AIDIY_PREFIX_GLYPHS, PI_GLYPH].map((glyph) => glyph[row]!).join("."),
);

/** Columns before the pi mark inside the AiDiy-Pi logo (where the original pi logo starts). */
export const AIDIY_PI_LOGO_PI_OFFSET = AIDIY_PREFIX_GLYPHS.reduce((width, glyph) => width + glyph[0]!.length + 1, 0);

/** Renders one text line from two pixel rows with half blocks. */
function renderHalfBlockLine(upper: string, lower: string): string {
	const mode = theme.getColorMode();
	let line = "";
	for (let column = 0; column < upper.length; column++) {
		const top = AIDIY_PI_COLORS[upper[column]!];
		const bottom = AIDIY_PI_COLORS[lower[column]!];
		if (!top && !bottom) line += " ";
		else if (top && !bottom) line += `${foregroundAnsi(top, mode)}▀${RESET}`;
		else if (!top && bottom) line += `${foregroundAnsi(bottom, mode)}▄${RESET}`;
		else if (top === bottom) line += `${foregroundAnsi(top!, mode)}█${RESET}`;
		else line += `${foregroundAnsi(top!, mode)}${backgroundAnsi(bottom!, mode)}▀${RESET}`;
	}
	return line;
}

/** The AiDiy-Pi header logo: 2 lines tall, same style and colors as {@link piLogoLines}. */
export function aidiyPiLogoLines(): [string, string] {
	return [
		renderHalfBlockLine(AIDIY_PI_PIXELS[0]!, AIDIY_PI_PIXELS[1]!),
		renderHalfBlockLine(AIDIY_PI_PIXELS[2]!, AIDIY_PI_PIXELS[3]!),
	];
}

/** Large monochrome AiDiy-Pi logo (two characters per pixel) for the first-time setup dialog. */
export function aidiyPiSetupLogoLines(): string[] {
	return AIDIY_PI_PIXELS.map((row) =>
		[...row]
			.map((pixel) => (pixel === "." ? "  " : "██"))
			.join("")
			.trimEnd(),
	);
}

/** Text fallback for the AiDiy-Pi logo. */
export function aidiyPiWordmark(): string {
	const mode = theme.getColorMode();
	const blue = foregroundAnsi(BLUE, mode);
	const yellow = foregroundAnsi(YELLOW, mode);
	return `${blue}A${RESET}${yellow}i${RESET}${blue}D${RESET}${yellow}i${RESET}${blue}y${RESET}${foregroundAnsi(GRAY, mode)}-${RESET}${piWordmark()}`;
}
