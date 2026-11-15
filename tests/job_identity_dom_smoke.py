"""Same job card with changed miles/pay retains identity on a synthetic page."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><title>Amazon Jobs</title><style>.card{margin:10px;padding:10px;cursor:pointer}</style></head><body>
<button aria-selected="true">Recommended</button><button aria-selected="false">All</button>
<h2>Recommended jobs for you</h2>
<div class="card" data-job-id="JOB-UK-0000000474"><h3>Warehouse Associate</h3><p>Type: Reduced</p><p>Duration: Fixed-term</p><p id="pay">Pay rate: From £15.10</p><p id="distance">Within 0.1 mi | Poole, England</p></div>
</body></html>'''
async def main():
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=await browser.new_page()
    await page.set_content(HTML)
    await page.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(fn){window.__msg=fn}},sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
    source=(ROOT/'src/adapter.js').read_text()
    source=source.replace('const jobCards=isSearch?cards():[];', 'const jobCards=cards();')
    source=source.replace('const recommendedResults=isSearch&&jobCards.length>0', 'const recommendedResults=jobCards.length>0')
    await page.add_script_tag(content=source)
    await page.evaluate("() => window.__msg({type:'ENABLE',generation:1},null,()=>{})")
    await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
    first=await page.evaluate("window.__obs.at(-1).snapshot.jobCards")
    assert len(first)==1,first
    key=first[0]['key']
    assert key=='job-id:job-uk-0000000474',key
    await page.locator('#distance').evaluate("e=>e.textContent='Within 0.4 mi | Poole, England'")
    await page.locator('#pay').evaluate("e=>e.textContent='Pay rate: From £16.10'")
    await page.evaluate("() => window.__msg({type:'SCAN'},null,()=>{})")
    updated=await page.evaluate("window.__obs.at(-1).snapshot.jobCards")
    assert updated[0]['key']==key,(key,updated[0]['key'])
    await browser.close()
  print('PASS: stable job ID across changing mileage and pay')
if __name__=='__main__': asyncio.run(main())
