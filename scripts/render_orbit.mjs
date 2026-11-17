import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = fileURLToPath(new URL("../assets/orbit/", import.meta.url));
const frames = mkdtempSync(join(tmpdir(), "orbit-frames-"));
try {
  execFileSync("magick", [join(assets, "character.png"), "-resize", "512x512", "-background", "#DCE8EF", "-alpha", "remove", "-alpha", "off", "-gravity", "center", "-extent", "512x512", join(assets, "icon.png")]);
  const pngs = [];
  for (let frame = 0; frame < 24; frame++) {
    const png = join(frames, `${frame}.png`);
    const y = Math.round(4 + 3 * Math.sin(frame * Math.PI / 12));
    execFileSync("magick", ["-size", "96x96", "xc:none", "(", join(assets, "emoji.png"), "-resize", "88x88", ")", "-geometry", `+4+${y}`, "-compose", "over", "-composite", png]);
    pngs.push(png);
  }
  const gif = join(assets, "working.gif");
  execFileSync("magick", ["-dispose", "background", "-delay", "8", ...pngs, "-loop", "0", "-layers", "Optimize", gif]);
  assert(statSync(gif).size < 128 * 1024, "Slack emoji must remain below 128 KB");
  const count = execFileSync("magick", ["identify", "-format", "%f\n", gif], { encoding: "utf8" }).trim().split("\n").length;
  assert.equal(count, 24);
  console.log(`Created 24-frame Orbit emoji (${statSync(gif).size} bytes)`);
} finally {
  rmSync(frames, { recursive: true, force: true });
}
