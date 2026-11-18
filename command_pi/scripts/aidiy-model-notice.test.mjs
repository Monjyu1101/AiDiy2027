import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import "../packages/coding-agent/src/experimental/source-resolver.ts";
const { formatModelForFooter } = await import("../packages/coding-agent/src/modes/interactive/components/footer.ts");

// Run the real command/selector methods without starting a terminal or authenticated session.
const source = readFileSync(new URL("../packages/coding-agent/src/modes/interactive/interactive-mode.ts", import.meta.url), "utf8");
function method(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
const methods = method("\tprivate async handleModelCommand(", "\tprivate async findExactModelMatch(")
 + method("\tprivate showModelSelector(", "\tprivate showModelsSelector(");
class Selector {
 constructor(...args) { this.select = args[4]; this.cancel = args[5]; this.persist = args[7]; }
}
const Harness = vm.runInNewContext(stripTypeScriptTypes("class Harness {\n" + methods + "\n}\nHarness"), {
 formatModelForFooter, ModelSelectorComponent: Selector, Error,
});
function harness(model, fail = false) {
 const h = new Harness();
 h.notices = []; h.errors = []; h.calls = []; h.done = 0;
 h.session = { model, scopedModels: [], modelRuntime: {}, setModel: async (value, options) => {
  if (fail) throw new Error("switch failed");
  h.calls.push({ value, options });
 }};
 h.findExactModelMatch = async () => model;
 h.showStatus = value => h.notices.push(value);
 h.showError = value => h.errors.push(value);
 h.footer = { invalidate() {} };
 h.updateEditorBorderColor = h.updateAvailableProviderCount = h.maybeWarnAboutAnthropicSubscriptionAuth = () => {};
 h.settingsManager = { getDefaultProvider() {}, getDefaultModel() {} };
 h.ui = { requestRender() {} };
 h.showSelector = callback => { h.selector = callback(() => { h.done++; }).component; };
 return h;
}
test("direct /model notification includes provider and preserves nonpersistent switching", async () => {
 for (const model of [{ provider: "copilot_cli", id: "claude-sonnet-5.5" }, { provider: "openai_oauth", id: "openai_oauth/gpt-6.2-sol" }]) {
  const h = harness(model);
  await h.handleModelCommand("requested-model");
  assert.equal(h.notices[0], "Model: " + formatModelForFooter(model));
  assert.equal(h.calls[0].value, model);
  assert.equal(h.calls[0].options.persist, false);
 }
});
test("interactive /model selection and default selection use the combined label", async () => {
 const model = { provider: "openai_oauth", id: "gpt-6.2-sol" };
 const h = harness(model);
 await h.handleModelCommand();
 await h.selector.select(model);
 await h.selector.persist(model);
 assert.deepEqual(h.notices, ["Model: openai_oauth/gpt-6.2-sol", "Default model: openai_oauth/gpt-6.2-sol"]);
 assert.deepEqual(h.calls.map(call => call.options.persist), [false, true]);
 assert.equal(h.done, 2);
});
test("failed switches and cancellation do not report a selected model", async () => {
 const model = { provider: "copilot_cli", id: "gpt-6-luna" };
 const h = harness(model, true);
 await h.handleModelCommand("requested-model");
 h.showModelSelector();
 await h.selector.select(model);
 h.selector.cancel();
 assert.equal(h.notices.length, 0);
 assert.deepEqual(h.errors, ["switch failed", "switch failed"]);
});
