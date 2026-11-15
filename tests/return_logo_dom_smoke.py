"""Synthetic application page logo target detection; no Amazon website is accessed."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><title>Amazon Application</title></head><body>
<div class="warning">We couldn't get your location.</div>
<header style="height:110px"><a href="https://www.jobsatamazon.co.uk/app#/jobSearch" id="jobsLogo"
  onclick="event.preventDefault();this.dataset.clicked='yes'"
  style="display:inline-block;margin-left:42px;margin-top:14px;width:140px;height:44px;">
  <img alt="amazonjobs" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
  style="display:block;width:140px;height:44px" /></a></header>
<div><span>Delivery Station Warehouse Associate</span><div>Step 2 of 6</div></div>
<article class="shift-card"><div>Hours: 40hrs per week</div>
  <div>Shift: Wed, Thu, Fri, Sat 7:00 - 17:30</div></article>
<footer><a href="https://www.jobsatamazon.co.uk" id="footerBrand">Amazon Jobs help</a></footer>
</body></html>'''

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page(viewport={'width':1490,'height':770})
    await page.set_content(HTML)
    await page.evaluate("""() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(f){window.__message=f}},
     sendMessage:async s=>{window.__obs.push(s);return {ok:true}}}}} """)
    await page.add_script_tag(path=str(ROOT/'src/adapter.js'))
    await page.evaluate("() => window.__message({type:'ENABLE',generation:230},null,()=>{})")
    await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
    snap=await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
    assert snap['step2'] and len(snap['shiftCards'])==1,snap
    assert 'homeLogo' in snap['buttons'],snap['buttons']
    assert 'menu' not in snap['buttons'],snap['buttons']
    r=await page.evaluate("""id=>new Promise(resolve=>window.__message(
      {type:'CLICK',id,generation:230,label:'Click 7A — Amazon Jobs logo'},null,resolve))""",snap['buttons']['homeLogo'])
    assert r['ok'],r
    assert await page.locator('#jobsLogo').get_attribute('data-clicked')=='yes'
    assert await page.locator('#footerBrand').get_attribute('data-clicked') is None
    await browser.close()
    print('PASS: top-left Amazon Jobs logo detected and clicked on synthetic Step 2 page')

if __name__=='__main__':asyncio.run(main())
