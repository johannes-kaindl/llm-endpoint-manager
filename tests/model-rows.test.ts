import { describe, it, expect } from "vitest";
import { modelRows, setModelMeta } from "../src/core/model-rows";
import type { ManagedEndpoint } from "../src/core/model";

const ep = (over: Partial<ManagedEndpoint> = {}): ManagedEndpoint =>
  ({ id: "e", label: "E", url: "http://h", provider: "openai", capabilities: ["chat"], enabled: true, ...over });

describe("modelRows", () => {
  it("merges stored and listed ids and suggests a family from the name", () => {
    expect(modelRows(["qwen/qwen3.8-27b", "verdigado-pro"], [{ id: "verdigado-pro", family: "gpt-oss" }, { id: "old" }])).toEqual([
      { id: "verdigado-pro", family: "gpt-oss", suggested: null },
      { id: "old", suggested: null },
      { id: "qwen/qwen3.8-27b", suggested: "qwen3.8" },
    ]);
  });
});

describe("displayFamily in den Zeilen", () => {
  it("modelRows traegt displayFamily, ohne eine Sampling-Familie zu erfinden", () => {
    expect(modelRows([], [{ id: "apple-fm", displayFamily: "apple-fm" }])).toEqual([
      { id: "apple-fm", displayFamily: "apple-fm", suggested: null },
    ]);
  });
  it("setModelMeta behaelt eine Zeile, die nur displayFamily traegt", () => {
    const e = ep({ provider: "apple-shortcuts", models: [{ id: "apple-fm", displayFamily: "apple-fm" }] });
    expect(setModelMeta(e, "other", { aliasOf: "x" }).models).toEqual([{ id: "apple-fm", displayFamily: "apple-fm" }, { id: "other", aliasOf: "x" }]);
    expect(setModelMeta(e, "apple-fm", { family: null }).models).toEqual([{ id: "apple-fm", displayFamily: "apple-fm" }]);
  });
});

describe("setModelMeta", () => {
  it("sets and clears family and alias; empty rows and empty lists disappear", () => {
    let e = setModelMeta(ep(), "verdigado-pro", { family: "gpt-oss" });
    expect(e.models).toEqual([{ id: "verdigado-pro", family: "gpt-oss" }]);
    e = setModelMeta(e, "qwen/qwen3.8-27b", { aliasOf: "qwen/qwen3.8-27b@4bit" });
    expect(e.models).toEqual([{ id: "verdigado-pro", family: "gpt-oss" }, { id: "qwen/qwen3.8-27b", aliasOf: "qwen/qwen3.8-27b@4bit" }]);
    e = setModelMeta(e, "verdigado-pro", { family: null });
    e = setModelMeta(e, "qwen/qwen3.8-27b", { aliasOf: null });
    expect(e.models).toBeUndefined();
  });
  it("an alias pointing to itself is not stored", () => {
    expect(setModelMeta(ep(), "m", { aliasOf: "m" }).models).toBeUndefined();
  });
});
