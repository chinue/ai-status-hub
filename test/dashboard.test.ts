// DESIGN: v2-test-design.md#dashboard-current-usage

import { expect } from 'chai';
import { DashboardPanel } from '../src/presenters/dashboard';
import { defaultState, Store } from '../src/store';
import { AppState, QuotaData } from '../src/types';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { Script } from 'vm';

describe('Dashboard Current Usage', () => {
  it('uses rolling GLM local history without shifting official quota reset times', () => {
    const now = Date.now();
    const hour = 3600000;
    const state = { ...defaultState(), activeProvider: 'glm', windowAnchors: {
      providerId: 'glm', window5hStartMs: now - hour, window5hResetAtMs: now + 4 * hour,
      window7dStartMs: now - 6 * 24 * hour, window7dResetAtMs: now + 24 * hour,
      updatedAt: now, source: 'api' as const,
    } };
    const starts = (DashboardPanel.prototype as any).resolveDashboardWindowStarts.call({}, state, now);
    expect(starts.window5hStart).to.equal(now - 5 * hour);
    expect(starts.window7dStart).to.equal(state.windowAnchors.window7dStartMs);
  });
  const quota: QuotaData = {
    weeklyLimit: 100,
    weeklyUsed: 34,
    weeklyUsedPct: 34,
    weeklyResetAt: Date.now() + 7 * 24 * 3600 * 1000,
    fableWeeklyUsedPct: 56,
    fableWeeklyResetAt: Date.now() + 6 * 24 * 3600 * 1000,
    windowLimit: 100,
    windowUsed: 12,
    windowRemaining: 88,
    windowUsedPct: 12,
    windowResetAt: Date.now() + 5 * 3600 * 1000,
    parallelLimit: 0,
  };

  function buildUsage(state: AppState) {
    return (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
  }

  it('exposes Fable usage only for the Claude provider', () => {
    const claudeState = { ...defaultState(), activeProvider: 'claude', quota };
    const claudeUsage = buildUsage(claudeState);
    expect(claudeUsage.hasFable7dLimit).to.equal(true);
    expect(claudeUsage.utilizationFable7d).to.equal(0.56);

    const codexUsage = buildUsage({ ...claudeState, activeProvider: 'codex' });
    expect(codexUsage.hasFable7dLimit).to.equal(false);
  });

  it('keeps the Fable row visible at 0% after its reset time', () => {
    const expiredQuota = {
      ...quota,
      fableWeeklyResetAt: Date.now() - 1000,
    };
    const usage = buildUsage({ ...defaultState(), activeProvider: 'claude', quota: expiredQuota });

    expect(usage.hasFable7dLimit).to.equal(true);
    expect(usage.utilizationFable7d).to.equal(0);
  });

  it('shows a 0% Fable row for Claude while scoped usage is temporarily unavailable', () => {
    const quotaWithoutFable = { ...quota };
    delete quotaWithoutFable.fableWeeklyUsedPct;
    delete quotaWithoutFable.fableWeeklyResetAt;

    const usage = buildUsage({
      ...defaultState(),
      activeProvider: 'claude',
      quota: quotaWithoutFable,
    });

    expect(usage.hasFable7dLimit).to.equal(true);
    expect(usage.utilizationFable7d).to.equal(0);
  });

  it('places the Fable progress row below the shared 7d row', () => {
    const state = { ...defaultState(), activeProvider: 'claude', quota };
    const html = (DashboardPanel.prototype as any).getHtml.call(
      { store: { getState: () => state } },
      'test-nonce',
      'en',
    ) as string;

    expect(html.indexOf('id="row-fable-7d"')).to.be.greaterThan(html.indexOf('id="fill-7d"'));
    expect(html).to.include('Fable 5 · 7d window');
    expect(html).to.include('id="row-fable-7d" style=""');
  });

  it('lists every provider with separate checkbox and dashboard button', () => {
    const stub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key === 'statusBar.providers' ? ['codex', 'kimi'] : fallback,
    } as any);
    try {
      const html = (DashboardPanel.prototype as any).getHtml.call(
        { store: { getState: () => ({ ...defaultState(), activeProvider: 'kimi' }) } }, 'nonce', 'en',
      );
      expect(html).not.to.include('id="provider-select"');
      expect(html).to.include('id="btn-signin"');
      for (const id of ['codex', 'kimi', 'claude', 'glm', 'volcengine', 'cursor']) {
        expect(html).to.include(`data-provider-check="${id}"`);
        expect(html).to.include(`data-provider-open="${id}"`);
      }
      expect(html).to.match(/data-provider-check="kimi"[^>]* checked/);
      expect(html).not.to.match(/data-provider-check="claude"[^>]* checked/);
      expect(html).to.include('data-provider-open="kimi" aria-pressed="true"');
      for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(() => new Script(match[1])).not.to.throw();
      }
    } finally { stub.restore(); }
  });

  it('serializes rapid checkbox updates and rejects malformed messages', async () => {
    let selected = ['codex'];
    const stub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key === 'statusBar.providers' ? selected : fallback,
      update: async (_key: string, value: string[]) => { await Promise.resolve(); selected = value; },
    } as any);
    try {
      const target = { selectionUpdate: Promise.resolve() };
      const send = (msg: any) => (DashboardPanel.prototype as any).handleMessage.call(target, msg);
      send(null);
      send({ type: 'setStatusBarProvider', providerId: 'unknown', checked: true });
      send({ type: 'setStatusBarProvider', providerId: 'kimi', checked: 'yes' });
      send({ type: 'setStatusBarProvider', providerId: 'kimi', checked: true });
      send({ type: 'setStatusBarProvider', providerId: 'claude', checked: true });
      await target.selectionUpdate;
      expect(selected).to.deep.equal(['codex', 'kimi', 'claude']);
      for (const providerId of selected) send({ type: 'setStatusBarProvider', providerId, checked: false });
      await target.selectionUpdate;
      expect(selected).to.deep.equal(['kimi']);
    } finally { stub.restore(); }
  });

  it('unsubscribes the old model when the dashboard switches stores', () => {
    const oldStore = new Store();
    const newStore = new Store();
    newStore.dispatch({ type: 'SET_PROVIDER', payload: 'kimi' });
    DashboardPanel.createOrShow(oldStore);
    const panel = (DashboardPanel as any).instance;
    const update = sinon.stub(panel, 'sendUpdate');
    try {
      DashboardPanel.createOrShow(newStore);
      oldStore.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      expect(update.callCount).to.equal(0);
      newStore.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      expect(update.callCount).to.equal(1);
      expect(update.firstCall.args[0].activeProvider).to.equal('kimi');
    } finally {
      update.restore();
      panel.dispose();
    }
  });

  it('keeps the dashboard in its existing editor column while switching providers', () => {
    const first = new Store();
    const second = new Store();second.dispatch({ type: 'SET_PROVIDER', payload: 'deepseek' });
    DashboardPanel.createOrShow(first);
    const dashboard = (DashboardPanel as any).instance;
    dashboard.panel.viewColumn = 1;
    const reveal = sinon.spy(dashboard.panel, 'reveal');
    try {
      DashboardPanel.createOrShow(second);
      expect(reveal.calledOnceWithExactly(1)).to.equal(true);
      expect(dashboard.store).to.equal(second);
    } finally { reveal.restore();dashboard.dispose(); }
  });

  it('renders the active provider logo in every help icon while retaining tooltip and keyboard access', () => {
    for (const provider of ['codex', 'claude', 'kimi', 'glm', 'volcengine', 'deepseek', 'cursor']) {
      const html = (DashboardPanel.prototype as any).getHtml.call(
        { store: { getState: () => ({ ...defaultState(), activeProvider: provider }) } }, 'nonce', 'en') as string;
      expect(html).not.to.include('&#9432;');
      expect(html).not.to.include('$(openai)');expect(html).not.to.include('$(claude)');
      expect(html).to.match(/class="help-tip" tabindex="0" title="[^"]+" aria-label="[^"]+"><span class="provider-logo" aria-hidden="true">/);
      const expected:Record<string,string> = {kimi:'\uD83C\uDF18',glm:'\u26A1',volcengine:'\uD83C\uDF0B',deepseek:'\uD83D\uDC0B',cursor:'\uD83D\uDCA0'};
      if (expected[provider]) expect(html).to.include(expected[provider]);
      else expect(html).to.include('<svg');
    }
  });

  it('routes the login button to the dashboard provider', () => {
    const execute = sinon.stub(vscode.commands, 'executeCommand').resolves();
    try {
      (DashboardPanel.prototype as any).handleMessage.call({ store: { getState: () => ({ activeProvider: 'kimi' }) } }, { type: 'signIn' });
      expect(execute.calledWith('aiStatusHub.signIn', 'kimi')).to.equal(true);
    } finally { execute.restore(); }
  });
});

describe('Responsive paired heatmaps', () => {
  it('restores calendars after empty history and disposes the detached charts', () => {
    const html=(DashboardPanel.prototype as any).getHtml.call({store:{getState:()=>defaultState()}},'nonce','en') as string;
    const content:any={innerHTML:'',querySelector:()=>null};const days:any={textContent:''};
    const destroyed=[sinon.spy(),sinon.spy()];
    const sandbox:any={document:{getElementById:(id:string)=>id==='heatmap-content'?content:id==='heatmap-days'?days:null},
      esc:String,fmtNum:String,fmtCurrency:String,heatmapColdWarmColor:()=>'',historyRange:'day'};
    const source=html.slice(html.indexOf('    // ---- Heatmap ----'),html.indexOf('    // ---- Budget ----'));
    new Script(source+';globalThis.update=updateHeatmap;globalThis.setCharts=(a,b)=>{hourlyChartTokens=a;hourlyChartCost=b;};').runInNewContext(sandbox);
    const data={daily:[{date:'2026-11-18',tokensTotal:10,cost:1,sessionCount:1}]};
    sandbox.update(data);expect(content.innerHTML).to.include('class="heatmap-pair"');
    sandbox.setCharts({destroy:destroyed[0]},{destroy:destroyed[1]});
    sandbox.update({daily:[]});expect(days.textContent).to.equal('0');
    for(const spy of destroyed) expect(spy.calledOnce).to.equal(true);
    sandbox.update(data);expect(content.innerHTML).to.include('class="heatmap-pair"');
    sandbox.update(null);for(const spy of destroyed) expect(spy.calledOnce).to.equal(true);
  });
  it('gives month labels a shared single-line grid spanning their calendar columns', () => {
    const html=(DashboardPanel.prototype as any).getHtml.call({store:{getState:()=>defaultState()}},'nonce','en') as string;
    const sandbox:any={esc:(v:string)=>v,fmtNum:(v:number)=>String(v),heatmapColdWarmColor:()=>''};
    new Script(html.slice(html.indexOf('    // ---- Heatmap ----'),html.indexOf('    // ---- Budget ----'))
      +';globalThis.calendar=buildHeatmapCalendarHtml;').runInNewContext(sandbox);
    const daily=Array.from({length:31},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),value:1}));
    const result=sandbox.calendar(daily,(d:any)=>d.value,()=> '');
    expect(result.columns).to.equal(5);
    expect(result.headerHtml).to.include('grid-column:1 / span 5');
    expect((result.headerHtml.match(/class="hm-col-label"/g)||[]).length).to.equal(1);
    expect(html).to.include('Total token heatmap');
  });
  it('applies the layout to both calendars and restores it when the container expands', () => {
    const html=(DashboardPanel.prototype as any).getHtml.call(
      {store:{getState:()=>defaultState()}},'nonce','en') as string;
    const properties=new Map<string,string>();
    const pair={style:{setProperty:(key:string,value:string)=>properties.set(key,value)}};
    let width=142;
    const content={querySelector:()=>pair,getBoundingClientRect:()=>({width})};
    const sandbox:any={document:{getElementById:()=>content}};
    const source=html.slice(html.indexOf('    // ---- Heatmap ----'),html.indexOf('    // ---- Budget ----'));
    new Script(source+';heatmapColumns=10;globalThis.fit=fitHeatmaps;').runInNewContext(sandbox);
    sandbox.fit();expect(properties.get('--hm-cell-size')).to.equal('6px');
    expect(properties.get('--hm-gap')).to.equal('1px');expect(properties.get('--hm-calendar-width')).to.equal('69px');
    width=400;sandbox.fit();expect(properties.get('--hm-cell-size')).to.equal('12px');
    expect(properties.get('--hm-pair-gap')).to.equal('124px');
    width=0;sandbox.fit();expect(properties.get('--hm-cell-size')).to.equal('12px');
  });
  it('shrinks only the gap before scaling both calendars, and restores native size on expansion', () => {
    const layout=require('../src/calc').calculateHeatmapLayout;
    const columns=10; // Native width = 10*12 + 9*2 = 138.
    expect(layout(400,columns)).to.include({cellSize:12,cellGap:2,pairGap:124,calendarWidth:138});
    expect(layout(290,columns)).to.include({cellSize:12,cellGap:2,pairGap:14,calendarWidth:138});
    expect(layout(280,columns)).to.include({cellSize:12,cellGap:2,pairGap:4,calendarWidth:138});
    const small=layout(142,columns);
    expect(small.cellSize).to.equal(6);expect(small.cellGap).to.equal(1);expect(small.pairGap).to.equal(4);
    expect(small.calendarWidth*2+small.pairGap).to.equal(142);
    expect(layout(400,columns).cellSize).to.equal(12);
    expect(layout(800,columns).pairGap).to.equal(524);
    for(const count of [1,5,53,100]) {
      const result=layout(240,count);
      expect(result.calendarWidth*2+result.pairGap).to.be.at.most(240.000001);
      expect(result.cellSize).to.be.at.most(12);
    }
    for(const width of [0,NaN,Infinity]) expect(layout(width,10).cellSize).to.equal(12);
  });
});

describe('Cost curve title formatting', () => {
  it('uses the last actual cumulative sample, preserves currency and avoids fake zero for missing data', () => {
    const format=require('../src/calc').formatCostCurveTitle;
    expect(format('5h curve',[{cumulativeRmb:0},{cumulativeRmb:1.71},{cumulativeRmb:null}], '\u00a5')).to.equal('5h curve (\u00a51.71)');
    expect(format('7d curve',[{cumulativeRmb:6.71}], '$')).to.equal('7d curve ($6.71)');
    expect(format('5h curve',[], '$')).to.equal('5h curve');
    expect(format('5h curve',[{cumulativeRmb:null},{cumulativeRmb:NaN}], '$')).to.equal('5h curve');
  });
});

describe('Dashboard chart refresh', () => {
  function createCharts() {
    const html = (DashboardPanel.prototype as any).getHtml.call(
      { store: { getState: () => defaultState() } }, 'nonce', 'en',
    ) as string;
    const heights: number[] = [];
    const canvas = {
      getBoundingClientRect: () => ({ width: 400 }),
      get height() { return heights[heights.length - 1] || 160; },
      set height(value: number) { heights.push(value); },
    };
    const charts: any[] = [];
    const titles:Record<string,any> = {'costcurve-title-5h':{}, 'costcurve-title-7d':{}};
    const sandbox: any = {
      document: { getElementById: (id:string) => titles[id] || canvas, body: {} },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      chartHeightRatio: 0.4, CURRENCY_SYMBOL: '$',
      setTimeout, clearTimeout,
      Chart: function (_canvas: unknown, config: any) {
        const chart = { ...config, update: sinon.spy(), resize: sinon.spy() };
        charts.push(chart);
        return chart;
      },
    };
    // Execute the generated WebView functions, using a canvas whose height setter
    // records destructive bitmap resets (including identical assignments).
    new Script(html.slice(html.indexOf('    // ---- Heatmap ----'), html.indexOf('    // ---- Budget ----')) + `
      globalThis.api = { renderCostCurveChart, scheduleCostCurvePending, cancelCostCurvePending };
    `).runInNewContext(sandbox);
    return { api: sandbox.api, heights, charts, titles, setHeightRatio: (ratio: number) => { sandbox.chartHeightRatio = ratio; } };
  }

  for (const windowKey of ['5h', '7d']) {
    it(`shows the selected ${windowKey} cumulative total and clears it when changing periods`, () => {
      const {api,titles}=createCharts();
      const points=[{tMs:1000,cumulativeRmb:0},{tMs:1500,cumulativeRmb:1},{tMs:1800,cumulativeRmb:1.71},{tMs:2000,cumulativeRmb:null}];
      api.renderCostCurveChart(windowKey,points);
      expect(titles['costcurve-title-'+windowKey].textContent).to.equal(windowKey+' curve ($1.71)');
      api.scheduleCostCurvePending(windowKey,1000,2000);
      expect(titles['costcurve-title-'+windowKey].textContent).to.include('$1.71');
      api.cancelCostCurvePending(windowKey);
      api.scheduleCostCurvePending(windowKey,3000,4000);
      expect(titles['costcurve-title-'+windowKey].textContent).to.equal(windowKey+' curve');
      api.cancelCostCurvePending(windowKey);
      api.renderCostCurveChart(windowKey,[{tMs:3000,cumulativeRmb:0},{tMs:4000,cumulativeRmb:0}]);
      expect(titles['costcurve-title-'+windowKey].textContent).to.equal(windowKey+' curve ($0.00)');
    });

    it(`keeps the ${windowKey} curve visible while a same-window refresh is delayed`, () => {
      const clock = sinon.useFakeTimers();
      try {
        const { api, charts } = createCharts();
        api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 0 }, { tMs: 2000, cumulativeRmb: 2 }]);
        api.scheduleCostCurvePending(windowKey, 1000, 2000);
        clock.tick(1000);
        expect(charts[0].data.datasets[0].data.map((p: any) => p.y)).to.deep.equal([0, 2]);
        api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 0 }, { tMs: 2000, cumulativeRmb: 3 }]);
        expect(charts).to.have.length(1);
        expect(charts[0].data.datasets[0].data[1].y).to.equal(3);
        expect(charts[0].update.calledWith('none')).to.equal(true);
      } finally { clock.restore(); }
    });

    it(`does not reset the ${windowKey} canvas bitmap on data updates`, () => {
      const { api, heights, charts } = createCharts();
      api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 1 }]);
      expect(heights).to.deep.equal([160]);
      // Chart.js can change backing resolution for devicePixelRatio after creation.
      heights.push(320);
      api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 2 }]);
      expect(heights).to.deep.equal([160, 320]);
      expect(charts[0].resize.callCount).to.equal(0);
    });

    it(`applies height ratio changes to the existing ${windowKey} chart without resetting its bitmap`, () => {
      const { api, heights, charts, setHeightRatio } = createCharts();
      api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 1 }]);
      setHeightRatio(0.6);
      api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 2 }]);
      expect(charts).to.have.length(1);
      expect(heights).to.deep.equal([160]);
      expect(charts[0].options.aspectRatio).to.be.closeTo(400 / 240, 0.00001);
      expect(charts[0].resize.callCount).to.equal(1);
      api.renderCostCurveChart(windowKey, [{ tMs: 1000, cumulativeRmb: 3 }]);
      expect(charts[0].resize.callCount).to.equal(1);
    });
  }

  it('clears the previous window only when switching to a different range', () => {
    const clock = sinon.useFakeTimers();
    try {
      const { api, charts } = createCharts();
      api.renderCostCurveChart('5h', [{ tMs: 1000, cumulativeRmb: 1 }]);
      api.scheduleCostCurvePending('5h', 3000, 4000);
      clock.tick(150);
      expect(charts[0].data.datasets[0].data.map((p: any) => p.y)).to.deep.equal([null, null]);
      expect(charts[0].options.scales.x.min).to.equal(3000);
      expect(charts[0].options.scales.x.max).to.equal(4000);
    } finally { clock.restore(); }
  });

  it('cancels a pending clear when the requested window arrives promptly', () => {
    const clock = sinon.useFakeTimers();
    try {
      const { api, charts } = createCharts();
      api.renderCostCurveChart('7d', [{ tMs: 1000, cumulativeRmb: 1 }]);
      api.scheduleCostCurvePending('7d', 3000, 4000);
      api.cancelCostCurvePending('7d');
      api.renderCostCurveChart('7d', [{ tMs: 3000, cumulativeRmb: 4 }, { tMs: 4000, cumulativeRmb: 5 }]);
      clock.tick(1000);
      expect(charts[0].data.datasets[0].data.map((p: any) => p.y)).to.deep.equal([4, 5]);
    } finally { clock.restore(); }
  });
});


describe('Dashboard cost curve window selection', () => {
  const hour = 3600 * 1000;
  const start = new Date(2026, 10, 5, 20).getTime();
  function options(current: number, duration: number) {
    return [0, 1, 2].map(i => ({ startMs: current - i * duration, endMs: current + (1 - i) * duration, label: String(i) }));
  }
  function createSelector() {
    const html = (DashboardPanel.prototype as any).getHtml.call(
      { store: { getState: () => defaultState() } }, 'nonce', 'en',
    ) as string;
    const elements: Record<string, any> = {};
    for (const id of ['costcurve-body', 'costcurve-sel-5h-date', 'costcurve-sel-5h-hour', 'costcurve-sel-7d']) {
      elements[id] = {
        value: '', innerHTML: '',
        addEventListener(type: string, listener: () => void) { this['on' + type] = listener; },
      };
    }
    const messages: any[] = [];
    const sandbox: any = {
      document: { getElementById: (id: string) => elements[id] },
      vscode: { postMessage: (msg: any) => messages.push(msg) },
      esc: (value: string) => value, scheduleCostCurvePending: () => {},
    };
    new Script(html.slice(html.indexOf('    // ---- Cost Curve ----'), html.indexOf('    function densifyCostCurveSeries')) + `
      globalThis.refresh = (options) => { costCurveOptions = options; renderCostCurveCard(); };
    `).runInNewContext(sandbox);
    return {
      refresh(current: number, week = start) {
        messages.length = 0;
        sandbox.refresh({ options5h: options(current, 5 * hour), options7d: options(week, 7 * 24 * hour) });
      },
      change(id: string, value: string) { elements[id].value = value; elements[id].onchange(); },
      request(window: string) { return messages.filter(msg => msg.window === window).slice(-1)[0]; },
      date: (ms: number) => (new Date(ms).getMonth() + 1) + '.' + new Date(ms).getDate(),
    };
  }

  it('follows the current 5h window across midnight and subsequent refreshes', () => {
    const ui = createSelector();
    ui.refresh(start);
    ui.refresh(start + 5 * hour);
    expect(ui.request('5h').startMs).to.equal(start + 5 * hour);
    ui.refresh(start + 5 * hour);
    expect(ui.request('5h').startMs).to.equal(start + 5 * hour);
    ui.refresh(start + 10 * hour);
    expect(ui.request('5h').startMs).to.equal(start + 10 * hour);
  });

  it('keeps a manually selected historical hour and resumes following after selecting current', () => {
    const ui = createSelector();
    ui.refresh(start);
    ui.change('costcurve-sel-5h-hour', String(start - 5 * hour));
    ui.refresh(start + 5 * hour);
    expect(ui.request('5h').startMs).to.equal(start - 5 * hour);
    ui.change('costcurve-sel-5h-date', ui.date(start + 5 * hour));
    expect(ui.request('5h').startMs).to.equal(start + 5 * hour);
    ui.refresh(start + 10 * hour);
    expect(ui.request('5h').startMs).to.equal(start + 10 * hour);
  });

  it('uses refreshed hour options in change handlers', () => {
    const ui = createSelector();
    ui.refresh(start);
    ui.refresh(start + 5 * hour);
    ui.change('costcurve-sel-5h-date', ui.date(start + 5 * hour));
    ui.change('costcurve-sel-5h-hour', String(start + 5 * hour));
    expect(ui.request('5h').startMs).to.equal(start + 5 * hour);
  });

  it('keeps a manually selected historical date while the current window advances', () => {
    const ui = createSelector();
    ui.refresh(start + 5 * hour);
    ui.change('costcurve-sel-5h-date', ui.date(start));
    ui.refresh(start + 10 * hour);
    expect(ui.request('5h').startMs).to.equal(start);
  });

  it('returns to the current window when a historical selection expires from the list', () => {
    const ui = createSelector();
    ui.refresh(start);
    ui.change('costcurve-sel-5h-hour', String(start - 10 * hour));
    ui.refresh(start + 5 * hour);
    expect(ui.request('5h').startMs).to.equal(start + 5 * hour);
  });

  it('follows the current 7d window and preserves manually selected history independently', () => {
    const ui = createSelector();
    ui.refresh(start);
    const nextWeek = start + 7 * 24 * hour;
    ui.refresh(start, nextWeek);
    expect(ui.request('7d').startMs).to.equal(nextWeek);
    ui.change('costcurve-sel-7d', String(start));
    ui.refresh(start, nextWeek + 7 * 24 * hour);
    expect(ui.request('7d').startMs).to.equal(start);
    ui.change('costcurve-sel-7d', String(nextWeek + 7 * 24 * hour));
    expect(ui.request('7d').startMs).to.equal(nextWeek + 7 * 24 * hour);
    ui.refresh(start, nextWeek + 14 * 24 * hour);
    expect(ui.request('7d').startMs).to.equal(nextWeek + 14 * 24 * hour);
  });
});
