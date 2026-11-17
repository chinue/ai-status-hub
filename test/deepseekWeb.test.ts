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
  expect(f(data,'en').summary).to.include('120.00');
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
  const partial=await new DeepseekWebApi((async (url:string)=>url.includes('summary')?reply(summary()):{status:401}) as any).fetchBilling('web-fixture','CNY');
  expect(partial.data).to.include({spent:30,available:70});expect(partial.data.recharged).to.equal(undefined);
  const denied=await new DeepseekWebApi((async()=>({status:401})) as any).fetchBilling('private-fixture','CNY');
  expect(denied.ok).to.equal(false);expect(JSON.stringify(denied)).not.to.include('private-fixture');
 });
 it('supplements balance without sending web credentials to the model API and preserves balance on web failure', async () => {
  const fetcher=sinon.stub().callsFake(async(url:string)=>reply(url.includes('/user/balance')?{is_available:true,balance_infos:[{currency:'CNY',total_balance:'70',granted_balance:'5',topped_up_balance:'65'}]}:url.includes('summary')?summary():invoices()));
  const api=new (DeepseekApiProvider as any)(fetcher,async()=>'web-fixture');
  const result=await api.fetchQuota('api-fixture');
  expect(result.data.accountBilling.spent).to.equal(30);
  expect(fetcher.firstCall.args[1].headers.Authorization).to.equal('Bearer api-fixture');
  fetcher.callsFake(async(url:string)=>url.includes('/user/balance')?reply({is_available:true,balance_infos:[{currency:'CNY',total_balance:'70',granted_balance:'5',topped_up_balance:'65'}]}):{status:401});
  expect((await api.fetchQuota('api-fixture')).data.balance.total).to.equal(70);
 });
 it('validates a password-input web token before saving separately, keeps old credentials on cancellation, and clears it on sign-out', async () => {
  const secrets=new MemorySecretStorage();await secrets.store('aiStatusHub.deepseek.apiKey','api-fixture');
  const auth=new (DeepseekAuthProvider as any)({fetchQuota:async()=>({ok:true})},{fetchBilling:async()=>({ok:true,data:{spent:30,available:70,currency:'CNY'}})});auth.initSecrets(secrets);
  sinon.stub(vscode.window,'showInformationMessage').resolves('Continue' as any);
  const input=sinon.stub(vscode.window,'showInputBox').resolves(' Bearer web-fixture ' as any);
  expect(await auth.startWebLoginFlow()).to.equal(true);expect(await auth.resolveWebToken()).to.equal('web-fixture');
  expect(input.firstCall.args[0]?.password).to.equal(true);
  expect(await secrets.get('aiStatusHub.deepseek.apiKey')).to.equal('api-fixture');
  input.resolves(undefined);expect(await auth.startWebLoginFlow()).to.equal(false);expect(await auth.resolveWebToken()).to.equal('web-fixture');
  await auth.signOut();expect(await auth.resolveWebToken()).to.equal(undefined);
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
  const state={...defaultState(),activeProvider:'deepseek',quota:{accountBilling:{currency:'CNY',spent:30,available:70,recharged:120,refunded:20}}};
  const usage=(DashboardPanel.prototype as any).buildKimiUsageData.call({},state);
  expect(usage.accountBilling.usedPct).to.equal(30);
  const html=(DashboardPanel.prototype as any).getHtml.call({store:{getState:()=>state}},'nonce','en');
  expect(html).to.include('id="row-account-billing"');
  const nodes=new Map();const document={getElementById(id:string){if(!nodes.has(id))nodes.set(id,{style:{},textContent:''});return nodes.get(id);}};
  const sandbox:any={document,labels:{},CURRENCY_SYMBOL:'\u00a5',vscode:{postMessage:sinon.spy()}};
  const source=html.slice(html.indexOf('    function renderCurrentUsage('),html.indexOf('      // Memory breakdown'))+'\n}';
  new Script(source+'\nglobalThis.render=renderCurrentUsage').runInNewContext(sandbox);
  sandbox.render(usage,'percent');expect(nodes.get('fill-account-billing').style.width).to.equal('30%');
  expect(nodes.get('meta-account-billing').textContent).to.include('120.00');
  nodes.get('btn-deepseek-web').onclick();expect(sandbox.vscode.postMessage.firstCall.args[0].type).to.equal('connectDeepseekWeb');
  sandbox.render({...usage,isBalanceProvider:false},'percent');
  expect(nodes.get('row-account-billing').style.display).to.equal('none');
  expect(nodes.get('meta-account-billing').textContent).to.equal('');
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
