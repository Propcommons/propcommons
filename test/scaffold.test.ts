import { readFileSync } from "node:fs";
import { SPEC_VERSION } from "@propcommons/validator";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../project.config.json", import.meta.url), "utf8"));

describe("scaffold", () => {
  it("workspace packages resolve", () => {
    expect(SPEC_VERSION).toBe("0.1");
  });

  it("project.config.json is the one place for name and licenses", () => {
    expect(config.id).toBe("propcommons");
    expect(config.licenses).toEqual({ code: "MIT", assets: "CC0-1.0", spec: "CC-BY-4.0" });
    expect(config.specVersion).toBe(SPEC_VERSION);
  });
});
