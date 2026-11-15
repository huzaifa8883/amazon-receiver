"""Synthetic Poole card using generic markup and pills without active ARIA state.
No live Amazon page is accessed.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><title>Amazon Jobs</title><style>
.pill {background: white;color:#222;border:1px solid #aaa}
.item {cursor:pointer;border:1px solid #eee;padding:15px}
</style></head><body>
<h1>Job Search</h1><button class="pill" id="recommended">Recommended</button>
<button class="pill" id="all">All</button>
<h2>Recommended jobs for you</h2>
<div class="item" onclick="this.dataset.clicked='yes'">
  <div><span>📦</span></div><div>
  <h3>Delivery Station Warehouse Associate</h3>
  <div>Type: Flexible Shifts, Full Time, Part Time, Reduced</div>
  <div>Duration: Fixed-term</div><div>Pay rate: From £15.10</div>
  <div>Within 0.1 mi | Poole, England</div></div></div>
</body></html>'''
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page()
    await page.set_content(HTML)
    await page.evaluate("""() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(f){window.__message=f}},
     sendMessage:async s=>{window.__obs.push(s);return {ok:true}}}}} """)
    script=(ROOT/'src/adapter.js').read_text()
    script=script.replace('const jobCards=isSearch?cards():[];', 'const jobCards=cards();')
    script=script.replace('const recommendedResults=isSearch&&jobCards.length>0', 'const recommendedResults=jobCards.length>0')
    await page.add_script_tag(content=script)
    await page.evaluate("() => window.__message({type:'ENABLE',generation:2026},null,()=>{})")
    await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
    snap=await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
    assert snap['activeRecommended']=='yes', snap
    assert snap['recommendedResults']
    assert len(snap['jobCards'])==1, snap['jobCards']
    card=snap['jobCards'][0]
    assert card['distanceMiles']==0.1,card
    assert card['locationText']=='Poole, England',card
    assert 'Full Time' in card['text'] and 'Poole' in card['text'],card
    assert len(card['targets'])>=1,card
    response=await page.evaluate("""id=>new Promise(resolve=>window.__message(
      {type:'CLICK',id,generation:2026,label:'Click 1 — selected job card'},null,resolve))""",card['id'])
    assert response['ok'],response
    assert await page.locator('.item').get_attribute('data-clicked')=='yes'
    # Explicitly selecting All must never be overridden by the heading fallback.
    await page.locator('#all').evaluate("x=>x.setAttribute('aria-selected','true')")
    await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION'&&x.snapshot.activeRecommended==='no')")
    await browser.close()
    print('PASS: Poole card, generic pill without selected state, click, All-tab protection')
if __name__=='__main__':asyncio.run(main())
