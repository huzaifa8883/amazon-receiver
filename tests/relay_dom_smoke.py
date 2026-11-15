"""Synthetic shift weekday range and login-page recognition; no live Amazon access."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        await page.set_content('''<html><body><h3>Step 2 of 6</h3>
        <article class="shift-card"><div>Hours: 30 hours/week</div><div>Shift: Mon–Fri 07:00–13:30</div>
        <div>Start date: 16 Nov 2026</div><div>End date: 16 Jan 2027</div><div>Pay: £16.10/hr</div>
        <div>Location: BS35 4BR</div></article></body></html>''')
        await page.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__msg=fn}},sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
        await page.add_script_tag(path=str(ROOT/'src/adapter.js'))
        await page.evaluate("() => window.__msg({type:'ENABLE',generation:42},null,()=>{})")
        await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
        snap=await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
        assert len(snap['shiftCards'])==1,snap
        assert snap['shiftCards'][0]['workingDays']==5,snap['shiftCards'][0]
        await page.close()
        login=await browser.new_page()
        await login.set_content('<h1>Sign in</h1><form><input type="password" placeholder="Password"></form>')
        await login.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__msg=fn}},sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
        await login.add_script_tag(path=str(ROOT/'src/adapter.js'))
        await login.evaluate("() => window.__msg({type:'ENABLE',generation:42},null,()=>{})")
        await login.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
        snap2=await login.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
        assert snap2['loginRequired'] and not snap2['securityBlocked'],snap2
        await browser.close()
        print('PASS: Mon–Fri counts as five days; login detected separately from verification')
if __name__=='__main__':asyncio.run(main())
