"""Synthetic HTML of the reported no-shift route. Does not visit Amazon."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><title>Amazon jobs</title></head><body>
<header style="height:85px;padding:5px 30px"><a id="brand" aria-label="Amazon Jobs" href="https://www.jobsatamazon.co.uk/app#/jobSearch" onclick="event.preventDefault();this.dataset.clicked='true'" style="display:inline-block; width:145px;height:48px">amazonjobs</a></header>
<main><h1>More shift are on the way!</h1>
<p>We post jobs often so submit your shift preferences and we will contact you when we find a shift that works for you.</p>
<button id="prefs" onclick="this.dataset.clicked='true'">Submit your shift preferences</button></main>
</body></html>'''
HIDDEN='''<!doctype html><html><body><h1>Available Shifts</h1>
<div style="display:none"><h1>More shift are on the way!</h1><p>We post jobs often so submit your shift preferences</p></div>
<p>Hours: 12hrs per week</p><p>Shift: Mon, Tue, Wed, Thu, Fri 8:00 - 10:30</p>
</body></html>'''
async def observe(page):
  await page.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__msg=fn}},sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
  await page.add_script_tag(path=str(ROOT/'src/adapter.js'))
  await page.evaluate("() => window.__msg({type:'ENABLE',generation:12},null,()=>{})")
  await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
  return await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
async def main():
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=await browser.new_page(viewport={'width':1500,'height':800})
    await page.set_content(HTML)
    obs=await observe(page)
    assert obs['noShiftPage'] and not obs['step2'] and obs['shiftCards']==[],obs
    assert obs['appEvidence'] and not obs['securityBlocked'],obs
    assert obs['buttons'].get('homeLogo'),obs['buttons']
    result=await page.evaluate('''id => new Promise(resolve=>window.__msg({type:'CLICK',generation:12,id,label:'Click 7A — Amazon Jobs logo'},null,resolve))''',obs['buttons']['homeLogo'])
    assert result['ok'],result
    assert await page.locator('#brand').get_attribute('data-clicked')=='true'
    assert await page.locator('#prefs').get_attribute('data-clicked') is None
    hidden=await browser.new_page()
    await hidden.set_content(HIDDEN)
    obs2=await observe(hidden)
    assert not obs2['noShiftPage'],obs2
    await browser.close()
  print('PASS: visible no-shifts page follows logo path without submitting preferences; hidden template ignored')
if __name__=='__main__': asyncio.run(main())
