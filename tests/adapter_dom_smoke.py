"""Check DOM adapter on a synthetic Step 2 page, not the live Amazon site.
Run: python tests/adapter_dom_smoke.py (requires Python Playwright / Chromium)
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!DOCTYPE html><title>Amazon Application</title><body>
<h2>Step 2 of 6</h2><article class="shift-card" onclick="this.setAttribute('data-clicked','yes')">
<p>Hours: 40hrs per week</p><p>Shift: Wed, Thu, Fri, Sat 7:00 - 17:30</p></article>
<div style="display:none"><h2>Security verification</h2><form><input name="captcha"></form></div>
</body>'''
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        await page.set_content(HTML)
        await page.evaluate("""() => {
            window.__observations=[];
            window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__chromeMessage=fn}},
              sendMessage:async(msg)=>{window.__observations.push(msg);return {ok:true}}}};
        }""")
        await page.add_script_tag(path=str(ROOT/'src/adapter.js'))
        await page.evaluate("() => window.__chromeMessage({type:'ENABLE',generation:42,clockAt:null},null,()=>{})")
        await page.wait_for_function("window.__observations.some(x=>x.type==='OBSERVATION')")
        snap=await page.evaluate("window.__observations.find(x=>x.type==='OBSERVATION').snapshot")
        assert snap['step2'],snap
        assert not snap['securityBlocked'],snap
        assert len(snap['shiftCards'])==1,snap['shiftCards']
        card=snap['shiftCards'][0]
        assert card['weeklyHours']==40,card
        assert card['workingDays']==4,card
        assert card['startTime']=='07:00',card
        click=await page.evaluate("""id => new Promise(resolve=>window.__chromeMessage(
          {type:'CLICK',generation:42,id,label:'Click 7'},null,resolve))""",card['id'])
        assert click['ok'],click
        assert await page.locator('article.shift-card').get_attribute('data-clicked')=='yes'
        await browser.close()
        print('DOM adapter synthetic test: PASS (Step 2, hours, days, time, click, hidden CAPTCHA ignored)')
if __name__=='__main__':asyncio.run(main())
