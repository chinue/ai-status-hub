// DESIGN: v2-test-design.md#deepseek-web-billing
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as calc from '../src/calc';
import { DeepseekApiProvider } from '../src/providers/deepseek/api';
import { DeepseekAuthProvider } from '../src/providers/deepseek/auth';
import { activate, deactivate } from '../src/extension';
import { Scheduler } from '../src/services/scheduler';
import { CacheService } from '../src/services/cacheService';
import { ApiHistoryService } from '../src/services/apiHistoryService';
import { MemorySecretStorage, makeContext } from './mocks/vscode';
import { DashboardPanel } from '../src/presenters/dashboard';
import { ConfigService } from '../src/config';
import { defaultState } from '../src/store';
import { Script } from 'vm';
const wrap = (data: unknown) => ({ code: 0, data: { biz_code: 0, biz_data: data } });
const summary = () => wrap({ total_costs: [{currency:'CNY',amount:'30'}], normal_wallets:[{currency:'CNY',balance:'65'}],bonus_wallets:[{currency:'CNY',balance:'5'}] });
const invoices = () => wrap({invoices:{payment_orders:[{payment_order_id:'a',amount:'100',currency:'CNY',payment_order_status:'SUCCESS'},{payment_order_id:'b',amount:'20',currency:'CNY',payment_order_status:'REFUNDED'},{payment_order_id:'c',amount:'99',currency:'CNY',payment_order_status:'PENDING'}],bonus_orders:[{amount:'5',currency:'CNY'}]}});
const reply = (data: unknown) => ({status:200,ok:true,json:async()=>data});
describe('DeepSeek web billing', () => {
 afterEach(()=>sinon.restore());
 it('parses official summary and successful/refunded recharge orders without mixing currencies or grants', () => {
  const parse=(calc as any).parseDeepseekWebSummary, recharge=(calc as any).parseDeepseekRecharge;
  expect(parse(summary(),'CNY')).to.deep.equal({currency:'CNY',spent:30,available:70});
  expect(recharge(invoices(),'CNY')).to.deep.equal({recharged:120,refunded:20});
  expect(parse(summary(),'USD')).to.equal(null);
  expect(parse(wrap({total_costs:[],normal_wallets:[],bonus_wallets:[]}),'CNY')).to.equal(null);
  expect(recharge(wrap({invoices:{payment_orders:[]}}),'CNY')).to.deep.equal({recharged:0,refunded:0});
  expect(recharge(wrap({invoices:{payment_orders:[{currency:'CNY',payment_order_status:'UNKNOWN',amount:1}]}}),'CNY')).to.equal(null);
 });
 it('rejects invalid money and incomplete envelopes and deduplicates orders conservatively', () => {
  const parse=(calc as any).parseDeepseekWebSummary, recharge=(calc as any).parseDeepseekRecharge;
  for(const money of [null, true, '', '-1', 'NaN', Infinity]) {
   const raw=summary();(raw.data.biz_data as any).total_costs[0].amount=money;
   expect(parse(raw,'CNY')).to.equal(null);
  }
  expect(parse({code:401,data:{biz_code:0,biz_data:{}}},'CNY')).to.equal(null);
  const raw=invoices();const data=raw.data.biz_data as any;
  data.invoices.payment_orders.push({...data.invoices.payment_orders[0]});
  data.invoices.payment_orders.push({payment_order_id:'usd',amount:999,currency:'USD',payment_order_status:'SUCCESS'});
  expect(recharge(raw,'CNY')).to.deep.equal({recharged:120,refunded:20});
  data.invoices.payment_orders.push({...data.invoices.payment_orders[0],amount:'101'});
  expect(recharge(raw,'CNY')).to.equal(null);
 });
 it('formats spent over spent-plus-available, independently from recharge totals', () => {
  const f=(calc as any).formatDeepseekBilling;
  const data={currency:'CNY',spent:30,available:70,recharged:120,refunded:20};
  expect(f(data,'en').usedPct).to.equal(30);
  expect(f({...data,recharged:9999},'en').usedPct).to.equal(30);
  expect(f({...data,spent:0,available:0},'en').usedPct).to.equal(undefined);
  expect(f(data,'en').details).to.include('120.00');
  const state={...defaultState(),activeProvider:'deepseek',quota:{balance:{currency:'CNY',total:70,granted:5,toppedUp:65,isAvailable:true},accountBilling:data}};
  expect(calc.formatProviderStatus(state as any,'icon','DeepSeek','absolute')).to.include('30.00%');
 });
 it('queries only the two fixed read-only website routes with strict TLS and sanitizes partial failures', async () => {
  const {DeepseekWebApi}=require('../src/providers/deepseek/webApi');
  const fetcher=sinon.stub().callsFake(async (url:string)=>reply(url.includes('summary')?summary():invoices()));
  const result=await new DeepseekWebApi(fetcher).fetchBilling('web-fixture','CNY');
  expect(result.data).to.include({spent:30,available:70,recharged:120});
  expect(fetcher.callCount).to.equal(2);
  for(const call of fetcher.getCalls()){
   expect(call.args[0]).to.match(/^https:\/\/platform\.deepseek\.com\/(api\/v0\/users\/get_user_summary|auth-api\/v0\/users\/get_all_invoice)$/);
   expect(call.args[1].method).to.equal('GET');expect(call.args[1].redirect).to.equal('error');
   expect(call.args[1].agent.options.rejectUnauthorized).to.equal(true);
   expect(call.args[1].headers.Authorization).to.equal('Bearer web-fixture');
  }
  fetcher.resetHistory();
  expect((await new DeepseekWebApi(fetcher).fetchBilling('web-fixture','CNY',true)).ok).to.equal(true);
  expect(fetcher.calledOnce).to.equal(true);expect(fetcher.firstCall.args[0]).to.include('get_user_summary');
  const partial=await new DeepseekWebApi((async (url:string)=>url.includes('summary')?reply(summary()):{status:401}) as any).fetchBilling('web-fixture','CNY');
  expect(partial.data).to.include({spent:30,available:70});expect(partial.data.recharged).to.equal(undefined);
  const denied=await new DeepseekWebApi((async()=>({status:401})) as any).fetchBilling('private-fixture','CNY');
  expect(denied.ok).to.equal(false);expect(JSON.stringify(denied)).not.to.include('private-fixture');
 });
 it('polls only the API balance and computes consumption from the configured initial amount', async () => {
  const fetcher=sinon.stub().resolves(reply({is_available:true,balance_infos:[{currency:'CNY',total_balance:'1.61',granted_balance:'0',topped_up_balance:'1.61'}]}));
  const webGetter=sinon.stub().resolves('web-fixture');
  const api=new (DeepseekApiProvider as any)(fetcher,webGetter);
  const result=await api.fetchQuota('api-fixture');
  expect(result.data.accountBilling.spent).to.be.closeTo(8.39,1e-9);
  expect(result.data.accountBilling.initialAmount).to.equal(10);
  expect(fetcher.calledOnce).to.equal(true);expect(webGetter.called).to.equal(false);
 });
 it('calculates a calibrated initial amount using the base cost and rejects unusable amounts', () => {
  const compute=(calc as any).calculateDeepseekInitialAmount;
  expect(compute(98.38,1.62,90)).to.equal(10);
  expect(compute(98.39,1.62,90)).to.equal(10.01);
  for(const args of [[0,0,0],[10,1,11],[10,1,-1],[NaN,1,0],[10,Infinity,0]]) expect(compute(...args)).to.equal(null);
  const data=(calc as any).buildDeepseekBalanceBilling({currency:'CNY',total:1.61},10,90);
  expect(data.spent).to.be.closeTo(8.39,1e-9);
  const view=(calc as any).formatDeepseekBilling(data,'en');
  expect(view.usedPct).to.be.closeTo(83.9,1e-9);
  expect(view.summary).to.include('8.39');expect(view.summary).to.include('10.0');
  expect(view.details).to.include('90.00');
 });
 it('validates a password-input web token before saving separately, keeps old credentials on cancellation, and clears it on sign-out', async () => {
  const secrets=new MemorySecretStorage();await secrets.store('aiStatusHub.deepseek.apiKey','api-fixture');
  const auth=new (DeepseekAuthProvider as any)({fetchQuota:async()=>({ok:true})},{fetchBilling:async()=>({ok:true,data:{spent:30,available:70,currency:'CNY'}})});auth.initSecrets(secrets);
  sinon.stub(vscode.window,'showInformationMessage').resolves('Continue' as any);
  const saved=sinon.stub(ConfigService.prototype,'setDeepseekInitialAmount').resolves(true);
  const input=sinon.stub(vscode.window,'showInputBox').resolves(' Bearer web-fixture ' as any);
  expect(await auth.startWebLoginFlow()).to.equal(true);expect(await auth.resolveWebToken()).to.equal('web-fixture');
  expect(saved.calledOnceWithExactly(100)).to.equal(true);
  expect(input.firstCall.args[0]?.password).to.equal(true);
  expect(await secrets.get('aiStatusHub.deepseek.apiKey')).to.equal('api-fixture');
  input.resolves(undefined);expect(await auth.startWebLoginFlow()).to.equal(false);expect(await auth.resolveWebToken()).to.equal('web-fixture');
  await auth.signOut();expect(await auth.resolveWebToken()).to.equal(undefined);
 });
 it('opens settings from calibration without querying the website or changing the initial amount', async () => {
  const web={fetchBilling:sinon.spy()};const auth=new (DeepseekAuthProvider as any)(undefined,web);
  sinon.stub(vscode.window,'showInformationMessage').resolves('Edit Setting' as any);
  const command=sinon.stub(vscode.commands,'executeCommand').resolves();const input=sinon.stub(vscode.window,'showInputBox');
  expect(await auth.startWebLoginFlow()).to.equal(false);
  expect(command.calledWith('workbench.action.openSettings','aiStatusHub.deepseek')).to.equal(true);
  expect(web.fetchBilling.called).to.equal(false);expect(input.called).to.equal(false);
 });
 it('persists the initial amount in user settings and reports save failures without accepting invalid values', async () => {
  const update=sinon.stub().resolves();
  sinon.stub(vscode.workspace,'getConfiguration').returns({get:(_key:string,fallback:unknown)=>fallback,update} as any);
  const config=ConfigService.getInstance();expect(config.deepseekBaseCost).to.equal(0);expect(config.deepseekInitialAmount).to.equal(10);
  expect(await config.setDeepseekInitialAmount(10.01)).to.equal(true);
  expect(update.calledOnceWithExactly('deepseek.initialAmount',10.01,true)).to.equal(true);
  expect(await config.setDeepseekInitialAmount(0)).to.equal(false);
  expect(await config.setDeepseekInitialAmount(NaN)).to.equal(false);expect(update.calledOnce).to.equal(true);
  update.rejects(new Error('settings-write-failed'));expect(await config.setDeepseekInitialAmount(20)).to.equal(false);
 });
 it('applies base cost once when manually calibrating and keeps the saved amount on validation or save failure', async () => {
  const values:Record<string,unknown>={'deepseek.baseCost':90};
  sinon.stub(vscode.workspace,'getConfiguration').returns({get:(key:string,fallback:unknown)=>values[key]??fallback} as any);
  const web={fetchBilling:sinon.stub().resolves({ok:true,data:{currency:'CNY',spent:98.38,available:1.62}})};
  const auth=new (DeepseekAuthProvider as any)(undefined,web);const secrets=new MemorySecretStorage();auth.initSecrets(secrets);
  sinon.stub(vscode.window,'showInformationMessage').resolves('Calibrate' as any);
  sinon.stub(vscode.window,'showInputBox').resolves('web-fixture' as any);
  const save=sinon.stub(ConfigService.prototype,'setDeepseekInitialAmount').resolves(true);
  expect(await auth.startWebLoginFlow()).to.equal(true);expect(save.calledOnceWithExactly(10)).to.equal(true);
  values['deepseek.baseCost']=100;expect(await auth.startWebLoginFlow()).to.equal(false);expect(save.calledOnce).to.equal(true);
  values['deepseek.baseCost']=90;save.resolves(false);expect(await auth.startWebLoginFlow()).to.equal(false);
 });
 it('contains network, JSON and validation errors without exposing credentials or replacing a saved web login', async () => {
  const {DeepseekWebApi}=require('../src/providers/deepseek/webApi');
  for(const fetcher of [async()=>{throw new Error('private-fixture');},async()=>({ok:true,json:async()=>{throw new Error('private-fixture');}})]) {
   const result=await new DeepseekWebApi(fetcher).fetchBilling('private-fixture','CNY');
   expect(result.ok).to.equal(false);expect(JSON.stringify(result)).not.to.include('private-fixture');
  }
  const secrets=new MemorySecretStorage();await secrets.store('aiStatusHub.deepseek.webToken','old-web');
  const auth=new (DeepseekAuthProvider as any)(undefined,{fetchBilling:async()=>({ok:false,error:'Query unavailable'})});auth.initSecrets(secrets);
  sinon.stub(vscode.window,'showInformationMessage').resolves('Continue' as any);
  sinon.stub(vscode.window,'showInputBox').resolves('invalid-web' as any);
  expect(await auth.startWebLoginFlow()).to.equal(false);expect(await auth.resolveWebToken()).to.equal('old-web');
 });
 it('aborts both stalled website reads and clears the deadline', async () => {
  const {DeepseekWebApi}=require('../src/providers/deepseek/webApi');const clock=sinon.useFakeTimers();
  try {
   const fetcher=(_url:string,options:any)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
   const pending=new DeepseekWebApi(fetcher).fetchBilling('web-fixture','CNY');
   await clock.tickAsync(15000);expect((await pending).ok).to.equal(false);expect(clock.countTimers()).to.equal(0);
  } finally { clock.restore(); }
 });
 it('renders official account percentage and billing totals and connects the website action', () => {
  sinon.stub(vscode.workspace,'getConfiguration').returns({get:(key:string,fallback:unknown)=>key==='deepseek.initialAmount'?100:fallback} as any);
  const state={...defaultState(),activeProvider:'deepseek',quota:{balance:{currency:'CNY',total:70,granted:5,toppedUp:65,isAvailable:true},accountBilling:{currency:'CNY',spent:30,available:70,recharged:120,refunded:20}}};
  const usage=(DashboardPanel.prototype as any).buildKimiUsageData.call({},state);
  expect(usage.accountBilling.usedPct).to.equal(30);
  const html=(DashboardPanel.prototype as any).getHtml.call({store:{getState:()=>state}},'nonce','en');
  expect(html).to.include('id="row-account-billing"');
  const nodes=new Map();const document={getElementById(id:string){if(!nodes.has(id))nodes.set(id,{style:{},textContent:''});return nodes.get(id);}};
  const sandbox:any={document,labels:{},CURRENCY_SYMBOL:'\u00a5',vscode:{postMessage:sinon.spy()}};
  const source=html.slice(html.indexOf('    function renderCurrentUsage('),html.indexOf('      // Memory breakdown'))+'\n}';
  new Script(source+'\nglobalThis.render=renderCurrentUsage').runInNewContext(sandbox);
  sandbox.render(usage,'percent');expect(nodes.get('fill-account-billing').style.width).to.equal('30%');
  expect(html).not.to.include('id="meta-account-billing"');
  expect(html).not.to.include('id="detail-account-billing"');
  expect(nodes.get('fill-account-billing').title).to.include('70.00');
  expect(html.indexOf('id="lbl-balance"')).to.be.lessThan(html.indexOf('id="btn-deepseek-web"'));
  expect(html.indexOf('id="btn-deepseek-web"')).to.be.lessThan(html.indexOf('id="row-account-billing"'));
  nodes.get('btn-deepseek-web').onclick();expect(sandbox.vscode.postMessage.firstCall.args[0].type).to.equal('connectDeepseekWeb');
  sandbox.render({...usage,isBalanceProvider:false},'percent');
  expect(nodes.get('row-account-billing').style.display).to.equal('none');
  expect(nodes.get('fill-account-billing').title).to.equal('');
  expect(nodes.get('fill-account-billing').style.width).to.equal('0%');
 });
 it('registers the web connection command, refreshes DeepSeek and signs out without clearing other providers', async () => {
  const commands=new Map<string,Function>();
  sinon.stub(vscode.workspace,'getConfiguration').returns({get:(key:string,fallback:unknown)=>key==='provider'?'deepseek':fallback} as any);
  sinon.stub(vscode.commands,'registerCommand').callsFake((name:string,callback:any)=>{commands.set(name,callback);return{dispose(){}};});
  sinon.stub(Scheduler.prototype,'start');const force=sinon.stub(Scheduler.prototype,'force');
  sinon.stub(CacheService.prototype,'read').resolves(null);sinon.stub(ApiHistoryService.prototype,'readFromDisk').resolves([]);
  const login=sinon.stub(DeepseekAuthProvider.prototype,'startWebLoginFlow').resolves(true);const context=makeContext();
  await context.secrets.store('aiStatusHub.deepseek.webToken','web-fixture');await context.secrets.store('aiStatusHub.apiKey','kimi-fixture');
  try {
   await activate(context as any);await commands.get('aiStatusHub.deepseekConnectWeb')!();
   expect(login.calledOnce).to.equal(true);expect(force.calledOnce).to.equal(true);
   await commands.get('aiStatusHub.signOut')!('deepseek');
   expect(await context.secrets.get('aiStatusHub.deepseek.webToken')).to.equal(undefined);
   expect(await context.secrets.get('aiStatusHub.apiKey')).to.equal('kimi-fixture');
  } finally { for(const item of context.subscriptions)item.dispose();await deactivate(); }
 });

});
