const path = require("path");

class MockNode {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.dataset = {};
    this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { width: 900, height: 300 }; }
  getContext() {
    return new Proxy({}, { get(target, key) {
      if (!(key in target)) target[key] = typeof key === "string" && ["scale","fillRect","fillText","beginPath","moveTo","lineTo","stroke","setLineDash","arc","fill"].includes(key) ? () => {} : "";
      return target[key];
    }, set(target, key, value) { target[key] = value; return true; } });
  }
}

const nodes = new Map();
const defaults = {
  skillPercentile: "95", matchStrength: "90", searchWidth: "450", population: "1000",
  matchCount: "500", kFactor: "28", seed: "2026"
};
function node(id) {
  if (!nodes.has(id)) nodes.set(id, new MockNode(id));
  const result = nodes.get(id);
  if (id in defaults && !result.value) result.value = defaults[id];
  return result;
}

global.document = {
  getElementById: node,
  querySelectorAll: () => [],
  querySelector: () => new MockNode("query")
};
global.window = { devicePixelRatio: 1, addEventListener() {} };
global.location = { hash: "" };
global.requestAnimationFrame = (fn) => setImmediate(fn);

require(path.resolve(__dirname, "../dist/app.js"));

async function main() {
  const click = node("runButton").listeners.click;
  if (!click) throw new Error("실행 버튼 이벤트가 연결되지 않았습니다.");
  click();
  const deadline = Date.now() + 15000;
  while (node("gameCount").textContent !== "500" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (node("gameCount").textContent !== "500") throw new Error("500경기 시뮬레이션이 완료되지 않았습니다.");
  if (!/경기 진행/.test(node("resultTitle").textContent)) throw new Error("결과 제목이 갱신되지 않았습니다.");
  if (!node("matchLog").innerHTML.includes("#500")) throw new Error("최근 경기 로그가 갱신되지 않았습니다.");
  console.log(`smoke ok: 500 games, ${node("hiddenMmr").textContent} hidden MMR, metrics and match log rendered`);
}

main().catch(error => { console.error(error); process.exit(1); });
