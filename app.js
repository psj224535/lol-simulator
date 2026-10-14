(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    skill: $("skillPercentile"), skillOut: $("skillPercentileOut"),
    strength: $("matchStrength"), strengthOut: $("matchStrengthOut"),
    width: $("searchWidth"), widthOut: $("searchWidthOut"),
    population: $("population"), matches: $("matchCount"), k: $("kFactor"), seed: $("seed"),
    run: $("runButton"), heroRun: $("heroRun"), cont: $("continueButton"), auto: $("autoButton"), reset: $("resetButton"),
    status: $("runStatus"), title: $("resultTitle"), games: $("gameCount"),
    trueTier: $("trueTier"), trueMmr: $("trueMmr"), visibleTier: $("visibleTier"), visibleMmr: $("visibleMmr"),
    hiddenMmr: $("hiddenMmr"), mmrGap: $("mmrGap"), recentWinrate: $("recentWinrate"), record: $("record"),
    verdict: $("verdict"), chart: $("convergenceChart"), matchLog: $("matchLog"),
    fairness: $("fairnessBadge"), expected: $("expectedChance"), actual: $("actualChance"), ally: $("allyAverage"), enemy: $("enemyAverage"),
    convergenceBadge: $("convergenceBadge"), skillError: $("skillError"), firstConvergence: $("firstConvergence"), compensation: $("compensation"), confidence: $("confidence"),
    compare: $("compareButton"), compareGrid: $("comparisonGrid"), compareNote: $("comparisonNote")
  };

  const tierBands = [
    [0, "아이언"], [900, "브론즈"], [1100, "실버"], [1300, "골드"], [1500, "플래티넘"],
    [1700, "에메랄드"], [1900, "다이아몬드"], [2100, "마스터"], [2300, "그랜드마스터"], [2500, "챌린저"]
  ];
  const presets = {
    similar: { strength: 25, width: 140 },
    balanced: { strength: 90, width: 450 },
    extreme: { strength: 100, width: 850 }
  };

  let sim = null;
  let busy = false;
  let autoTimer = null;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function normal(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function inverseNormal(p) {
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const plow = 0.02425, phigh = 1 - plow;
    let q, r;
    if (p < plow) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > phigh) { q = Math.sqrt(-2 * Math.log(1-p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q = p - .5; r = q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const logistic = (diff, scale) => 1 / (1 + Math.pow(10, -diff / scale));
  const average = (arr) => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
  const fmt = (n) => Math.round(n).toLocaleString("ko-KR");
  const pct = (n) => (n * 100).toFixed(1) + "%";
  const signed = (n) => (n >= 0 ? "+" : "") + Math.round(n);

  function tierName(score) {
    let index = 0;
    for (let i = 0; i < tierBands.length; i++) if (score >= tierBands[i][0]) index = i;
    const name = tierBands[index][1];
    if (index >= 7) return name;
    const lower = tierBands[index][0], division = clamp(4 - Math.floor((score - lower) / 50), 1, 4);
    return `${name} ${["", "I", "II", "III", "IV"][division]}`;
  }

  function configFromUI(overrides = {}) {
    return Object.assign({
      percentile: Number(el.skill.value), strength: Number(el.strength.value), width: Number(el.width.value),
      population: Number(el.population.value), total: Number(el.matches.value), k: Number(el.k.value), seed: Number(el.seed.value) || 2026
    }, overrides);
  }

  function createSimulation(config) {
    const rng = mulberry32(config.seed);
    const players = [];
    for (let i = 0; i < config.population - 1; i++) {
      const trueSkill = clamp(1500 + normal(rng) * 300, 650, 2700);
      players.push({ trueSkill, mmr: clamp(trueSkill + normal(rng) * 115, 600, 2750) });
    }
    const trueSkill = clamp(1500 + inverseNormal(config.percentile / 100) * 300, 750, 2700);
    return {
      config, rng, players, game: 0, wins: 0, losses: 0,
      focal: { trueSkill, mmr: 1500, visible: 1460 },
      history: [{ game: 0, hidden: 1500, visible: 1460, trueSkill }], results: [], logs: [], convergenceGame: null,
      sums: { expected: 0, actual: 0, ally: 0, enemy: 0, compensation: 0, quality: 0 }
    };
  }

  function pickPlayerIndex(s, chosen) {
    let best = -1;
    const width = Math.max(60, s.config.width);
    for (let tries = 0; tries < 120; tries++) {
      const idx = Math.floor(s.rng() * s.players.length);
      if (chosen.has(idx)) continue;
      const diff = Math.abs(s.players[idx].mmr - s.focal.mmr);
      const accept = Math.exp(-(diff * diff) / (2 * width * width));
      if (s.rng() < accept) return idx;
      if (best < 0 || diff < Math.abs(s.players[best].mmr - s.focal.mmr)) best = idx;
    }
    return best >= 0 ? best : 0;
  }

  function buildMatch(s) {
    const attempts = 1 + Math.round((s.config.strength / 100) * 55);
    let best = null;
    for (let a = 0; a < attempts; a++) {
      const chosen = new Set(), pool = [];
      while (pool.length < 9) {
        const idx = pickPlayerIndex(s, chosen);
        if (!chosen.has(idx)) { chosen.add(idx); pool.push(idx); }
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(s.rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const allies = pool.slice(0, 4), enemies = pool.slice(4);
      const allyMateAvg = allies.reduce((sum, i) => sum + s.players[i].mmr, 0) / 4;
      const allyMmr = (s.focal.mmr + allies.reduce((sum, i) => sum + s.players[i].mmr, 0)) / 5;
      const enemyMmr = enemies.reduce((sum, i) => sum + s.players[i].mmr, 0) / 5;
      const balanceError = Math.abs(allyMmr - enemyMmr);
      // 강한 플레이어의 상승분을 약한 팀원으로 상쇄하는 정책을 명시적으로 모델링한다.
      const desiredCompensation = -Math.min(s.config.width * .42, 350) * (s.config.strength / 100);
      const compensationError = Math.abs((allyMateAvg - s.focal.mmr) - desiredCompensation);
      const spread = Math.sqrt(average(pool.map(i => Math.pow(s.players[i].mmr - s.focal.mmr, 2))));
      const spreadPenalty = Math.max(0, spread - s.config.width * .82) * .05;
      const score = balanceError + compensationError * .42 * (s.config.strength / 100) + spreadPenalty;
      if (!best || score < best.score) best = { allies, enemies, allyMmr, allyMateAvg, enemyMmr, score, balanceError };
    }
    return best;
  }

  function playOne(s) {
    const match = buildMatch(s);
    const allyTrue = (s.focal.trueSkill + match.allies.reduce((sum, i) => sum + s.players[i].trueSkill, 0)) / 5;
    const enemyTrue = match.enemies.reduce((sum, i) => sum + s.players[i].trueSkill, 0) / 5;
    const expected = logistic(match.allyMmr - match.enemyMmr, 400);
    const actual = logistic(allyTrue - enemyTrue, 300);
    const win = s.rng() < actual;
    const result = win ? 1 : 0;
    const oldMmr = s.focal.mmr;
    const delta = s.config.k * (result - expected);
    s.focal.mmr = clamp(s.focal.mmr + delta, 400, 3000);
    const visibleGap = s.focal.mmr - s.focal.visible;
    const baseLp = 23 + clamp(visibleGap / 70, -7, 7);
    s.focal.visible = clamp(s.focal.visible + (win ? baseLp : -(46 - baseLp)), 400, 3000);
    const bgK = Math.max(12, s.config.k * .58);
    match.allies.forEach(i => { s.players[i].mmr = clamp(s.players[i].mmr + bgK * (result - expected), 400, 3000); });
    match.enemies.forEach(i => { s.players[i].mmr = clamp(s.players[i].mmr + bgK * ((1-result) - (1-expected)), 400, 3000); });
    s.game += 1;
    win ? s.wins++ : s.losses++;
    s.results.push(win);
    if (s.results.length > 500) s.results.shift();
    const allyMateAvg = match.allyMateAvg;
    const enemyAvg = match.enemyMmr;
    s.sums.expected += expected; s.sums.actual += actual; s.sums.ally += allyMateAvg; s.sums.enemy += enemyAvg;
    s.sums.compensation += allyMateAvg - s.focal.mmr; s.sums.quality += match.balanceError;
    s.logs.unshift({ game: s.game, win, expected, actual, compensation: allyMateAvg - oldMmr, delta });
    if (s.logs.length > 8) s.logs.pop();
    if (s.convergenceGame === null && Math.abs(s.focal.mmr - s.focal.trueSkill) <= 100) s.convergenceGame = s.game;
    const step = s.game < 200 ? 5 : s.game < 1000 ? 15 : 40;
    if (s.game % step === 0) s.history.push({ game: s.game, hidden: s.focal.mmr, visible: s.focal.visible, trueSkill: s.focal.trueSkill });
  }

  async function runGames(count, renderDuring = true) {
    if (busy || !sim) return;
    busy = true; setRunningUI(true);
    let done = 0;
    while (done < count) {
      const chunk = Math.min(50, count - done);
      for (let i = 0; i < chunk; i++) playOne(sim);
      done += chunk;
      if (renderDuring && (done % 200 === 0 || done === count)) {
        render();
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    busy = false; setRunningUI(false); render();
  }

  function setRunningUI(running) {
    el.run.disabled = running; el.cont.disabled = running; el.compare.disabled = running;
    el.status.textContent = running ? "시뮬레이션 계산 중" : autoTimer ? "연속 실행 중" : "실험 준비됨";
  }

  function updateVerdict() {
    const gap = sim.focal.mmr - sim.focal.trueSkill;
    const absGap = Math.abs(gap);
    const enough = sim.game >= 500;
    let state = "idle", icon = "…", title = "아직 표본을 모으는 중입니다.", copy = "최소 500경기 이상에서 장기 수렴 여부를 판단하는 편이 안전합니다.";
    if (enough && absGap <= 100) {
      state = "success"; icon = "✓"; title = "이 조건에서는 높은 실력이 제자리로 수렴했습니다.";
      copy = `승률은 50% 부근으로 내려왔지만, 숨은 MMR이 실제 실력과 ${fmt(absGap)}점 이내입니다.`;
    } else if (enough && gap < -180) {
      state = "warning"; icon = "!"; title = "이 조건에서는 실력보다 낮은 MMR이 오래 유지됩니다.";
      copy = `현재 ${fmt(absGap)}점 저평가 상태입니다. 탐색 폭·보정 강도 또는 MMR 반응 속도가 원인일 수 있습니다.`;
    } else if (enough) {
      state = "idle"; icon = "≈"; title = "대체로 수렴 중이지만 오차가 남아 있습니다.";
      copy = `현재 실제 실력과 숨은 MMR의 차이는 ${fmt(absGap)}점입니다. 더 이어서 분산이 줄어드는지 확인하세요.`;
    }
    el.verdict.dataset.state = state;
    el.verdict.innerHTML = `<div class="verdict-icon" aria-hidden="true">${icon}</div><div><span>현재 판정</span><strong>${title}</strong><p>${copy}</p></div>`;
  }

  function render() {
    if (!sim) { drawEmptyChart(); return; }
    const recent = sim.results.slice(-200), recentWins = recent.filter(Boolean).length;
    const gap = sim.focal.mmr - sim.focal.trueSkill;
    const avgExpected = sim.sums.expected / Math.max(1, sim.game), avgActual = sim.sums.actual / Math.max(1, sim.game);
    const avgQuality = sim.sums.quality / Math.max(1, sim.game);
    el.title.textContent = `${tierName(sim.focal.visible)} · ${sim.game.toLocaleString("ko-KR")}경기 진행`;
    el.games.textContent = sim.game.toLocaleString("ko-KR");
    el.trueTier.textContent = tierName(sim.focal.trueSkill); el.trueMmr.textContent = `기준 MMR ${fmt(sim.focal.trueSkill)}`;
    el.visibleTier.textContent = tierName(sim.focal.visible); el.visibleMmr.textContent = `표시 점수 ${fmt(sim.focal.visible)}`;
    el.hiddenMmr.textContent = fmt(sim.focal.mmr); el.mmrGap.textContent = `실력 대비 ${signed(gap)}점`;
    el.recentWinrate.textContent = recent.length ? pct(recentWins / recent.length) : "—";
    el.record.textContent = `${sim.wins.toLocaleString("ko-KR")}승 ${sim.losses.toLocaleString("ko-KR")}패 · 전체 ${pct(sim.wins/Math.max(1,sim.game))}`;
    el.fairness.textContent = avgQuality < 12 ? "매우 균형" : avgQuality < 30 ? "균형" : "편차 있음";
    el.expected.textContent = pct(avgExpected); el.actual.textContent = pct(avgActual);
    el.ally.textContent = fmt(sim.sums.ally / Math.max(1,sim.game)); el.enemy.textContent = fmt(sim.sums.enemy / Math.max(1,sim.game));
    el.skillError.textContent = `${signed(gap)} MMR`;
    el.firstConvergence.textContent = sim.convergenceGame ? `${sim.convergenceGame.toLocaleString("ko-KR")}경기` : "아직 없음";
    el.compensation.textContent = `${signed(sim.sums.compensation / Math.max(1,sim.game))} MMR`;
    el.confidence.textContent = sim.game >= 3000 ? "높음" : sim.game >= 1000 ? "보통" : "낮음";
    el.convergenceBadge.textContent = Math.abs(gap) <= 100 ? "수렴 구간" : gap < 0 ? "저평가" : "고평가";
    el.matchLog.innerHTML = sim.logs.map(row => `<tr><td>#${row.game}</td><td class="${row.win ? "result-win" : "result-loss"}">${row.win ? "승리" : "패배"}</td><td>${pct(row.expected)}</td><td>${pct(row.actual)}</td><td>${signed(row.compensation)}</td><td class="${row.delta >= 0 ? "result-win" : "result-loss"}">${signed(row.delta)}</td></tr>`).join("");
    updateVerdict(); drawChart();
  }

  function drawEmptyChart() {
    const c = el.chart, rect = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, rect.width * dpr); c.height = Math.max(1, rect.height * dpr);
    const ctx = c.getContext("2d"); ctx.scale(dpr,dpr); ctx.fillStyle = "#faf8f2"; ctx.fillRect(0,0,rect.width,rect.height);
    ctx.fillStyle = "#9aa2a2"; ctx.font = "12px system-ui"; ctx.textAlign = "center"; ctx.fillText("실험을 실행하면 수렴 경로가 나타납니다", rect.width/2, rect.height/2);
  }

  function drawChart() {
    const c = el.chart, rect = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = rect.width, h = rect.height; c.width = Math.max(1,w*dpr); c.height = Math.max(1,h*dpr);
    const ctx = c.getContext("2d"); ctx.scale(dpr,dpr);
    const pad = {l:47,r:12,t:13,b:28}, plotW=w-pad.l-pad.r, plotH=h-pad.t-pad.b;
    const data = sim.history.slice();
    if (!data.length || data[data.length-1].game !== sim.game) data.push({game:sim.game,hidden:sim.focal.mmr,visible:sim.focal.visible,trueSkill:sim.focal.trueSkill});
    const vals = data.flatMap(d => [d.hidden,d.visible,d.trueSkill]);
    let min = Math.floor((Math.min(...vals)-120)/200)*200, max = Math.ceil((Math.max(...vals)+120)/200)*200;
    if (max-min<600) { const mid=(max+min)/2; min=mid-300; max=mid+300; }
    const x = g => pad.l + (g/Math.max(1,sim.game))*plotW;
    const y = v => pad.t + (max-v)/(max-min)*plotH;
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#ebe7dd"; ctx.lineWidth=1; ctx.fillStyle="#8a9495"; ctx.font="10px ui-monospace, monospace"; ctx.textAlign="right";
    for(let i=0;i<=4;i++){ const v=min+(max-min)*i/4, py=y(v); ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();ctx.fillText(fmt(v),pad.l-8,py+3); }
    ctx.textAlign="center"; for(let i=0;i<=4;i++){const g=Math.round(sim.game*i/4),px=x(g);ctx.fillText(g.toLocaleString("ko-KR"),px,h-8);}
    function line(key,color,width,dash=[]){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);data.forEach((d,i)=>{const px=x(d.game),py=y(d[key]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();ctx.setLineDash([]);}
    line("trueSkill","#e8664c",1.5,[6,5]); line("visible","#d5a82f",2); line("hidden","#0f7a75",2.5);
    const last=data[data.length-1]; [["hidden","#0f7a75"],["visible","#d5a82f"]].forEach(([key,color])=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(last.game),y(last[key]),4,0,Math.PI*2);ctx.fill();});
  }

  function updateLabels() {
    el.skillOut.textContent = `상위 ${100-Number(el.skill.value)}%`;
    el.strengthOut.textContent = `${el.strength.value}%`;
    el.widthOut.textContent = `±${el.width.value} MMR`;
  }

  function activatePreset(name) {
    const p = presets[name]; el.strength.value = p.strength; el.width.value = p.width;
    document.querySelectorAll(".preset").forEach(b => b.classList.toggle("active", b.dataset.preset === name));
    updateLabels();
  }

  async function startSimulation() {
    stopAuto(); sim = createSimulation(configFromUI()); render();
    document.querySelector(".lab-shell").scrollIntoView({behavior:"smooth",block:"start"});
    await runGames(sim.config.total);
  }

  function toggleAuto() {
    if (autoTimer) { stopAuto(); return; }
    if (!sim) sim = createSimulation(configFromUI());
    el.auto.classList.add("running"); el.auto.textContent="Ⅱ"; el.auto.setAttribute("aria-pressed","true"); el.status.textContent="연속 실행 중";
    autoTimer = setInterval(() => { if (!busy) runGames(100, true); }, 180);
  }
  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer); autoTimer=null;
    el.auto.classList.remove("running"); el.auto.textContent="▶"; el.auto.setAttribute("aria-pressed","false");
  }

  async function runComparison() {
    if (busy) return;
    stopAuto(); busy=true; setRunningUI(true); el.compare.textContent="비교 계산 중…"; el.compareNote.textContent="세 정책을 같은 관찰 대상과 시드로 계산하고 있습니다.";
    const specs = [
      {name:"근접 MMR",desc:"좁은 범위 안에서 비슷한 플레이어를 우선 매칭합니다.",strength:25,width:140},
      {name:"50% 강제",desc:"넓은 후보군에서 양 팀 평균 MMR이 같도록 강하게 조정합니다.",strength:90,width:450,featured:true},
      {name:"극단 보정",desc:"고MMR 한 명과 저MMR 팀원을 적극적으로 섞어 균형을 맞춥니다.",strength:100,width:850}
    ];
    const results=[];
    for(let sIndex=0;sIndex<specs.length;sIndex++){
      const spec=specs[sIndex], local=createSimulation(configFromUI({strength:spec.strength,width:spec.width,total:2000,seed:Number(el.seed.value)}));
      for(let i=0;i<2000;i++) playOne(local);
      const recent=local.results.slice(-500), wins=recent.filter(Boolean).length;
      results.push({spec,mmr:local.focal.mmr,visible:local.focal.visible,gap:local.focal.mmr-local.focal.trueSkill,winrate:wins/recent.length,comp:local.sums.compensation/local.game,quality:local.sums.quality/local.game});
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    el.compareGrid.innerHTML=results.map((r,i)=>`<article class="policy-card ${r.spec.featured?"featured":""}"><div class="policy-number">0${i+1}</div><h3>${r.spec.name}</h3><p>${r.spec.desc}</p><div class="policy-result"><div><span>최종 티어</span><strong>${tierName(r.visible)}</strong></div><div><span>최근 승률</span><strong>${pct(r.winrate)}</strong></div><div><span>실력 오차</span><strong>${signed(r.gap)}</strong></div><div><span>팀원 보정</span><strong>${signed(r.comp)}</strong></div></div></article>`).join("");
    const best=results.reduce((a,b)=>Math.abs(a.gap)<Math.abs(b.gap)?a:b);
    el.compareNote.textContent=`이 실행에서는 ‘${best.spec.name}’ 정책의 실력-MMR 오차가 가장 작았습니다. 시드를 바꿔 반복하면 우연 변동도 확인할 수 있습니다.`;
    el.compare.textContent="다시 비교하기"; busy=false; setRunningUI(false);
  }

  [el.skill,el.strength,el.width].forEach(input=>input.addEventListener("input",()=>{updateLabels();document.querySelectorAll(".preset").forEach(b=>b.classList.remove("active"));}));
  document.querySelectorAll(".preset").forEach(btn=>btn.addEventListener("click",()=>activatePreset(btn.dataset.preset)));
  el.run.addEventListener("click",startSimulation); el.heroRun.addEventListener("click",startSimulation);
  el.cont.addEventListener("click",()=>{ if(!sim) sim=createSimulation(configFromUI()); runGames(500); });
  el.auto.addEventListener("click",toggleAuto);
  el.reset.addEventListener("click",()=>{stopAuto(); el.skill.value=95;el.strength.value=90;el.width.value=450;el.population.value=3000;el.matches.value=2000;el.k.value=28;el.seed.value=2026;activatePreset("balanced");sim=null;location.hash="";renderInitial();});
  el.compare.addEventListener("click",runComparison);
  $("jumpCompare").addEventListener("click",()=>{$("comparison").scrollIntoView({behavior:"smooth"});setTimeout(runComparison,350);});
  window.addEventListener("resize",()=>sim?drawChart():drawEmptyChart());

  function renderInitial(){
    el.title.textContent="아직 경기를 시작하지 않았습니다";el.games.textContent="0";
    [el.trueTier,el.visibleTier,el.hiddenMmr,el.recentWinrate].forEach(node=>node.textContent="—");
    el.trueMmr.textContent="기준 MMR —";el.visibleMmr.textContent="표시 점수 —";el.mmrGap.textContent="실력과 차이 —";el.record.textContent="0승 0패";
    el.matchLog.innerHTML='<tr><td colspan="6" class="empty-row">실행 후 최근 8경기가 표시됩니다.</td></tr>';
    el.verdict.dataset.state="idle";el.verdict.innerHTML='<div class="verdict-icon" aria-hidden="true">?</div><div><span>현재 판정</span><strong>조건을 설정하고 실험을 시작하세요.</strong><p>충분한 표본 뒤 실제 실력과 숨은 MMR·표시 티어의 차이를 계산합니다.</p></div>';
    drawEmptyChart();
  }
  updateLabels(); renderInitial();
})();
