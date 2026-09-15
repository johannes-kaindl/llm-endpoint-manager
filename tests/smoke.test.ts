import { describe, it, expect } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import { secretStorageAvailable } from "../src/vendor/kit-obsidian/secrets";

describe("Gerüst", () => {
  it("vendorter Mock und vendortes Kit-Modul sind verdrahtet", () => {
    expect(secretStorageAvailable(makeFakeApp())).toBe(true);
  });
});
