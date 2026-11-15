"""Synthetic active human check and hidden-template controls. Never accesses Amazon."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
ACTIVE='''<!doctype html><html lang="en"><body>
<main style="margin:25px 40px;width:400px"><h1>Let's confirm you are human</h1>
<p>Complete the security check before continuing. This step verifies that you are not a bot, which helps to protect your account and prevent spam.</p>
<button id="begin" onclick="this.dataset.clicked='true'">Begin ❯</button><select><option>English</option></select>
<button id="next" onclick="this.dataset.clicked='true'">Next</button></main></body></html>'''
INACTIVE='''<!doctype html><html><body><h1>Select Work Shift</h1><div>Step 2 of 6</div>
<div style="display:none"><h2>Let's confirm you are human</h2>
<p>Complete the security check before continuing.</p><button>Begin</button><form><input type="password"></form></div>
<p>Need help with a security check? Read our security guidance.</p>
<button id="next">Next</button></body></html>'''
async def snapshot(page):
  await page.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(f){window.__msg=f}},
    sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
  await page.add_script_tag(path=str(ROOT/'src/adapter.js'))
  await page.evaluate("() => window.__msg({type:'ENABLE',generation:42},null,()=>{})")
  await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
  return await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    active=await browser.new_page(viewport={'width':800,'height':700})
    await active.set_content(ACTIVE)
    snap=await snapshot(active)
    assert snap['securityBlocked'],snap
    status=await active.evaluate("() => new Promise(resolve=>window.__msg({type:'SECURITY_STATUS'},null,resolve))")
    assert all(status.get(k)==v for k,v in {'ok':True,'blocked':True,'loginRequired':False}.items()),status
    click=await active.evaluate("id => new Promise(resolve=>window.__msg({type:'CLICK',generation:42,id,label:'Click 3 — Next'},null,resolve))",snap['buttons']['next'])
    assert not click['ok'] and 'security' in click['reason'].lower(),click
    assert await active.locator('#next').get_attribute('data-clicked') is None
    assert await active.locator('#begin').get_attribute('data-clicked') is None
    hidden=await browser.new_page()
    await hidden.set_content(INACTIVE)
    snap2=await snapshot(hidden)
    assert not snap2['securityBlocked'],snap2
    await browser.close()
  print('PASS: active human verification blocks clicks; hidden/inactive markup does not')
if __name__=='__main__':asyncio.run(main())
