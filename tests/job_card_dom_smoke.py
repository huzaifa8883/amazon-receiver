"""Synthetic Recommended card with generic DOM classes (not verified Amazon DOM).
Run: python tests/job_card_dom_smoke.py
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><title>Amazon Jobs</title><style>
.selected {background:rgb(35,47,62);color:white} .unselected {background:white;color:black}
.card {display:flex;border:1px solid #ddd;padding:15px;cursor:pointer}
</style></head><body>
  <h1>Job Search</h1>
  <button class="selected">Recommended</button>
  <button class="unselected">All</button>
  <h2>Recommended jobs for you</h2>
  <div class="generic-tile card" onclick="this.dataset.clicked='yes'">
    <div class="image-section">📦</div>
    <div class="content-column">
      <h3>Delivery Station Warehouse Associate</h3>
      <div>Type: Reduced</div><div>Duration: Fixed-term</div>
      <div>Pay rate: From £15.10</div>
      <div>Within 0.1 mi | Plymouth, England</div>
    </div>
  </div>
  <div class="generic-tile card" onclick="this.dataset.clicked='yes'">
    <div><h3>Delivery Station Warehouse Associate</h3><p>Type: Full Time</p>
      <p>Duration: Fixed-term</p><p>Within 0.3 mi | Bristol, England</p></div>
  </div>
</body></html>'''
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        await page.set_content(HTML)
        await page.evaluate("""() => {
          window.__obs=[]; window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__chromeMessage=fn}},
          sendMessage:async msg=>{window.__obs.push(msg);return {ok:true}}}};
        }""")
        # Browser policy blocks navigation to the live Amazon domain in this test
        # environment. Force the test search-context flag in test-only script text.
        source=(ROOT/'src/adapter.js').read_text()
        source=source.replace('const jobCards=isSearch?cards():[];', 'const jobCards=cards();')
        source=source.replace('const recommendedResults=isSearch&&jobCards.length>0', 'const recommendedResults=jobCards.length>0')
        await page.add_script_tag(content=source)
        await page.evaluate("() => window.__chromeMessage({type:'ENABLE',generation:77},null,()=>{})")
        await page.wait_for_function('window.__obs.some(m=>m.type===\'OBSERVATION\')')
        snap=await page.evaluate("window.__obs.find(m=>m.type==='OBSERVATION').snapshot")
        # Search context is simulated only for job-card parsing and safe click checks.
        assert snap['activeRecommended']=='yes',snap
        assert snap['recommendedResults'], 'Visible Recommended heading + real cards must verify pill even without ARIA selected state'
        assert len(snap['jobCards'])==2,snap['jobCards']
        assert all(len(c['targets'])>=1 for c in snap['jobCards'])
        first=snap['jobCards'][0]
        assert first['locationText']=='Plymouth, England',first
        assert first['distanceMiles']==0.1,first
        assert 'Reduced' in first['text'] and 'Delivery Station' in first['text'],first
        assert not snap['securityBlocked'],snap
        click=await page.evaluate("""id => new Promise(resolve=>window.__chromeMessage(
          {type:'CLICK',generation:77,id,label:'Click 1 — selected job card'},null,resolve))""",first['id'])
        assert click['ok'],click
        assert await page.locator('.generic-tile').first.get_attribute('data-clicked')=='yes'
        assert await page.locator('.generic-tile').last.get_attribute('data-clicked') is None
        await browser.close()
        print('PASS: Plymouth generic DOM card identified, 0.1 mi parsed, Recommended verified, correct card clicked')
if __name__=='__main__':asyncio.run(main())
