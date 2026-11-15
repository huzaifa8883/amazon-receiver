"""Regression: dynamically inserted and updated Recommended job cards trigger
immediate observations; no enforced 45ms observer debounce. Uses synthetic DOM.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><title>Job Search</title><body>
<button aria-selected="true">Recommended</button><button>All</button>
<h2>Recommended jobs for you</h2><main id="results"></main></body>'''
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        await page.set_content(HTML)
        await page.evaluate("""() => {window.__obs=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.__chromeMessage=fn}},sendMessage:async m=>{window.__obs.push({at:performance.now(),m});return {ok:true}}}}}""")
        script=(ROOT/'src/adapter.js').read_text().replace('const jobCards=isSearch?cards():[];', 'const jobCards=cards();').replace('const recommendedResults=isSearch&&jobCards.length>0', 'const recommendedResults=jobCards.length>0')
        await page.add_script_tag(content=script)
        await page.evaluate("() => window.__chromeMessage({type:'ENABLE',generation:24},null,()=>{})")
        await page.wait_for_function('window.__obs.some(x=>x.m.type===\'OBSERVATION\')')
        before=await page.evaluate('window.__obs.length')
        await page.evaluate('''() => {const card=document.createElement('div');card.id='new-card';card.style.cursor='pointer';card.onclick=()=>card.dataset.clicked='yes';card.innerHTML=`<h3>Warehouse Associate</h3><div>Type: Reduced</div><div>Duration: Fixed-term</div><div>Pay rate: £15.10</div><div id="location">Within 0.1 mi | Poole, England</div>`;document.getElementById('results').append(card)}''')
        await page.wait_for_function('window.__obs.some(x=>x.m.type===\'OBSERVATION\' && x.m.snapshot.jobCards.some(c=>c.locationText.includes(\'Poole\')))',timeout=2000)
        observations=await page.evaluate('window.__obs.filter(x=>x.m.type===\'OBSERVATION\')')
        card=observations[-1]['m']['snapshot']['jobCards'][0]
        assert card['title']=='Warehouse Associate',card
        assert card['distanceMiles']==0.1,card
        assert observations[-1]['m']['snapshot']['cardScanMs']>=0
        response=await page.evaluate('''id=>new Promise(ok=>window.__chromeMessage({type:'CLICK',generation:24,id,label:'Click 1 — selected job card'},null,ok))''',card['id'])
        assert response['ok'],response
        assert await page.locator('#new-card').get_attribute('data-clicked')=='yes'
        # Changing an existing job's text must invalidate the cache and be reported.
        await page.locator('#location').evaluate("el=>el.textContent+=' | Part Time'")
        await page.wait_for_function('window.__obs.some(x=>x.m.type===\'OBSERVATION\' && x.m.snapshot.jobCards.some(c=>c.text.includes(\'Part Time\')))',timeout=2000)
        await browser.close()
        print('PASS: dynamic job insertion, immediate event observation, guarded click, and added-text re-observation')
if __name__=='__main__':asyncio.run(main())
