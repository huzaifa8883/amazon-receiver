"""Synthetic page with progress text in generic elements and generic shift cards.
Does not use Amazon or any live application.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><body>
  <div class="progress-shell"><span>Step 2 of 6</span><div role="progressbar" aria-valuenow="2"></div></div>
  <h3>Select Work Shift</h3>
  <div class="x01" onclick="this.dataset.clicked='yes'">
    <div><span>Hours: 24 hours/week</span></div>
    <div><span>Shift: Mon, Tue, Wed, Thu 6:00 - 12:30</span></div>
  </div>
  <div class="x02" onclick="this.dataset.clicked='yes'">
    <div>Hours: 12hrs per week</div>
    <div>Shift: Mon, Tue, Wed, Thu, Fri 8:00 - 10:30</div>
  </div>
  <button aria-label="Open navigation menu" id="menu"><svg viewBox="0 0 24 24"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/></svg></button>
  <div hidden>Step 2 of 6 <h2>Security check</h2><form><input type="password" /></form></div>
  </body></html>'''
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page()
    await page.set_content(HTML)
    await page.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__chromeMessage=fn}},sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
    await page.add_script_tag(path=str(ROOT/'src/adapter.js'))
    await page.evaluate("() => window.__chromeMessage({type:'ENABLE',generation:41},null,()=>{})")
    await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
    snap=await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
    assert snap['step2'],snap
    assert not snap['loading'],'A step-progress bar is not an active loading spinner'
    assert not snap['securityBlocked'],'Hidden login widgets should not stop extension'
    assert snap['buttons'].get('menu'),snap['buttons']
    assert snap['shiftListReady'],snap
    assert len(snap['shiftCards'])==2,snap['shiftCards']
    by_hours={c['weeklyHours']:c for c in snap['shiftCards']}
    assert set(by_hours)=={12,24},by_hours
    assert by_hours[12]['workingDays']==5,by_hours
    assert by_hours[12]['startTime']=='08:00',by_hours
    selected=by_hours[12]
    click=await page.evaluate('''id=>new Promise(resolve=>window.__chromeMessage({type:'CLICK',generation:41,id,label:'Click 7'},null,resolve))''',selected['id'])
    assert click['ok'],click
    assert await page.locator('.x02').get_attribute('data-clicked')=='yes'
    assert await page.locator('.x01').get_attribute('data-clicked') is None
    await browser.close()
    print('PASS: DIV/SPAN Step 2 detection, progress bar not loading, generic shift cards, menu, guarded click')
if __name__=='__main__':asyncio.run(main())
