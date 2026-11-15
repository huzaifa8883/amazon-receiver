"""Synthetic signed-out public search, signed-in Recommended, and logged-in All-tab fixtures.
No network access to Amazon and no Chrome account interaction.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE='https://www.jobsatamazon.co.uk/app#/jobSearch'
PUBLIC='''<!doctype html><html><body><header><a>amazonjobs</a></header>
<div><input placeholder="Search jobs" aria-label="Search jobs"></div>
<div><button>Add filter</button><button>Sort by</button><button>Within 30 miles</button></div>
<h1>18 jobs found</h1><div class="card">Warehouse Associate – Port Talbot</div>
<div class="card">Delivery Station Warehouse Associate – Poole England</div>
</body></html>'''
RECOMMENDED='''<!doctype html><html><body><h1>Job Search</h1>
<button aria-pressed="true">Recommended</button><button>All</button>
<h2>Recommended jobs for you</h2><article>Warehouse Associate – Poole England</article>
</body></html>'''
ALL_SIGNED_IN='''<!doctype html><html><body><h1>Job Search</h1>
<button>Recommended</button><button aria-pressed="true">All</button>
<input placeholder="Search jobs"><button>Add filter</button><button>Sort by</button>
<h2>18 jobs found</h2><article>Warehouse Associate</article>
</body></html>'''
async def observe(page,markup):
    # Use offline fixture: simulate the Amazon jobSearch location in the in-memory
    # adapter source; do not navigate or make requests to the live website.
    await page.set_content(markup)
    await page.evaluate('''() => {window.__obs=[];window.chrome={runtime:{id:'synthetic-test',onMessage:{addListener(f){window.__msg=f}},sendMessage:async x=>{window.__obs.push(x);return {ok:true}}}}}''')
    script=(ROOT/'src/adapter.js').read_text()
    script=script.replace("if(!/\\/jobSearch/i.test(location.pathname+location.hash))return false;","if(false)return false;")
    original="const isSearch=/\\.jobsatamazon\\.co\\.uk$|^jobsatamazon\\.co\\.uk$/.test(location.hostname)&&(/\\/jobSearch/i.test(location.hash+location.pathname)||(/\\bjob search\\b/i.test(document.title)&&buttons.recommended));"
    assert original in script, 'Synthetic fixture could not find site route check'
    script=script.replace(original,"const isSearch=true;")
    assert "const isSearch=true;" in script and "if(false)return false;" in script
    await page.add_script_tag(content=script)
    preflight=await page.evaluate("() => new Promise(resolve=>window.__msg({type:'SECURITY_STATUS'},null,resolve))")
    await page.evaluate("() => window.__msg({type:'ENABLE',generation:42},null,()=>{})")
    await page.wait_for_function("window.__obs.some(x=>x.type==='OBSERVATION')")
    snapshot=await page.evaluate("window.__obs.find(x=>x.type==='OBSERVATION').snapshot")
    return snapshot,preflight
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for markup,expected,label in [(PUBLIC,True,'public search'),(RECOMMENDED,False,'signed-in Recommended'),(ALL_SIGNED_IN,False,'signed-in All tab')]:
      page=await browser.new_page(viewport={'width':1200,'height':800})
      snap,pre=await observe(page,markup)
      assert snap['publicJobSearch']==expected,(label,snap,pre)
      assert pre['publicJobSearch']==expected,(label,pre)
      if expected:
        result=await page.evaluate("() => new Promise(resolve=>window.__msg({type:'CLICK',generation:42,id:'untrusted',label:'Click job'},null,resolve))")
        assert not result['ok'] and 'blocks automation' in result['reason'],result
      await page.close()
    await browser.close()
  print('PASS: public search stops / Recommended and signed-in All remain allowed')
if __name__=='__main__':asyncio.run(main())
